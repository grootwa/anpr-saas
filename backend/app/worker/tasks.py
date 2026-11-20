import logging
import os
import re
import time
import warnings
import cv2
import numpy as np
from ultralytics import YOLO
from rapidocr_onnxruntime import RapidOCR

from app.core.celery_app import celery
from app.core.config import settings
from app.core.database import SessionLocal, ANPRLog
from app.api.parking import process_gate_decision

logger = logging.getLogger("anpr.worker")

# MUTE WARNINGS
warnings.filterwarnings("ignore", category=FutureWarning, message=".*weights_only=False.*")

# CONFIGURATION
YOLO_MODEL_PATH = settings.YOLO_MODEL_PATH
PLATE_CLASS_INDEX = 0
YOLO_CONFIDENCE = 0.45
OCR_CONFIDENCE = 0.50

# INITIALIZE MODELS IN MEMORY
print("[Worker] Loading YOLO model...")
yolo_model = YOLO(YOLO_MODEL_PATH)
print("[Worker] Loading RapidOCR engine...")
ocr_engine = RapidOCR()

# VALIDATION DATA (UNCHANGED)
STATE_CODES = {
    "AN", "AP", "AR", "AS", "BR", "CH", "CG", "DN",
    "DD", "DL", "GA", "GJ", "HR", "HP", "JK", "JH", "KA", "KL",
    "LA", "LD", "MP", "MH", "MN", "ML", "MZ", "NL", "OD", "OR",
    "PB", "PY", "RJ", "SK", "TN", "TS", "TR", "UP", "UK", "WB",
}

VALID_STATE_RTO_CODES = {
    "AN": {1},
    "AP": {1, 2, 3, 4, 5, 7, 8, 9, 16, 21, 26, 27, 31, 32, 33, 35, 37, 38, 39, 40, 41, 42, 43, 44},
    "AR": set(range(1, 25)),
    "AS": set(range(1, 36)),
    "BR": {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 19, 21, 22, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 37, 38, 39, 43, 44, 45, 46, 50, 51, 52, 53, 55, 56},
    "CG": set(range(1, 37)),
    "CH": {1, 2, 3, 4},
    "DD": {1, 2},
    "DN": {9},
    "DL": set(range(1, 17)),
    "GA": set(range(1, 13)),
    "GJ": set(range(1, 39)),
    "HP": set(range(1, 49)) | {51, 52, 53, 55, 58, 63, 68, 72},
    "HR": set(range(1, 48)) | {50, 51, 52, 55, 70, 72, 76, 88, 99},
    "JH": set(range(1, 25)),
    "JK": set(range(1, 21)),
    "KA": set(range(1, 60)),
    "KL": set(range(1, 74)),
    "LA": {1, 2},
    "LD": set(range(1, 10)),
    "MH": set(range(1, 53)),
    "ML": set(range(1, 16)),
    "MN": set(range(1, 8)),
    "MP": set(range(1, 23)) | {28, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74},
    "MZ": set(range(1, 12)),
    "NL": set(range(1, 17)),
    "OD": set(range(1, 36)),
    "OR": set(range(1, 36)),
    "PB": set(range(1, 47)) | {65, 89, 90, 91},
    "PY": set(range(1, 6)),
    "RJ": set(range(1, 56)),
    "SK": set(range(1, 7)),
    "TG": set(range(1, 37)),
    "TS": set(range(1, 37)),
    "TN": {1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 28, 29, 30, 31, 32, 33, 34, 36, 37, 38, 39, 40, 41, 42, 43, 45, 46, 47, 48, 49, 50, 51, 52, 54, 55, 56, 57, 58, 59, 60, 61, 63, 64, 65, 66, 67, 68, 69, 70, 72, 73, 74, 75, 76, 77, 78, 79, 81, 82, 83, 84, 85, 86, 87, 88, 90, 91, 92, 93, 94, 95, 96, 97, 99},
    "TR": set(range(1, 9)),
    "UK": set(range(1, 21)),
    "UP": {11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 32, 33, 34, 35, 36, 37, 40, 41, 42, 43, 44, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62, 63, 64, 65, 66, 67, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 90, 91, 92, 93, 94, 95, 96},
    "WB": {1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 15, 16, 19, 20, 23, 24, 25, 26, 29, 30, 31, 32, 33, 34, 37, 39, 41, 42, 43, 47, 48, 51, 52, 53, 57, 58, 59, 60, 63, 64, 65, 66, 67, 68, 71, 72, 73, 76, 77, 78, 82, 85, 86, 89, 90},
}

STATE_CORRECTIONS = {"JM": "JH", "JN": "JH", "JW": "JH", "HB": "WB"}

