import os
import time
import threading
from collections import defaultdict, deque
import cv2
import requests
from ultralytics import YOLO

API_BASE = os.getenv("ANPR_API_BASE", "http://localhost:8000")
AGENT_TOKEN = os.getenv("ANPR_AGENT_TOKEN", "agt_replace_with_your_token")
VIDEO_SOURCE = os.getenv("ANPR_VIDEO_SOURCE", "0")  # RTSP URL, MP4 path, or "0" for webcam
VEHICLE_MODEL_PATH = os.getenv("VEHICLE_MODEL", "yolo11n.pt")
SHOW_PREVIEW = os.getenv("SHOW_PREVIEW", "1") == "1"

VEHICLE_CLASSES = {2, 3, 5, 7}  # COCO: car, motorcycle, bus, truck


def sync_agent_config() -> tuple[str, float]:
    try:
        res = requests.post(
            f"{API_BASE}/v1/agent/heartbeat",
            headers={"X-Agent-Token": AGENT_TOKEN},
            timeout=5,
        )
        if res.ok:
            data = res.json()
            return data.get("direction", "ENTRY"), float(data.get("line_y_ratio", 0.65))
    except Exception as e:
        print(f"[Agent] Heartbeat warning: {e}")
    return "ENTRY", 0.65


def dispatch_burst_async(track_id: int, frames: list):
    def _worker():
        files = []
        for idx, frame in enumerate(frames):
            ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
            if ok:
                files.append(("files", (f"track_{track_id}_{idx}.jpg", buf.tobytes(), "image/jpeg")))
        if not files:
            return
        try:
            res = requests.post(
                f"{API_BASE}/v1/agent/ingest",
                headers={"X-Agent-Token": AGENT_TOKEN},
                data={"track_id": str(track_id)},
                files=files,
                timeout=15,
            )
            print(f"[Agent] Track #{track_id} ingested -> HTTP {res.status_code}: {res.text}")
        except Exception as e:
            print(f"[Agent] Ingest error for Track #{track_id}: {e}")

    threading.Thread(target=_worker, daemon=True).start()


def run_agent():
    source = int(VIDEO_SOURCE) if VIDEO_SOURCE.isdigit() else VIDEO_SOURCE
    model = YOLO(VEHICLE_MODEL_PATH)

    direction, line_y_ratio = sync_agent_config()
    print(f"[Agent] Connected | Direction={direction} | Tripwire Y Ratio={line_y_ratio}")

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise RuntimeError(f"Unable to open video source: {VIDEO_SOURCE}")

    # Track history per vehicle ID
    prev_bottom_y: dict[int, float] = {}
    pre_cross_buffer: dict[int, deque] = defaultdict(lambda: deque(maxlen=2))
    triggered_ids: set[int] = set()
    post_cross_collect: dict[int, list] = {}
    last_heartbeat = time.time()

    while True:
        ret, frame = cap.read()
        if not ret:
            if isinstance(source, str) and not source.startswith("rtsp"):
                # Loop local MP4 test videos cleanly
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                prev_bottom_y.clear()
                triggered_ids.clear()
                continue
            time.sleep(1.0)
            cap.open(source)
            continue

        h, w = frame.shape[:2]
        line_y = int(h * line_y_ratio)

        # Periodic heartbeat every 30s to sync remote line_y_ratio / direction changes
        if time.time() - last_heartbeat > 30:
            direction, line_y_ratio = sync_agent_config()
            last_heartbeat = time.time()

        results = model.track(frame, persist=True, tracker="bytetrack.yaml", verbose=False)
        annotated = frame.copy() if SHOW_PREVIEW else None

        # Draw tripwire line across frame
        if annotated is not None:
            cv2.line(annotated, (0, line_y), (w, line_y), (0, 255, 255), 2)
            cv2.putText(
                annotated,
                f"TRIPWIRE ({direction}) Y={line_y}",
                (16, max(28, line_y - 10)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (0, 255, 255),
                2,
            )

        if results and results[0].boxes is not None and results[0].boxes.id is not None:
            boxes = results[0].boxes.xyxy.cpu().numpy()
            track_ids = results[0].boxes.id.int().cpu().tolist()
            classes = results[0].boxes.cls.int().cpu().tolist()

            for box, tid, cls_id in zip(boxes, track_ids, classes):
                if cls_id not in VEHICLE_CLASSES:
                    continue

                x1, y1, x2, y2 = map(int, box)
                bottom_cx = (x1 + x2) // 2
                bottom_y = float(y2)  # Bottom edge of the vehicle bounding box

                # Keep 2 recent frames before crossing for burst diversity
                if tid not in triggered_ids:
                    pre_cross_buffer[tid].append(frame.copy())

                # Collect 2 additional frames right after crossing, then dispatch burst
                if tid in post_cross_collect:
                    post_cross_collect[tid].append(frame.copy())
                    if len(post_cross_collect[tid]) >= 3:
                        burst = post_cross_collect.pop(tid)
                        dispatch_burst_async(tid, burst)

                # Bottom-of-vehicle line-crossing check (fires once per track_id)
                if tid in prev_bottom_y and tid not in triggered_ids:
                    py = prev_bottom_y[tid]
                    crossed_down = py < line_y <= bottom_y
                    crossed_up = py > line_y >= bottom_y

                    if crossed_down or crossed_up:
                        triggered_ids.add(tid)
                        initial_frames = list(pre_cross_buffer[tid]) or [frame.copy()]
                        post_cross_collect[tid] = initial_frames
                        print(f"[Agent] Vehicle #{tid} bottom edge crossed LINE_Y={line_y} ({py:.0f} -> {bottom_y:.0f})")

                prev_bottom_y[tid] = bottom_y

                if annotated is not None:
                    color = (0, 255, 0) if tid in triggered_ids else (255, 180, 0)
                    cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
                    cv2.circle(annotated, (bottom_cx, int(bottom_y)), 5, (0, 0, 255), -1)
                    cv2.putText(
                        annotated,
                        f"ID:{tid} {'CAPTURED' if tid in triggered_ids else 'TRACKING'}",
                        (x1, max(20, y1 - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.55,
                        color,
                        2,
                    )

        if annotated is not None:
            cv2.imshow("Sigma Edge ANPR Agent", annotated)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    run_agent()