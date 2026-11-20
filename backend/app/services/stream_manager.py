import logging
import os
import threading
import time
import uuid
from collections import defaultdict, deque

import cv2
import numpy as np
from ultralytics import YOLO

from app.core.config import settings
from app.worker.tasks import process_anpr_pipeline

logger = logging.getLogger("anpr.stream_manager")

# Force TCP RTSP + 5s socket timeout (stimeout in microseconds) before any VideoCapture call
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
    "rtsp_transport;tcp|stimeout;5000000|fflags;nobuffer|flags;low_delay|max_delay;500000"
)

# COCO vehicle classes: 2=car, 3=motorcycle, 5=bus, 7=truck
VEHICLE_CLASS_MAP = {
    3: "2W",
    2: "4W",
    5: "HCV",
    7: "HCV",
}

# Global lock to serialize YOLO model instantiation safely across camera threads
_MODEL_INIT_LOCK = threading.Lock()

MAX_CELERY_QUEUE_DEPTH = 12
DISPATCH_COOLDOWN_SEC = 2.0


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
        burst_frames: int = 3,
    ):
        self.camera_id = camera_id
        self.user_id = user_id
        self.gate_no = gate_no
        self.gate_name = gate_name
        self.gate_type = gate_type.upper()
        self.source_url = source_url.strip()
        self.line_coords = line_coords
        self.burst_frames = max(1, min(10, int(burst_frames or 3)))

        self.running = False
        self.connected = False
        self.status_text = "Initializing..."
        self.last_error: str | None = None
        self.last_frame_ts: float = 0.0
        self.dispatched_count: int = 0

        self.latest_jpeg: bytes | None = None
        self.last_preview_request: float = 0.0
        self._last_dispatch_ts: float = 0.0

        # Latest raw frame buffer updated by dedicated grabber thread (prevents RTSP lag)
        self._raw_frame: np.ndarray | None = None
        self._raw_frame_seq: int = 0
        self._frame_lock = threading.Lock()

        self.lock = threading.Lock()
        self.grab_thread: threading.Thread | None = None
        self.infer_thread: threading.Thread | None = None

    def start(self):
        if self.running:
            return
        self.running = True
        self.last_error = None
        self.grab_thread = threading.Thread(
            target=self._grab_loop, name=f"cam-{self.camera_id}-grab", daemon=True
        )
        self.infer_thread = threading.Thread(
            target=self._infer_loop, name=f"cam-{self.camera_id}-infer", daemon=True
        )
        self.grab_thread.start()
        self.infer_thread.start()

    def stop(self):
        self.running = False
        self.connected = False
        self.status_text = "Stopped"
        if self.grab_thread and self.grab_thread.is_alive():
            self.grab_thread.join(timeout=1.5)
        if self.infer_thread and self.infer_thread.is_alive():
            self.infer_thread.join(timeout=1.5)

    def update_config(
        self,
        gate_no: str,
        gate_name: str,
        gate_type: str,
        line_coords: tuple[float, float, float, float],
        burst_frames: int | None = None,
    ):
        self.gate_no = gate_no
        self.gate_name = gate_name
        self.gate_type = gate_type.upper()
        self.line_coords = line_coords
        if burst_frames is not None:
            self.burst_frames = max(1, min(10, int(burst_frames or 3)))

    def update_line(self, x1: float, y1: float, x2: float, y2: float):
        self.line_coords = (
            max(0.0, min(1.0, float(x1))),
            max(0.0, min(1.0, float(y1))),
            max(0.0, min(1.0, float(x2))),
            max(0.0, min(1.0, float(y2))),
        )

    def _open_capture(self, source):
        if isinstance(source, int):
            cap = cv2.VideoCapture(source)
        else:
            cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap

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
        side = dx * (py - y1) - dy * (px - x1)
        t = ((px - x1) * dx + (py - y1) * dy) / seg_len_sq
        pad = margin / (seg_len_sq ** 0.5)
        within = (-pad) <= t <= (1.0 + pad)
        return side, within

    def _is_celery_overloaded(self) -> bool:
        try:
            import redis

            r = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1)
            depth = r.llen("celery")
            if depth >= MAX_CELERY_QUEUE_DEPTH:
                self.last_error = f"Celery queue backlog ({depth} pending)"
                logger.warning("[Cam:%s] Skipping dispatch — Celery queue depth=%d", self.camera_id, depth)
                return True
        except Exception:
            pass
        return False

    def _dispatch_burst(self, track_id: int, frames: list, vehicle_type: str):
        now = time.time()
        if now - self._last_dispatch_ts < DISPATCH_COOLDOWN_SEC:
            logger.debug("[Cam:%s] Dispatch cooldown active for track #%s", self.camera_id, track_id)
            return

        if self._is_celery_overloaded():
            return

        limit = self.burst_frames
        task_id = str(uuid.uuid4())
        os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
        saved_paths = []
        for idx, frame in enumerate(frames[:limit]):
            path = os.path.join(settings.UPLOAD_DIR, f"cam{self.camera_id}_{task_id}_f{idx}.jpg")
            if cv2.imwrite(path, frame):
                saved_paths.append(path)

        if saved_paths:
            gate_payload = {
                "direction": self.gate_type,
                "gate_label": f"{self.gate_no} ({self.gate_name})",
                "vehicle_type": vehicle_type,
            }
            try:
                process_anpr_pipeline.delay(
                    task_id,
                    saved_paths,
                    self.user_id,
                    "parking",
                    gate_payload,
                )
                self._last_dispatch_ts = now
                self.dispatched_count += 1
                self.last_error = None
                logger.info(
                    "[Cam:%s] Dispatched task=%s track=#%s type=%s frames=%d",
                    self.camera_id,
                    task_id,
                    track_id,
                    vehicle_type,
                    len(saved_paths),
                )
            except Exception as exc:
                self.last_error = f"Celery dispatch error: {exc}"
                logger.exception("[Cam:%s] Celery dispatch error: %s", self.camera_id, exc)
                for p in saved_paths:
                    try:
                        os.remove(p)
                    except OSError:
                        pass

    def _grab_loop(self):
        """Dedicated wire-speed RTSP reader so decoder buffers never back up."""
        source = int(self.source_url) if self.source_url.isdigit() else self.source_url
        is_local_file = isinstance(source, str) and os.path.exists(source)
        cap = self._open_capture(source)

        while self.running:
            try:
                if not cap.isOpened():
                    self.connected = False
                    self.status_text = "Connecting..."
                    self.last_error = f"Unable to open stream: {self.source_url}"
                    with self.lock:
                        self.latest_jpeg = self._make_placeholder_jpeg(
                            f"Connecting to {self.source_url}..."
                        )
                    time.sleep(2.5)
                    cap.release()
                    cap = self._open_capture(source)
                    continue

                ret, frame = cap.read()
                if not ret or frame is None:
                    if is_local_file:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        time.sleep(0.03)
                        continue

                    self.connected = False
                    self.status_text = "Reconnecting..."
                    self.last_error = "RTSP read timeout / stream interrupted"
                    logger.warning("[Cam:%s] Stream interrupted, reconnecting...", self.camera_id)
                    with self.lock:
                        self.latest_jpeg = self._make_placeholder_jpeg(
                            "Stream interrupted. Reconnecting..."
                        )
                    cap.release()
                    time.sleep(2.5)
                    cap = self._open_capture(source)
                    continue

                self.connected = True
                self.status_text = "LIVE"
                self.last_frame_ts = time.time()
                with self._frame_lock:
                    self._raw_frame = frame
                    self._raw_frame_seq += 1

                if is_local_file:
                    time.sleep(0.04)
                else:
                    time.sleep(0.005)
            except Exception as grab_exc:
                self.connected = False
                self.status_text = "Stream Error"
                self.last_error = str(grab_exc)
                logger.exception("[Cam:%s] Grab loop exception: %s", self.camera_id, grab_exc)
                try:
                    cap.release()
                except Exception:
                    pass
                time.sleep(3.0)
                cap = self._open_capture(source)

        cap.release()

    def _infer_loop(self):
        """Processes the latest grabbed frame with ByteTrack and tripwire crossing detection."""
        model_path = os.getenv("VEHICLE_TRACK_MODEL", "yolo11n.pt")
        vehicle_conf = float(os.getenv("VEHICLE_CONF", "0.60"))

        model = None
        while self.running and model is None:
            try:
                with _MODEL_INIT_LOCK:
                    model = YOLO(model_path)
            except Exception as init_exc:
                self.last_error = f"Tracker model load error: {init_exc}"
                logger.exception("[Cam:%s] Failed to load YOLO tracker model: %s", self.camera_id, init_exc)
                time.sleep(3.0)

        if not self.running or model is None:
            return

        prev_side: dict[int, float] = {}
        pre_cross_buffer: dict[int, deque] = defaultdict(lambda: deque(maxlen=2))
        triggered_ids: set[int] = set()
        # track_id -> (vehicle_type, frames_list, cross_started_ts)
        post_cross_collect: dict[int, tuple[str, list, float]] = {}
        last_seen_ts: dict[int, float] = {}

        last_processed_seq = -1
        last_cleanup_ts = time.time()

        while self.running:
            with self._frame_lock:
                if self._raw_frame is None or self._raw_frame_seq == last_processed_seq:
                    full_frame = None
                else:
                    full_frame = self._raw_frame.copy()
                    last_processed_seq = self._raw_frame_seq

            if full_frame is None:
                time.sleep(0.015)
                continue

            now = time.time()
            target_burst = self.burst_frames
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

            try:
                results = model.track(
                    proc_frame,
                    conf=vehicle_conf,
                    classes=list(VEHICLE_CLASS_MAP.keys()),
                    persist=True,
                    tracker="bytetrack.yaml",
                    verbose=False,
                )
            except Exception as exc:
                self.last_error = f"ByteTrack inference error: {exc}"
                logger.warning("[Cam:%s] Tracking error: %s", self.camera_id, exc)
                time.sleep(0.05)
                continue

            render_preview = (now - self.last_preview_request) < 3.0
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
                    last_seen_ts[tid] = now
                    v_type = VEHICLE_CLASS_MAP.get(cls_id, "4W")
                    x1, y1, x2, y2 = map(int, box)
                    bottom_cx = (x1 + x2) / 2.0
                    bottom_y = float(y2)

                    if tid not in triggered_ids and target_burst > 1:
                        pre_cross_buffer[tid].append(full_frame.copy())

                    if tid in post_cross_collect:
                        vt, frames_list, cross_ts = post_cross_collect[tid]
                        frames_list.append(full_frame.copy())
                        if len(frames_list) >= target_burst:
                            post_cross_collect.pop(tid, None)
                            self._dispatch_burst(tid, frames_list[:target_burst], vt)

                    curr_side, within_seg = self._signed_side_and_within_segment(
                        bottom_cx, bottom_y, px1, py1, px2, py2
                    )

                    if tid in prev_side and tid not in triggered_ids and within_seg:
                        ps = prev_side[tid]
                        if (ps < 0 <= curr_side) or (ps > 0 >= curr_side):
                            triggered_ids.add(tid)
                            if target_burst == 1:
                                pre_cross_buffer.pop(tid, None)
                                self._dispatch_burst(tid, [full_frame.copy()], v_type)
                            else:
                                max_seed = min(2, target_burst - 1)
                                seed = list(pre_cross_buffer.pop(tid, []))[-max_seed:] or [full_frame.copy()]
                                if len(seed) >= target_burst:
                                    self._dispatch_burst(tid, seed[:target_burst], v_type)
                                else:
                                    post_cross_collect[tid] = (v_type, seed, now)

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

            # Flush any partial post-cross burst if vehicle exited frame within 0.6s
            for tid in list(post_cross_collect.keys()):
                vt, frames_list, cross_ts = post_cross_collect[tid]
                if now - cross_ts >= 0.6:
                    post_cross_collect.pop(tid, None)
                    self._dispatch_burst(tid, frames_list[:target_burst], vt)

            if render_preview:
                ok, buf = cv2.imencode(".jpg", proc_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 60])
                if ok:
                    with self.lock:
                        self.latest_jpeg = buf.tobytes()

            # Periodically prune stale track IDs (> 6s unseen) to keep memory flat 24/7
            if now - last_cleanup_ts > 5.0:
                stale_ids = [tid for tid, ts in last_seen_ts.items() if now - ts > 6.0]
                for tid in stale_ids:
                    last_seen_ts.pop(tid, None)
                    prev_side.pop(tid, None)
                    pre_cross_buffer.pop(tid, None)
                    triggered_ids.discard(tid)
                    post_cross_collect.pop(tid, None)
                last_cleanup_ts = now

            # Yield GIL so FastAPI HTTP requests always stay snappy
            time.sleep(0.015)


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
            burst_frames=getattr(cam, "burst_frames", 1) or 1,
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