LETTER_TO_DIGIT = {
    "O": "0", "Q": "0", "D": "0", "C": "0", "U": "0",
    "I": "1", "L": "1", "l": "1", "i": "1", "|": "1", "!": "1", "T": "1",
    "Z": "2", "E": "3", "A": "4", "S": "5", "G": "6", "b": "6", "B": "8",
}
DIGIT_TO_LETTER = {"0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "8": "B"}
LETTER_TO_LETTER = {"O": "Q"}


# HELPERS
def is_valid_rto(state: str, rto_str: str) -> bool:
    if not rto_str.isdigit():
        return False
    return int(rto_str) in VALID_STATE_RTO_CODES.get(state, set())


def normalize_ocr_text(text):
    if not text:
        return ""
    text = str(text).upper().strip().replace("↑", "↑")
    return re.sub(r"[^A-Z0-9↑]", "", text)


def get_polygon_geometry(poly):
    try:
        points = np.asarray(poly, dtype=np.float32)
        return (
            float(np.min(points[:, 0])),
            float(np.min(points[:, 1])),
            float(np.max(points[:, 0])),
            float(np.max(points[:, 1])),
        )
    except Exception:
        return 0.0, 0.0, 0.0, 0.0


def convert_digits_to_letters(text):
    return "".join(DIGIT_TO_LETTER.get(c, c) for c in text)


def convert_letter_to_letter(text):
    return "".join(LETTER_TO_LETTER.get(c, c) for c in text)


def convert_letters_to_digits(text):
    return "".join(LETTER_TO_DIGIT.get(c, c) for c in text)


def sort_ocr_blocks(texts, scores, polys):
    blocks = []
    for text, score, poly in zip(texts, scores, polys):
        normalized = normalize_ocr_text(text)
        if not normalized:
            continue
        x1, y1, x2, y2 = get_polygon_geometry(poly)
        blocks.append({
            "text": normalized,
            "confidence": float(score),
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
            "cy": (y1 + y2) / 2.0,
            "height": max(1.0, y2 - y1),
        })

    if not blocks:
        return []
    median_height = float(np.median([b["height"] for b in blocks]))
    line_tolerance = max(5.0, median_height * 0.6)

    lines = []
    for block in sorted(blocks, key=lambda b: b["cy"]):
        placed = False
        for line in lines:
            if abs(block["cy"] - np.mean([item["cy"] for item in line])) <= line_tolerance:
                line.append(block)
                placed = True
                break
        if not placed:
            lines.append([block])

    lines.sort(key=lambda line: np.mean([item["cy"] for item in line]))
    ordered = []
    for line in lines:
        line.sort(key=lambda item: item["x1"])
        ordered.extend(line)
    return ordered


# GENERATORS (UNCHANGED)
def generate_standard_candidates(text):
    candidates = []
    n = len(text)
    for start in range(n):
        if n - start < 6:
            continue
        for rto_len in (1, 2):
            for series_len in (1, 2, 3):
                for number_len in (1, 2, 3, 4):
                    end = start + 2 + rto_len + series_len + number_len
                    if end > n:
                        continue
                    raw = text[start:end]
                    state = convert_digits_to_letters(raw[0:2])
                    state = STATE_CORRECTIONS.get(state, state)
                    if state not in STATE_CODES:
                        continue

                    rto = convert_letters_to_digits(raw[2:2 + rto_len])
                    if not rto.isdigit() or (rto_len == 1 and rto == "0") or (
                        rto.startswith("0") and (rto_len != 2 or rto == "00")
                    ):
                        continue
                    if not is_valid_rto(state, rto):
                        continue

                    series = convert_letter_to_letter(
                        convert_digits_to_letters(raw[2 + rto_len : 2 + rto_len + series_len])
                    )
                    number = convert_letters_to_digits(raw[2 + rto_len + series_len:])

                    if not series.isalpha() or not number.isdigit() or not (1 <= len(number) <= 4):
                        continue
                    candidate = state + rto + series + number
                    if len(candidate) < 6:
                        continue

                    candidates.append({
                        "text": candidate,
                        "category": "STANDARD",
                        "corrections": sum(a != b for a, b in zip(raw, candidate)),
                        "length": len(candidate),
                    })
    return candidates


def generate_bh_candidates(text):
    candidates = []
    n = len(text)
    for start in range(n):
        for suffix_len in (1, 2):
            end = start + 8 + suffix_len
            if end > n:
                continue
            raw = text[start:end]
            if raw[2:4] != "BH":
                continue

            year = convert_letters_to_digits(raw[0:2])
            number = convert_letters_to_digits(raw[4:8])
            suffix = convert_letter_to_letter(convert_digits_to_letters(raw[8:]))

            if not year.isdigit() or not number.isdigit() or not suffix.isalpha():
                continue
            candidate = year + "BH" + number + suffix
            candidates.append({
                "text": candidate,
                "category": "BH_SERIES",
                "corrections": sum(a != b for a, b in zip(raw, candidate)),
                "length": len(candidate),
            })
    return candidates


def generate_army_candidates(text):
    candidates = []
    n = len(text)
    for start in range(n):
        if start + 11 <= n and text[start] == "↑":
            c = generate_army_from_raw(text[start:start + 11], True)
            if c:
                candidates.append(c)
        if start + 10 <= n and text[start] in {"I", "1"}:
            c = generate_army_from_raw(text[start:start + 10], False)
            if c:
                candidates.append(c)
    return candidates


def generate_army_from_raw(raw, has_arrow):
    tail = raw[1:] if has_arrow else raw
    if len(tail) != 10:
        return None
    year = convert_letters_to_digits(tail[0:2])
    v_class = convert_digits_to_letters(tail[2])
    serial = convert_letters_to_digits(tail[3:9])
    check = convert_digits_to_letters(tail[9])

    if not year.isdigit() or not serial.isdigit() or not v_class.isalpha() or not check.isalpha():
        return None
    candidate = "↑" + year + v_class + serial + check
    return {
        "text": candidate,
        "category": "ARMY",
        "corrections": sum(a != b for a, b in zip(raw.replace("↑", ""), candidate.replace("↑", ""))),
        "length": len(candidate),
    }


def generate_temporary_candidates(text):
    candidates = []
    n = len(text)
    for start in range(n):
        for suffix_len in (1, 2):
            end = start + 11 + suffix_len
            if end > n:
                continue
            raw = text[start:end]
            if raw[0] != "T":
                continue

            month_year = convert_letters_to_digits(raw[1:5])
            state = convert_digits_to_letters(raw[5:7])
            number = convert_letters_to_digits(raw[7:11])
            suffix = convert_letter_to_letter(convert_digits_to_letters(raw[11:]))

            if not month_year.isdigit() or len(month_year) != 4 or not (1 <= int(month_year[:2]) <= 12):
                continue
            if state not in STATE_CODES or not number.isdigit() or not suffix.isalpha():
                continue
            candidate = "T" + month_year + state + number + suffix
            candidates.append({
                "text": candidate,
                "category": "TEMPORARY",
                "corrections": sum(a != b for a, b in zip(raw, candidate)),
                "length": len(candidate),
            })
    return candidates


def extract_plate_candidates(text, confidence):
    text = normalize_ocr_text(text)
    if not text:
        return []
    candidates = []
    for gen in [
        generate_temporary_candidates,
        generate_bh_candidates,
        generate_army_candidates,
        generate_standard_candidates,
    ]:
        for c in gen(text):
            c["ocr_confidence"] = float(confidence)
            c["score"] = float(confidence) + min(c["length"], 13) * 0.02 - c["corrections"] * 0.005
            candidates.append(c)
    return candidates


def build_ocr_sources(blocks):
    if not blocks:
        return []
    sources = [{"text": b["text"], "confidence": b["confidence"]} for b in blocks]
    sources.append({
        "text": "".join(b["text"] for b in blocks),
        "confidence": float(np.mean([b["confidence"] for b in blocks])),
    })
    for i in range(len(blocks)):
        for j in range(i + 2, min(i + 4, len(blocks) + 1)):
            group = blocks[i:j]
            sources.append({
                "text": "".join(b["text"] for b in group),
                "confidence": float(np.mean([b["confidence"] for b in group])),
            })
    return sources


# ADAPTED FOR RAPIDOCR OUTPUT
def extract_ocr_blocks(ocr_result):
    if not ocr_result:
        return []
    blocks = []

    for item in ocr_result:
        poly, text, confidence = item[0], item[1], float(item[2])
        if confidence < OCR_CONFIDENCE:
            continue

        if str(text).strip().upper() in {"IND", "INO"}:
            continue
        normalized = normalize_ocr_text(text)
        if not normalized:
            continue

        x1, y1, x2, y2 = get_polygon_geometry(poly)
        blocks.append({
            "text": normalized,
            "confidence": confidence,
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
            "cy": (y1 + y2) / 2.0,
            "height": max(1.0, y2 - y1),
        })

    if blocks:
        blocks = sort_ocr_blocks(
            [b["text"] for b in blocks],
            [b["confidence"] for b in blocks],
            [[[b["x1"], b["y1"]], [b["x2"], b["y1"]], [b["x2"], b["y2"]], [b["x1"], b["y2"]]] for b in blocks],
        )
    return blocks


def get_all_candidates_from_blocks(blocks):
    """Generates all valid RTO candidates for a single YOLO crop."""
    all_candidates = []
    for source in build_ocr_sources(blocks):
        all_candidates.extend(extract_plate_candidates(source["text"], source["confidence"]))
    return all_candidates


def extract_raw_fallback_candidate(blocks) -> dict | None:
    """
    Fallback when strict Indian RTO validation fails:
    joins sorted OCR blocks into the cleanest alphanumeric string (4..14 chars)
    along with mean OCR confidence so the reading is still preserved.
    """
    if not blocks:
        return None
    joined = "".join(b["text"] for b in blocks)
    clean_alnum = re.sub(r"[^A-Z0-9]", "", joined)
    if len(clean_alnum) < 4:
        return None
    clean_alnum = clean_alnum[:14]
    mean_conf = float(np.mean([b["confidence"] for b in blocks]))
    return {
        "text": clean_alnum,
        "category": "UNVALIDATED",
        "ocr_confidence": mean_conf,
        "score": mean_conf + min(len(clean_alnum), 12) * 0.015,
    }


def _select_best_from_pool(pool: list[dict]) -> tuple[dict, int]:
    """Frequency-weighted consensus selection across multiple burst frames."""
    groups = {}
    for c in pool:
        key = c["text"]
        if key not in groups:
            groups[key] = {"best_candidate": c, "count": 1, "max_score": c["score"]}
        else:
            groups[key]["count"] += 1
            if c["score"] > groups[key]["max_score"]:
                groups[key]["max_score"] = c["score"]
                groups[key]["best_candidate"] = c

    best_plate = None
    best_score = -1.0
    best_count = 1
    for key, grp in groups.items():
        weighted_score = grp["max_score"] + (grp["count"] - 1) * 0.15
        if weighted_score > best_score:
            best_score = weighted_score
            best_plate = grp["best_candidate"]
            best_count = grp["count"]
    return best_plate, best_count


def _to_relative_upload_path(raw_path: str) -> str:
    """Normalize disk file path to clean relative upload path stored in DB."""
    if not raw_path:
        return ""
    norm = raw_path.replace("\\", "/")
    if "/uploads/" in norm:
        return "uploads/" + norm.split("/uploads/", 1)[1]
    if norm.startswith("uploads/"):
        return norm
    return f"uploads/{os.path.basename(norm)}"


# MAIN CELERY WORKER TASK
@celery.task(name="process_anpr_pipeline")
def process_anpr_pipeline(
    task_id: str,
    file_paths: list,
    user_id: int,
    app_source: str = "snapshot",
    gate_direction: str | dict | None = None,
    gate_name: str | None = None,
):
    t_start = time.perf_counter()
    print(f"\n[Worker] 📥 Picked up task {task_id} | Analyzing {len(file_paths)} frames for User {user_id}")

    master_candidate_pool = []
    raw_fallback_pool = []
    highest_yolo_conf = 0.0
    readable_frames = 0

    try:
        # 1. PROCESS ALL FRAMES
        for file_path in file_paths:
            if not file_path or not os.path.exists(file_path):
                logger.warning("[Task:%s] Frame missing on disk: %s", task_id, file_path)
                continue

            img = cv2.imread(file_path)
            if img is None:
                logger.warning("[Task:%s] Failed to decode image: %s", task_id, file_path)
                continue

            readable_frames += 1
            results = yolo_model(img, conf=YOLO_CONFIDENCE, classes=[PLATE_CLASS_INDEX], verbose=False)

            for result in results:
                if result.boxes is None:
                    continue

                for box in result.boxes:
                    if int(box.cls[0]) != PLATE_CLASS_INDEX:
                        continue

                    plate_detection_conf = float(box.conf[0])
                    if plate_detection_conf > highest_yolo_conf:
                        highest_yolo_conf = plate_detection_conf

                    MARGIN = 20
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    x1, y1 = max(0, x1 - MARGIN), max(0, y1)
                    x2, y2 = min(img.shape[1], x2 + MARGIN), min(img.shape[0], y2)

                    if x2 <= x1 or y2 <= y1:
                        continue
                    crop = img[y1:y2, x1:x2]
                    if crop.size == 0:
                        continue

                    ocr_result, _ = ocr_engine(crop)
                    if ocr_result:
                        blocks = extract_ocr_blocks(ocr_result)
                        if blocks:
                            validated = get_all_candidates_from_blocks(blocks)
                            if validated:
                                master_candidate_pool.extend(validated)
                            fallback = extract_raw_fallback_candidate(blocks)
                            if fallback:
                                raw_fallback_pool.append(fallback)

        # 2. EVALUATE VALIDATED CANDIDATES FIRST, THEN UNVALIDATED BEST-OCR FALLBACK
        if master_candidate_pool:
            best_final_plate, seen_count = _select_best_from_pool(master_candidate_pool)
            final_conf = 0.7 * best_final_plate["ocr_confidence"] + 0.3 * highest_yolo_conf
            plate_text = best_final_plate["text"]
            category = best_final_plate["category"]
            confidence_val = round(final_conf * 100, 2)
            db_status = "success"
            print(
                f"[Worker] ✅ Validated Result: {plate_text} ({category}) | "
                f"Conf: {confidence_val}% | Seen in {seen_count} passes"
            )
        elif raw_fallback_pool:
            best_raw_plate, seen_count = _select_best_from_pool(raw_fallback_pool)
            final_conf = 0.7 * best_raw_plate["ocr_confidence"] + 0.3 * highest_yolo_conf
            plate_text = best_raw_plate["text"]
            category = "UNVALIDATED"
            confidence_val = round(final_conf * 100, 2)
            db_status = "success"
            print(
                f"[Worker] 🟡 Unvalidated Fallback Saved: {plate_text} ({category}) | "
                f"Conf: {confidence_val}% | Seen in {seen_count} passes"
            )
        else:
            reason = "No readable image files" if readable_frames == 0 else "No OCR text detected across frames"
            print(f"[Worker] ⚠️ OCR Failed ({reason}) for task {task_id}")
            plate_text = "NO TEXT DETECTED"
            category = None
            confidence_val = 0.0
            db_status = "OCR_FAILED"

    except Exception as infer_exc:
        logger.exception("[Task:%s] Inference pipeline error: %s", task_id, infer_exc)
        return {
            "task_id": task_id,
            "plate": "ERROR",
            "category": None,
            "confidence": 0.0,
            "status": "failed",
            "error": str(infer_exc),
        }

    # 3. SAVE TO MYSQL DATABASE & TRIGGER GATE IF STREAM-DRIVEN
    db = SessionLocal()
    try:
        primary_image = file_paths[0] if file_paths else ""
        rel_image_path = _to_relative_upload_path(primary_image)
        web_image_path = f"{rel_image_path}" if rel_image_path else ""

        new_log = ANPRLog(
            user_id=user_id,
            app_source=app_source,
            task_id=task_id,
            image_path=web_image_path,
            plate_number=plate_text,
            category=category,
            confidence=confidence_val,
            status=db_status,
        )
        db.add(new_log)
        db.commit()

        if db_status == "success" and (gate_direction is not None or app_source == "parking"):
            if isinstance(gate_direction, dict):
                lane_dir = (
                    gate_direction.get("direction")
                    or gate_direction.get("gate_type")
                    or gate_direction.get("lane")
                    or "ENTRY"
                )
                resolved_label = (
                    gate_name
                    or gate_direction.get("gate_label")
                    or gate_direction.get("gate_name")
                    or lane_dir
                )
                v_type = gate_direction.get("vehicle_type") or "4W"
                gate_payload = {
                    "direction": str(lane_dir).strip().upper(),
                    "gate_label": str(resolved_label).strip(),
                    "vehicle_type": str(v_type).strip().upper(),
                }
            else:
                lane_dir = str(gate_direction or "ENTRY").strip().upper()
                gate_payload = {
                    "direction": lane_dir,
                    "gate_label": str(gate_name or lane_dir).strip(),
                    "vehicle_type": "4W",
                }

            decision = process_gate_decision(
                db=db,
                user_id=user_id,
                plate_number=plate_text,
                direction=gate_payload,
                image_path=rel_image_path or None,
            )
            print(f"[Worker] 🚧 Gate Decision: {decision.get('message')}")

    except Exception as db_exc:
        db.rollback()
        logger.exception("[Task:%s] Database persistence error: %s", task_id, db_exc)
        print(f"[Worker] ❌ Database Error on task {task_id}: {db_exc}")
    finally:
        db.close()

    elapsed_ms = int((time.perf_counter() - t_start) * 1000)
    print(f"[Worker] ⏱️ Task {task_id} finished in {elapsed_ms} ms")

    # 4. RETURN FINAL RESULT TO REDIS
    return {
        "task_id": task_id,
        "plate": plate_text,
        "category": category,
        "confidence": confidence_val,
        "status": db_status,
    }