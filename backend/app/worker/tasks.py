import cv2
import numpy as np
import re
import warnings
from ultralytics import YOLO
from rapidocr_onnxruntime import RapidOCR
from app.core.celery_app import celery
from app.core.config import settings
from app.core.database import SessionLocal, ANPRLog

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

# VALIDATION DATA
STATE_CODES = {"AN", "AP", "AR", "AS", "BR", "CH", "CG", "DN",
    "DD", "DL", "GA", "GJ", "HR", "HP", "JK", "JH", "KA", "KL",
    "LA", "LD", "MP", "MH", "MN", "ML", "MZ", "NL", "OD", "OR",
    "PB", "PY", "RJ", "SK", "TN", "TS", "TR", "UP", "UK", "WB"}

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

LETTER_TO_DIGIT = {"O": "0", "Q": "0", "D": "0", "C": "0", "U": "0", "I": "1", "L": "1", "l": "1", "i": "1", "|": "1", "!": "1", "T": "1", "Z": "2", "E": "3", "A": "4", "S": "5", "G": "6", "b": "6", "B": "8"}
DIGIT_TO_LETTER = {"0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "8": "B"}
LETTER_TO_LETTER = {"O": "Q"}

# HELPERS
def is_valid_rto(state: str, rto_str: str) -> bool:
    if not rto_str.isdigit(): return False
    return int(rto_str) in VALID_STATE_RTO_CODES.get(state, set())

def normalize_ocr_text(text):
    if not text: return ""
    text = str(text).upper().strip().replace("↑", "↑")
    return re.sub(r"[^A-Z0-9↑]", "", text)

def get_polygon_geometry(poly):
    try:
        points = np.asarray(poly, dtype=np.float32)
        return float(np.min(points[:, 0])), float(np.min(points[:, 1])), float(np.max(points[:, 0])), float(np.max(points[:, 1]))
    except Exception:
        return 0.0, 0.0, 0.0, 0.0

def convert_digits_to_letters(text): return "".join(DIGIT_TO_LETTER.get(c, c) for c in text)
def convert_letter_to_letter(text): return "".join(LETTER_TO_LETTER.get(c, c) for c in text)
def convert_letters_to_digits(text): return "".join(LETTER_TO_DIGIT.get(c, c) for c in text)

def sort_ocr_blocks(texts, scores, polys):
    blocks = []
    for text, score, poly in zip(texts, scores, polys):
        normalized = normalize_ocr_text(text)
        if not normalized: continue
        x1, y1, x2, y2 = get_polygon_geometry(poly)
        blocks.append({"text": normalized, "confidence": float(score), "x1": x1, "y1": y1, "x2": x2, "y2": y2, "cy": (y1 + y2) / 2.0, "height": max(1.0, y2 - y1)})
    
    if not blocks: return []
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
        if not placed: lines.append([block])
        
    lines.sort(key=lambda line: np.mean([item["cy"] for item in line]))
    ordered = []
    for line in lines:
        line.sort(key=lambda item: item["x1"])
        ordered.extend(line)
    return ordered

# GENERATORS
def generate_standard_candidates(text):
    candidates = []
    n = len(text)
    for start in range(n):
        if n - start < 6: continue
        for rto_len in (1, 2):
            for series_len in (1, 2, 3):
                for number_len in (1, 2, 3, 4):
                    end = start + 2 + rto_len + series_len + number_len
                    if end > n: continue
                    raw = text[start:end]
                    state = convert_digits_to_letters(raw[0:2])
                    state = STATE_CORRECTIONS.get(state, state)
                    if state not in STATE_CODES: continue
                    
                    rto = convert_letters_to_digits(raw[2:2 + rto_len])
                    if not rto.isdigit() or (rto_len == 1 and rto == "0") or (rto.startswith("0") and (rto_len != 2 or rto == "00")): continue
                    if not is_valid_rto(state, rto): continue
                    
                    series = convert_letter_to_letter(convert_digits_to_letters(raw[2 + rto_len : 2 + rto_len + series_len]))
                    number = convert_letters_to_digits(raw[2 + rto_len + series_len:])
                    
                    if not series.isalpha() or not number.isdigit() or not (1 <= len(number) <= 4): continue
                    candidate = state + rto + series + number
                    if len(candidate) < 6: continue
                    
                    candidates.append({"text": candidate, "category": "STANDARD", "corrections": sum(a != b for a, b in zip(raw, candidate)), "length": len(candidate)})
    return candidates

def generate_bh_candidates(text):
    candidates = []
    n = len(text)
    for start in range(n):
        for suffix_len in (1, 2):
            end = start + 8 + suffix_len
            if end > n: continue
            raw = text[start:end]
            if raw[2:4] != "BH": continue
            
            year = convert_letters_to_digits(raw[0:2])
            number = convert_letters_to_digits(raw[4:8])
            suffix = convert_letter_to_letter(convert_digits_to_letters(raw[8:]))
            
            if not year.isdigit() or not number.isdigit() or not suffix.isalpha(): continue
            candidate = year + "BH" + number + suffix
            candidates.append({"text": candidate, "category": "BH_SERIES", "corrections": sum(a != b for a, b in zip(raw, candidate)), "length": len(candidate)})
    return candidates

def generate_army_candidates(text):
    candidates = []
    n = len(text)
    for start in range(n):
        if start + 11 <= n and text[start] == "↑":
            c = generate_army_from_raw(text[start:start + 11], True)
            if c: candidates.append(c)
        if start + 10 <= n and text[start] in {"I", "1"}:
            c = generate_army_from_raw(text[start:start + 10], False)
            if c: candidates.append(c)
    return candidates

def generate_army_from_raw(raw, has_arrow):
    tail = raw[1:] if has_arrow else raw
    if len(tail) != 10: return None
    year = convert_letters_to_digits(tail[0:2])
    v_class = convert_digits_to_letters(tail[2])
    serial = convert_letters_to_digits(tail[3:9])
    check = convert_digits_to_letters(tail[9])
    
    if not year.isdigit() or not serial.isdigit() or not v_class.isalpha() or not check.isalpha(): return None
    candidate = "↑" + year + v_class + serial + check
    return {"text": candidate, "category": "ARMY", "corrections": sum(a != b for a, b in zip(raw.replace("↑", ""), candidate.replace("↑", ""))), "length": len(candidate)}

def generate_temporary_candidates(text):
    candidates = []
    n = len(text)
    for start in range(n):
        for suffix_len in (1, 2):
            end = start + 11 + suffix_len
            if end > n: continue
            raw = text[start:end]
            if raw[0] != "T": continue
            
            month_year = convert_letters_to_digits(raw[1:5])
            state = convert_digits_to_letters(raw[5:7])
            number = convert_letters_to_digits(raw[7:11])
            suffix = convert_letter_to_letter(convert_digits_to_letters(raw[11:]))
            
            if not month_year.isdigit() or len(month_year) != 4 or not (1 <= int(month_year[:2]) <= 12): continue
            if state not in STATE_CODES or not number.isdigit() or not suffix.isalpha(): continue
            candidate = "T" + month_year + state + number + suffix
            candidates.append({"text": candidate, "category": "TEMPORARY", "corrections": sum(a != b for a, b in zip(raw, candidate)), "length": len(candidate)})
    return candidates

def extract_plate_candidates(text, confidence):
    text = normalize_ocr_text(text)
    if not text: return []
    candidates = []
    for gen in [generate_temporary_candidates, generate_bh_candidates, generate_army_candidates, generate_standard_candidates]:
        for c in gen(text):
            c["ocr_confidence"] = float(confidence)
            c["score"] = float(confidence) + min(c["length"], 13) * 0.02 - c["corrections"] * 0.005
            candidates.append(c)
    return candidates

def build_ocr_sources(blocks):
    if not blocks: return []
    sources = [{"text": b["text"], "confidence": b["confidence"]} for b in blocks]
    sources.append({"text": "".join(b["text"] for b in blocks), "confidence": float(np.mean([b["confidence"] for b in blocks]))})
    for i in range(len(blocks)):
        for j in range(i + 2, min(i + 4, len(blocks) + 1)):
            group = blocks[i:j]
            sources.append({"text": "".join(b["text"] for b in group), "confidence": float(np.mean([b["confidence"] for b in group]))})
    return sources

def select_best_plate(blocks):
    all_candidates = []
    for source in build_ocr_sources(blocks):
        all_candidates.extend(extract_plate_candidates(source["text"], source["confidence"]))
    
    best = {}
    for c in all_candidates:
        key = (c["category"], c["text"])
        if key not in best or c["score"] > best[key]["score"]:
            best[key] = c
            
    filtered = list(best.values())
    if not filtered: return None
    filtered.sort(key=lambda c: c["score"], reverse=True)
    return filtered[0]

# ADAPTED FOR RAPIDOCR OUTPUT
def extract_ocr_blocks(ocr_result):
    if not ocr_result: return []
    blocks = []
    
    for item in ocr_result:
        poly, text, confidence = item[0], item[1], float(item[2])
        if confidence < OCR_CONFIDENCE: continue
        
        if str(text).strip().upper() in {"IND", "INO"}: continue
        normalized = normalize_ocr_text(text)
        if not normalized: continue
        
        x1, y1, x2, y2 = get_polygon_geometry(poly)
        blocks.append({"text": normalized, "confidence": confidence, "x1": x1, "y1": y1, "x2": x2, "y2": y2, "cy": (y1 + y2) / 2.0, "height": max(1.0, y2 - y1)})
        
    if blocks:
        blocks = sort_ocr_blocks(
            [b["text"] for b in blocks],
            [b["confidence"] for b in blocks],
            [[[b["x1"], b["y1"]], [b["x2"], b["y1"]], [b["x2"], b["y2"]], [b["x1"], b["y2"]]] for b in blocks]
        )
    return blocks

def get_all_candidates_from_blocks(blocks):
    """Generates all valid candidates for a single YOLO crop."""
    all_candidates = []
    for source in build_ocr_sources(blocks):
        all_candidates.extend(extract_plate_candidates(source["text"], source["confidence"]))
    return all_candidates

# MAIN CELERY WORKER TASK
@celery.task(name="process_anpr_pipeline")
def process_anpr_pipeline(task_id: str, file_paths: list, user_id: int):
    print(f"\n[Worker] 📥 Picked up task {task_id} | Analyzing {len(file_paths)} frames for User {user_id}")
    
    master_candidate_pool = []
    highest_yolo_conf = 0.0

    # 1. PROCESS ALL FRAMES
    for file_path in file_paths:
        img = cv2.imread(file_path)
        if img is None:
            continue

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
                        master_candidate_pool.extend(get_all_candidates_from_blocks(blocks))

    # 2. EVALUATE CANDIDATES OR HANDLE OCR FAILURE
    if not master_candidate_pool:
        print("[Worker] ⚠️ OCR Failed: No text detected/validated across any frames")
        plate_text = "NO TEXT DETECTED"
        category = None
        confidence_val = 0.0
        db_status = "OCR_FAILED"
    else:
        plate_groups = {}
        for c in master_candidate_pool:
            key = c["text"]
            if key not in plate_groups:
                plate_groups[key] = {"best_candidate": c, "count": 1, "max_score": c["score"]}
            else:
                plate_groups[key]["count"] += 1
                if c["score"] > plate_groups[key]["max_score"]:
                    plate_groups[key]["max_score"] = c["score"]
                    plate_groups[key]["best_candidate"] = c

        best_final_plate = None
        best_final_score = -1.0

        for key, group in plate_groups.items():
            frequency_bonus = (group["count"] - 1) * 0.15
            weighted_score = group["max_score"] + frequency_bonus
            
            if weighted_score > best_final_score:
                best_final_score = weighted_score
                best_final_plate = group["best_candidate"]

        final_conf = (0.7 * best_final_plate["ocr_confidence"] + 0.3 * highest_yolo_conf)
        plate_text = best_final_plate["text"]
        category = best_final_plate["category"]
        confidence_val = round(final_conf * 100, 2)
        db_status = "success"
        
        print(f"[Worker] ✅ Result: {plate_text} ({category}) | Seen in {plate_groups[plate_text]['count']} passes")

    # 3. SAVE TO MYSQL DATABASE
    db = SessionLocal()
    try:
        new_log = ANPRLog(
            user_id=user_id,
            task_id=task_id,
            image_path=file_paths[0] if file_paths else "",
            plate_number=plate_text,
            category=category,
            confidence=confidence_val,
            status=db_status
        )
        db.add(new_log)
        db.commit()
        print(f"[Worker] 💾 Saved {plate_text} to MySQL database for User {user_id}")
    except Exception as e:
        db.rollback()
        print(f"[Worker] ❌ Database Error: {e}")
    finally:
        db.close()

    # 4. RETURN FINAL RESULT TO REDIS
    return {
        "task_id": task_id,
        "plate": plate_text,
        "category": category,
        "confidence": confidence_val,
        "status": db_status
    }