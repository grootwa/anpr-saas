import os
import time
import uuid
import threading
from collections import defaultdict, deque
import cv2
import numpy as np
from ultralytics import YOLO

from app.core.config import settings
from app.worker.tasks import process_anpr_pipeline

# COCO vehicle classes: 2=car, 3=motorcycle, 5=bus, 7=truck
VEHICLE_CLASS_MAP = {
    3: "2W",
    2: "4W",
    5: "HCV",
    7: "HCV",
}


class CameraStreamWorker:
    def __init__(
        self,
        camera_id: int,
        user_id: int,
        gate_no: str,
        gate_name: str,
        gate_type: str,
        source_url: str,
        line_coords: tuple[float, float, float, float] = (0.15, 0.65, 0.85, 0.65),
    ):
        self.camera_id = camera_id
        self.user_id = user_id
        self.gate_no = gate_no
        self.gate_name = gate_name
        self.gate_type = gate_type.upper()
        self.source_url = source_url.strip()
        self.line_coords = line_coords

        self.running = False
        self.connected = False
        self.status_text = "Initializing..."
        self.latest_jpeg: bytes | None = None
        self.last_preview_request: float = 0.0
        self.lock = threading.Lock()
        self.thread: threading.Thread | None = None

    def start(self):
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        self.connected = False
        self.status_text = "Stopped"

    def update_config(
        self,
        gate_no: str,
        gate_name: str,
        gate_type: str,
        line_coords: tuple[float, float, float, float],
    ):
        self.gate_no = gate_no
        self.gate_name = gate_name
        self.gate_type = gate_type.upper()
        self.line_coords = line_coords

    def update_line(self, x1: float, y1: float, x2: float, y2: float):
        self.line_coords = (
            max(0.0, min(1.0, float(x1))),
            max(0.0, min(1.0, float(y1))),
            max(0.0, min(1.0, float(x2))),
            max(0.0, min(1.0, float(y2))),
        )

    def _make_placeholder_jpeg(self, msg: str) -> bytes:
        canvas = np.zeros((360, 640, 3), dtype=np.uint8)
        canvas[:] = (15, 23, 42)
        cv2.putText(
            canvas,
            f"{self.gate_no} - {self.gate_name} ({self.gate_type})",
            (20, 48),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (56, 189, 248),
            2,
        )
        cv2.putText(canvas, msg, (20, 92), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (203, 213, 225), 1)
        ok, buf = cv2.imencode(".jpg", canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 65])
        return buf.tobytes() if ok else b""

    @staticmethod
    def _signed_side_and_within_segment(
        px: float, py: float, x1: float, y1: float, x2: float, y2: float, margin: float = 35.0
    ) -> tuple[float, bool]:
        dx, dy = x2 - x1, y2 - y1
        seg_len_sq = dx * dx + dy * dy
        if seg_len_sq < 1e-6:
            return 0.0, False
        # Cross product gives signed side of line
        side = dx * (py - y1) - dy * (px - x1)
        # Projection t checks if point lies along segment span
        t = ((px - x1) * dx + (py - y1) * dy) / seg_len_sq
        pad = margin / (seg_len_sq ** 0.5)
        within = (-pad) <= t <= (1.0 + pad)
        return side, within

    def _dispatch_burst(self, track_id: int, frames: list, vehicle_type: str):
        task_id = str(uuid.uuid4())
        saved_paths = []
        for idx, frame in enumerate(frames[:3]):
            path = os.path.join(settings.UPLOAD_DIR, f"cam{self.camera_id}_{task_id}_f{idx}.jpg")
            cv2.imwrite(path, frame)
            saved_paths.append(path)

        if saved_paths:
            # Compatible with existing tasks.py signature (5th arg can be dict or str)
            gate_payload = {
                "direction": self.gate_type,
                "gate_label": f"{self.gate_no} ({self.gate_name})",
                "vehicle_type": vehicle_type,
            }
            process_anpr_pipeline.delay(
                task_id,
                saved_paths,
                self.user_id,
                "parking",
                gate_payload,
            )

    def _run_loop(self):
        model_path = os.getenv("VEHICLE_TRACK_MODEL", "yolo11n.pt")
        vehicle_conf = float(os.getenv("VEHICLE_CONF", "0.40"))
        model = YOLO(model_path)

        source = int(self.source_url) if self.source_url.isdigit() else self.source_url
        cap = cv2.VideoCapture(source)

        prev_side: dict[int, float] = {}
        pre_cross_buffer: dict[int, deque] = defaultdict(lambda: deque(maxlen=2))
        triggered_ids: set[int] = set()
        post_cross_collect: dict[int, tuple[str, list]] = {}

        while self.running:
            if not cap.isOpened():
                self.connected = False
                self.status_text = "Connecting..."
                with self.lock:
                    self.latest_jpeg = self._make_placeholder_jpeg(f"Connecting to {self.source_url}...")
                time.sleep(2.0)
                cap.open(source)
                continue

            ret, full_frame = cap.read()
            if not ret:
                if isinstance(source, str) and os.path.exists(source):
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    prev_side.clear()
                    triggered_ids.clear()
                    post_cross_collect.clear()
                    continue

                self.connected = False
                self.status_text = "Reconnecting..."
                with self.lock:
                    self.latest_jpeg = self._make_placeholder_jpeg("Stream interrupted. Reconnecting...")
                cap.release()
                time.sleep(2.0)
                cap = cv2.VideoCapture(source)
                continue

            self.connected = True
            self.status_text = "LIVE"

            orig_h, orig_w = full_frame.shape[:2]
            proc_w = 640
            scale = proc_w / float(orig_w) if orig_w > proc_w else 1.0
            proc_frame = (
                cv2.resize(full_frame, (proc_w, int(orig_h * scale)))
                if scale < 1.0
                else full_frame.copy()
            )
            h, w = proc_frame.shape[:2]

            lx1, ly1, lx2, ly2 = self.line_coords
            px1, py1 = int(lx1 * w), int(ly1 * h)
            px2, py2 = int(lx2 * w), int(ly2 * h)

            results = model.track(
                proc_frame,
                conf=vehicle_conf,
                classes=list(VEHICLE_CLASS_MAP.keys()),
                persist=True,
                tracker="bytetrack.yaml",
                verbose=False,
            )

            # Encode preview JPEG ONLY if Camera Management UI requested a frame in the last 3 seconds
            render_preview = (time.time() - self.last_preview_request) < 3.0
            if render_preview:
                line_color = (16, 185, 129) if self.gate_type == "ENTRY" else (245, 158, 11)
                cv2.line(proc_frame, (px1, py1), (px2, py2), line_color, 2)
                cv2.circle(proc_frame, (px1, py1), 5, (255, 255, 255), -1)
                cv2.circle(proc_frame, (px2, py2), 5, (255, 255, 255), -1)

            if results and results[0].boxes is not None and results[0].boxes.id is not None:
                boxes = results[0].boxes.xyxy.cpu().numpy()
                track_ids = results[0].boxes.id.int().cpu().tolist()
                cls_ids = results[0].boxes.cls.int().cpu().tolist()

                for box, tid, cls_id in zip(boxes, track_ids, cls_ids):
                    v_type = VEHICLE_CLASS_MAP.get(cls_id, "4W")
                    x1, y1, x2, y2 = map(int, box)
                    bottom_cx = (x1 + x2) / 2.0
                    bottom_y = float(y2)

                    if tid not in triggered_ids:
                        pre_cross_buffer[tid].append(full_frame.copy())

                    if tid in post_cross_collect:
                        vt, frames_list = post_cross_collect[tid]
                        frames_list.append(full_frame.copy())
                        if len(frames_list) >= 3:
                            post_cross_collect.pop(tid)
                            self._dispatch_burst(tid, frames_list, vt)

                    curr_side, within_seg = self._signed_side_and_within_segment(
                        bottom_cx, bottom_y, px1, py1, px2, py2
                    )

                    if tid in prev_side and tid not in triggered_ids and within_seg:
                        ps = prev_side[tid]
                        if (ps < 0 <= curr_side) or (ps > 0 >= curr_side):
                            triggered_ids.add(tid)
                            seed = list(pre_cross_buffer[tid]) or [full_frame.copy()]
                            post_cross_collect[tid] = (v_type, seed)

                    prev_side[tid] = curr_side

                    if render_preview:
                        box_color = (34, 197, 94) if tid in triggered_ids else (59, 130, 246)
                        cv2.rectangle(proc_frame, (x1, y1), (x2, y2), box_color, 2)
                        cv2.circle(proc_frame, (int(bottom_cx), int(bottom_y)), 4, (0, 0, 255), -1)
                        cv2.putText(
                            proc_frame,
                            f"#{tid} {v_type}",
                            (x1, max(16, y1 - 6)),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.45,
                            box_color,
                            1,
                        )

            if render_preview:
                ok, buf = cv2.imencode(".jpg", proc_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 60])
                if ok:
                    with self.lock:
                        self.latest_jpeg = buf.tobytes()

            time.sleep(0.01)

        cap.release()


class StreamManager:
    def __init__(self):
        self.workers: dict[int, CameraStreamWorker] = {}

    def start_camera(self, cam) -> CameraStreamWorker:
        if cam.id in self.workers:
            self.workers[cam.id].stop()
        worker = CameraStreamWorker(
            camera_id=cam.id,
            user_id=cam.user_id,
            gate_no=cam.gate_no,
            gate_name=cam.gate_name,
            gate_type=cam.gate_type,
            source_url=cam.source_url,
            line_coords=(cam.line_x1, cam.line_y1, cam.line_x2, cam.line_y2),
        )
        self.workers[cam.id] = worker
        worker.start()
        return worker

    def stop_camera(self, camera_id: int):
        if camera_id in self.workers:
            self.workers[camera_id].stop()
            del self.workers[camera_id]

    def get_worker(self, camera_id: int) -> CameraStreamWorker | None:
        return self.workers.get(camera_id)


stream_manager = StreamManager()