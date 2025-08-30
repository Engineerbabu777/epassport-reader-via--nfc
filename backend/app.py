# app.py
import os
import base64
import cv2
import numpy as np
import uuid
import tempfile
import math
import logging
from flask import Flask, request, jsonify,send_file
from dotenv import load_dotenv
import hashlib
from Crypto.Cipher import DES3
from PIL import Image
import io
# Optional OCR libs
try:
    from passporteye import read_mrz
    HAVE_PASSEYE = True
except Exception:
    HAVE_PASSEYE = False

try:
    import easyocr
    HAVE_EASYOCR = True
    EASY_OCR_READER = easyocr.Reader(["en"], gpu=False)
except Exception:
    HAVE_EASYOCR = False
    EASY_OCR_READER = None

# PaddleOCR is optional; if installed will be used
try:
    from paddleocr import PaddleOCR
    HAVE_PADDLE = True
    PADDLE_READER = PaddleOCR(use_angle_cls=True, lang="en")
except Exception:
    HAVE_PADDLE = False
    PADDLE_READER = None

load_dotenv()
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

logging.basicConfig(level=logging.INFO)
app.logger.setLevel(logging.INFO)


# ---------- MRZ helpers ----------
_WEIGHTS = [7, 3, 1]


def derive_bac_keys(document_number, date_of_birth, date_of_expiry):
    """
    Generate BAC key (Kenc, Kmac) from MRZ info according to ICAO 9303 standard.
    """
    # 1. Pad document number to 9 characters with '<'
    doc_num_padded = (document_number + "<" * 9)[:9]
    
    # 2. Calculate check digits
    doc_num_cd = compute_check_digit(doc_num_padded)
    dob_cd = compute_check_digit(date_of_birth)
    expiry_cd = compute_check_digit(date_of_expiry)
    
    # 3. Construct MRZ information string (24 characters total)
    # Document number (9) + check digit (1) + DOB (6) + check digit (1) + Expiry (6) + check digit (1)
    mrz_info = doc_num_padded + doc_num_cd + date_of_birth + dob_cd + date_of_expiry + expiry_cd
    
    # 4. Ensure MRZ info is exactly 24 characters
    if len(mrz_info) != 24:
        raise ValueError(f"MRZ info should be 24 characters, got {len(mrz_info)}")
    
    # 5. Convert to bytes
    mrz_bytes = mrz_info.encode('utf-8')
    
    # 6. Calculate SHA-1 hash
    sha1_hash = hashlib.sha1(mrz_bytes).digest()
    
    # 7. Extract Kenc and Kmac (each 16 bytes)
    k_enc = sha1_hash[:16]
    k_mac = sha1_hash[16:32]  # Next 16 bytes
    
    # 8. Adjust parity for 3DES keys
    k_enc = DES3.adjust_key_parity(k_enc)
    k_mac = DES3.adjust_key_parity(k_mac)
    
    return k_enc, k_mac

def char_value(c):
    if c == "<":
        return 0
    if "0" <= c <= "9":
        return ord(c) - ord("0")
    if "A" <= c <= "Z":
        return ord(c) - ord("A") + 10
    return 0


def compute_check_digit(s):
    total = 0
    for i, ch in enumerate(s):
        total += char_value(ch) * _WEIGHTS[i % 3]
    return str(total % 10)

def clean_mrz_line(line: str) -> str:
    """
    Fix common OCR mistakes in MRZ lines.
    """
    # Replace K that appears in filler positions with <
    # Rule of thumb: if K is surrounded by < or at trailing positions, it's not a real K
    fixed = []
    for i, ch in enumerate(line):
        if ch == "K":
            # If this "K" is between <, or near the end (padding area), assume it's "<"
            if (i > 0 and line[i-1] == "<") or (i < len(line)-1 and line[i+1] == "<") or i > 25:
                fixed.append("<")
            else:
                fixed.append("K")
        else:
            fixed.append(ch)
    return "".join(fixed)

def postprocess_mrz_result(result: dict) -> dict:
    """
    Apply corrections to OCR output.
    """
    if "ocr_raw_lines" in result:
        cleaned_lines = [clean_mrz_line(l) for l in result["ocr_raw_lines"]]
        result["normalized_lines"] = cleaned_lines
        result["parsed"]["raw_lines"] = cleaned_lines

        # Re-extract names if needed
        if cleaned_lines[0].startswith("P<"):
            parts = cleaned_lines[0][2:].split("<<")
            if len(parts) >= 2:
                result["parsed"]["surname"] = parts[0].replace("<", "")
                result["parsed"]["given_names"] = parts[1].replace("<", " ")
    return result


def conservative_replace_k_runs(s):
    out = []
    i = 0
    n = len(s)
    while i < n:
        if s[i] in ("K", "k"):
            j = i
            while j < n and s[j] in ("K", "k"):
                j += 1
            run = j - i
            out.append("<" * run if run >= 2 else "K")
            i = j
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def normalize_line_text(s):
    if not isinstance(s, str):
        s = str(s)
    s = s.upper()
    s = s.replace("«", "<").replace("›", "<").replace("»", "<")
    s = s.replace(" ", "")
    s = conservative_replace_k_runs(s)
    # keep only valid MRZ chars
    allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
    return "".join(ch for ch in s if ch in allowed)


# ---------- Image preprocessing / detection ----------
def deskew_image(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, math.pi / 180.0, threshold=80, minLineLength=80, maxLineGap=10)
    if lines is None:
        return img
    angles = []
    for l in lines:
        x1, y1, x2, y2 = l[0]
        dx = x2 - x1
        dy = y2 - y1
        if dx == 0:
            continue
        angle = math.degrees(math.atan2(dy, dx))
        if abs(angle) < 45:
            angles.append(angle)
    if not angles:
        return img
    med = float(np.median(angles))
    if abs(med) < 0.5:
        return img
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), med, 1.0)
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def enhance_for_mrz(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    cl = clahe.apply(gray)
    den = cv2.bilateralFilter(cl, 9, 75, 75)
    th = cv2.adaptiveThreshold(den, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, 9)
    return cv2.cvtColor(th, cv2.COLOR_GRAY2BGR)


def detect_mrz_region(img, bottom_fraction=0.45):
    h, w = img.shape[:2]
    # focus on bottom_fraction of the image first
    start_y = int(h * (1 - bottom_fraction))
    bottom = img[start_y:, :].copy()
    gray = cv2.cvtColor(bottom, cv2.COLOR_BGR2GRAY)
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # Morphology to connect MRZ lines
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 6))
    connected = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(connected, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    for cnt in contours:
        x, y, cw, ch = cv2.boundingRect(cnt)
        aspect = cw / float(ch) if ch > 0 else 0
        # MRZ is wide and relatively low height
        if aspect > 4.5 and ch > 8:
            # convert coords back to original image
            candidates.append((x, start_y + y, cw, ch))
    if not candidates:
        # fallback: try larger kernel / whole image
        gray_w = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        _, bw2 = cv2.threshold(gray_w, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        kernel2 = cv2.getStructuringElement(cv2.MORPH_RECT, (50, 8))
        connected2 = cv2.morphologyEx(bw2, cv2.MORPH_CLOSE, kernel2)
        contours2, _ = cv2.findContours(connected2, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for cnt in contours2:
            x, y, cw, ch = cv2.boundingRect(cnt)
            aspect = cw / float(ch) if ch > 0 else 0
            if aspect > 6 and ch > 10 and y > h // 3:
                candidates.append((x, y, cw, ch))
    if not candidates:
        return None
    # pick candidate closest to bottom, widest
    candidates = sorted(candidates, key=lambda b: (b[1], -b[2]))
    x, y, cw, ch = candidates[0]
    pad_h = int(ch * 0.18)
    pad_w = int(cw * 0.03)
    y0 = max(0, y - pad_h); x0 = max(0, x - pad_w)
    y1 = min(h, y + ch + pad_h); x1 = min(w, x + cw + pad_w)
    roi = img[y0:y1, x0:x1].copy()
    return roi


# ---------- OCR wrappers ----------
def ocr_with_passporteye_path(path):
    if not HAVE_PASSEYE:
        return []
    try:
        mrz = read_mrz(path)
        if mrz is None:
            return []
        d = mrz.to_dict()
        raw = d.get("raw_text")
        if isinstance(raw, list):
            return [str(r) for r in raw if r]
        if isinstance(raw, str):
            return [ln for ln in raw.splitlines() if ln.strip()]
        # fallback: try mrz.text or mrz.mrz_text attributes
        for attr in ("mrz_text", "text"):
            val = d.get(attr) if isinstance(d, dict) else None
            if val:
                if isinstance(val, list):
                    return [str(v) for v in val]
                if isinstance(val, str):
                    return [ln for ln in val.splitlines() if ln.strip()]
    except Exception:
        return []
    return []

def ocr_with_easyocr_img(img_bgr):
    if not HAVE_EASYOCR:
        return []
    try:
        # easyocr expects BGR or RGB; we pass BGR
        results = EASY_OCR_READER.readtext(img_bgr, detail=0, paragraph=True)
        if isinstance(results, list):
            lines = []
            for r in results:
                if isinstance(r, str):
                    for ln in r.splitlines():
                        if ln.strip():
                            lines.append(ln.strip())
            return lines
    except Exception:
        return []
    return []

def ocr_with_paddle_img(img_bgr):
    if not HAVE_PADDLE:
        return []
    try:
        res = PADDLE_READER.ocr(img_bgr, cls=True)
        lines = []
        # Paddle returns nested structure
        for block in res:
            for item in block:
                try:
                    text = item[1][0]
                    if text and isinstance(text, str) and text.strip():
                        lines.append(text.strip())
                except Exception:
                    continue
        return lines
    except Exception:
        return []
    return []


# ---------- MRZ parsing TD3 ----------
def parse_td3(lines):
    out = {}
    # normalize length
    if len(lines) < 2:
        return out
    l0 = lines[0].ljust(44, "<")[:44]
    l1 = lines[1].ljust(44, "<")[:44]
    out["raw_lines"] = [l0, l1]
    out["type"] = l0[0:2]
    out["country"] = l0[2:5]
    names_field = l0[5:44]
    if "<<" in names_field:
        surname, given = names_field.split("<<", 1)
    else:
        parts = names_field.split("<", 1)
        surname = parts[0]
        given = parts[1] if len(parts) > 1 else ""
    out["surname_mrz"] = surname.replace("<", "").strip()
    out["given_names_mrz"] = " ".join([p for p in given.split("<") if p]).strip()
    # line 2 fields
    doc_num = l1[0:9]
    doc_num_cd = l1[9]
    nat = l1[10:13]
    bdate = l1[13:19]
    bdate_cd = l1[19]
    sex = l1[20]
    exp = l1[21:27]
    exp_cd = l1[27]
    pers = l1[28:42]
    pers_cd = l1[42]
    comp_cd = l1[43]
    out.update({
        "document_number": doc_num.replace("<", "").replace(">", ""),
        "document_number_cd": doc_num_cd,
        "nationality": nat,
        "date_of_birth": bdate,
        "date_of_birth_cd": bdate_cd,
        "sex": sex,
        "date_of_expiry": exp,
        "date_of_expiry_cd": exp_cd,
        "personal_number": pers.replace("<", "").replace(">", ""),
        "personal_number_cd": pers_cd.replace("<", "").replace(">", ""),
        "composite_check_digit": comp_cd,
    })
    # validation
    try:
        out["valid_document_number"] = (compute_check_digit(doc_num) == doc_num_cd)
    except Exception:
        out["valid_document_number"] = False
    try:
        out["valid_birth"] = (compute_check_digit(bdate) == bdate_cd)
    except Exception:
        out["valid_birth"] = False
    try:
        out["valid_expiry"] = (compute_check_digit(exp) == exp_cd)
    except Exception:
        out["valid_expiry"] = False
    try:
        out["valid_personal_number"] = (compute_check_digit(pers) == pers_cd)
    except Exception:
        out["valid_personal_number"] = False
    # composite
    composite_source = doc_num + doc_num_cd + pers + pers_cd + bdate + bdate_cd + exp + exp_cd
    try:
        out["valid_composite"] = (compute_check_digit(composite_source) == comp_cd)
    except Exception:
        out["valid_composite"] = False
    return out


# ---------- Ambiguity-correction solver ----------
COMMON_AMBIG = {
    "O": ["0", "O"],
    "Q": ["0", "Q"],
    "D": ["0", "D"],
    "0": ["0", "O", "Q", "D"],
    "I": ["1", "I", "L"],
    "L": ["1", "L"],
    "1": ["1", "I", "L"],
    "S": ["5", "S"],
    "5": ["5", "S"],
    "Z": ["2", "Z"],
    "2": ["2", "Z"],
    "B": ["8", "B"],
    "8": ["8", "B"],
    "A": ["4", "A"],
    "4": ["4", "A"],
}

from itertools import product, combinations

def try_fix_by_checksum(field_str, expected_cd, allow_letters=True, max_positions=6):
    """
    Try to replace ambiguous chars in field_str using COMMON_AMBIG candidates to match expected_cd.
    - allow_letters: True means letters allowed in this field (document numbers often have letters).
    Returns (fixed_str or None, attempts_made)
    """
    s = field_str.upper()
    positions = []
    candidates = []
    for i, ch in enumerate(s):
        if ch in COMMON_AMBIG:
            # keep only candidates that make sense for the field:
            cands = COMMON_AMBIG[ch]
            # if numeric field (allow_letters False) filter only digit candidates
            if not allow_letters:
                cands = [c for c in cands if c.isdigit()]
            # avoid identity-only
            if len(cands) > 1:
                positions.append(i)
                candidates.append(cands)
    # no ambiguous positions -> check directly
    if not positions:
        return (s if compute_check_digit(s) == expected_cd else None, 0)
    # limit combinatorial explosion
    if len(positions) > max_positions:
        # try single-position fixes first
        attempts = 0
        for idx, cands in zip(positions, candidates):
            for cand in cands:
                attempts += 1
                trial = list(s)
                trial[idx] = cand
                trial_s = "".join(trial)
                if compute_check_digit(trial_s) == expected_cd:
                    return trial_s, attempts
                if attempts > 2000:
                    return None, attempts
        return None, attempts
    # try all combos (product)
    attempts = 0
    for combo in product(*candidates):
        attempts += 1
        trial = list(s)
        for posi, repl in zip(positions, combo):
            trial[posi] = repl
        trial_s = "".join(trial)
        if compute_check_digit(trial_s) == expected_cd:
            return trial_s, attempts
        if attempts > 50000:
            break
    return None, attempts


# ---------- parse wrapper ----------
def try_parse_and_fix(lines):
    # normalize lines
    norm = [normalize_line_text(ln) for ln in lines if ln and isinstance(ln, str)]
    # if only one long line, attempt to split
    if len(norm) == 1:
        s = norm[0]
        if len(s) >= 88:
            norm = [s[0:44], s[44:88]]
        elif len(s) >= 72:
            norm = [s[0:36], s[36:72]]
    parsed = {}
    if len(norm) >= 2 and len(norm[0]) >= 10:
        parsed = parse_td3(norm[:2])
    else:
        parsed = {"raw_lines": norm}
        return parsed

    corrections = {}
    # If document number validation failed, attempt to fix
    if not parsed.get("valid_document_number", False):
        fixed, attempts = try_fix_by_checksum(parsed.get("document_number", ""), parsed.get("document_number_cd", ""), allow_letters=True)
        if fixed:
            corrections["document_number_before"] = parsed["document_number"]
            parsed["document_number"] = fixed
            parsed["valid_document_number"] = True
            corrections["document_number_after"] = fixed
            corrections["doc_attempts"] = attempts

    # DOB
    if not parsed.get("valid_birth", False):
        fixed, attempts = try_fix_by_checksum(parsed.get("date_of_birth", ""), parsed.get("date_of_birth_cd", ""), allow_letters=False)
        if fixed:
            corrections["date_of_birth_before"] = parsed["date_of_birth"]
            parsed["date_of_birth"] = fixed
            parsed["valid_birth"] = True
            corrections["date_of_birth_after"] = fixed
            corrections["birth_attempts"] = attempts

    # expiry
    if not parsed.get("valid_expiry", False):
        fixed, attempts = try_fix_by_checksum(parsed.get("date_of_expiry", ""), parsed.get("date_of_expiry_cd", ""), allow_letters=False)
        if fixed:
            corrections["date_of_expiry_before"] = parsed["date_of_expiry"]
            parsed["date_of_expiry"] = fixed
            parsed["valid_expiry"] = True
            corrections["date_of_expiry_after"] = fixed
            corrections["expiry_attempts"] = attempts

    # personal number
    if not parsed.get("valid_personal_number", False):
        fixed, attempts = try_fix_by_checksum(parsed.get("personal_number", ""), parsed.get("personal_number_cd", ""), allow_letters=False)
        if fixed:
            corrections["personal_number_before"] = parsed["personal_number"]
            parsed["personal_number"] = fixed
            parsed["valid_personal_number"] = True
            corrections["personal_number_after"] = fixed
            corrections["personal_attempts"] = attempts

    # Recompute composite if needed
    try:
        comp_src = parsed.get("document_number", "") + parsed.get("document_number_cd", "") + parsed.get("personal_number", "") + parsed.get("personal_number_cd", "") + parsed.get("date_of_birth", "") + parsed.get("date_of_birth_cd", "") + parsed.get("date_of_expiry", "") + parsed.get("date_of_expiry_cd", "")
        parsed["valid_composite"] = (compute_check_digit(comp_src) == parsed.get("composite_check_digit", ""))
    except Exception:
        parsed["valid_composite"] = parsed.get("valid_composite", False)

    # Names: replace digits with likely letters
    def fix_names(name_s):
        if not name_s:
            return name_s
        repl = {"1": "I", "0": "O", "5": "S", "2": "Z", "8": "B", "4": "A"}
        out = "".join(repl.get(ch, ch) for ch in name_s)
        out = out.replace("<", " ").strip()
        out = " ".join(out.split())
        return out

    parsed["surname"] = fix_names(parsed.get("surname_mrz", ""))
    parsed["given_names"] = fix_names(parsed.get("given_names_mrz", ""))

    # --- NEW: Generate BAC key ---
    try:
        doc_num = parsed.get("document_number", "")
        dob = parsed.get("date_of_birth", "")
        expiry = parsed.get("date_of_expiry", "")
        kenc, kmac = derive_bac_keys(doc_num, dob, expiry)
        parsed["bac_key"] = {
            "Kenc": kenc.hex(),
            "Kmac": kmac.hex()
        }
    except Exception as e:
        parsed["bac_key_error"] = str(e)

    return {"parsed": parsed, "corrections": corrections, "normalized_lines": norm}


# ---------- Flask endpoints ----------
@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/extract-mrz")
def extract_mrz_route():
    file_bytes = None
    # accept file or base64 JSON
    if "image" in request.files:
        file_bytes = request.files["image"].read()
    else:
        json_data = request.get_json(silent=True)
        if json_data and "base64" in json_data:
            b64 = json_data["base64"]
            if "," in b64:
                b64 = b64.split(",", 1)[1]
            try:
                file_bytes = base64.b64decode(b64)
            except Exception:
                return jsonify({"status": "error", "message": "Invalid base64"}), 400
    if not file_bytes:
        return jsonify({"status": "error", "message": "No image provided"}), 400

    tmp_files = []
    try:
        arr = np.frombuffer(file_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Unable to decode image")

        # Save orig debug
        os.makedirs("debug_images", exist_ok=True)
        orig_path = os.path.join("debug_images", f"orig_{uuid.uuid4()}.jpg")
        cv2.imwrite(orig_path, img)

        # deskew whole image quickly (helps detection)
        img_ds = deskew_image(img)
        # detect MRZ region
        roi = detect_mrz_region(img_ds, bottom_fraction=0.45)
        if roi is None:
            # fallback crop last 40%
            h = img_ds.shape[0]
            roi = img_ds[int(h * 0.58):, :].copy()

        # enhance ROI
        enhanced_roi = enhance_for_mrz(roi)
        roi_path = os.path.join("debug_images", f"roi_{uuid.uuid4()}.jpg")
        cv2.imwrite(roi_path, enhanced_roi)

        # Save enhanced ROI to temp for passporteye
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as t:
            cv2.imwrite(t.name, enhanced_roi)
            tmp_files.append(t.name)
            # Try passporteye first (gives MRZ-specific parsing often)
            ocr_lines = []
            if HAVE_PASSEYE:
                try:
                    ocr_lines = ocr_with_passporteye_path(t.name)
                except Exception:
                    ocr_lines = []
            # If passporteye empty, try Paddle/EasyOCR
            if not ocr_lines:
                if HAVE_PADDLE:
                    try:
                        ocr_lines = ocr_with_paddle_img(enhanced_roi)
                    except Exception:
                        ocr_lines = []
            if not ocr_lines and HAVE_EASYOCR:
                try:
                    ocr_lines = ocr_with_easyocr_img(enhanced_roi)
                except Exception:
                    ocr_lines = []

            if not ocr_lines:
                # last resort try passporteye on the original image file (some versions need whole doc)
                orig_tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
                cv2.imwrite(orig_tmp.name, img_ds)
                tmp_files.append(orig_tmp.name)
                if HAVE_PASSEYE:
                    ocr_lines = ocr_with_passporteye_path(orig_tmp.name)

        if not ocr_lines:
            return jsonify({"status": "error", "message": "MRZ not found or OCR failed", "debug_images": [orig_path, roi_path]}), 404

        # Normalize lines
        norm_lines = [normalize_line_text(ln) for ln in ocr_lines]

        # parse + fix
        result = try_parse_and_fix(norm_lines)

        response = {
            "status": "success",
            "ocr_raw_lines": ocr_lines,
            "normalized_lines": result.get("normalized_lines", norm_lines),
            "parsed": result.get("parsed", {}),
            "corrections": result.get("corrections", {}),
            "debug_images": [orig_path, roi_path]
        }
        return jsonify(response)

    except Exception as e:
        app.logger.exception("Unhandled error")
        return jsonify({"status": "error", "message": str(e)}), 500

    finally:
        for p in tmp_files:
            try:
                if p and os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass

def base64_to_cv2_img(base64_string: str):
    """Convert base64 string to OpenCV image"""
    try:
        base64_string = base64_string.replace("\n", "").replace(" ", "")
        if "," in base64_string:  # strip data:image/...;base64,
            base64_string = base64_string.split(",")[1]
        img_data = base64.b64decode(base64_string)
        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        print("Decode error:", e)
        return None


@app.route("/decode", methods=["POST"])
def decode():
    b64 = request.form.get("b64", "")

    img = base64_to_cv2_img(b64)
    if img is None:
        return jsonify({"error": "Invalid Base64 image"}), 400

    # Convert OpenCV (BGR) → PIL (RGB)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(img_rgb)

    # Save locally in uploads/
    file_path = os.path.join(UPLOAD_DIR, "decoded.png")
    pil_img.save(file_path)

    # Return JSON with path (or URL if deployed)
    return jsonify({
        "message": "Image decoded & saved",
        "file_path": file_path,
        "file_url": f"/files/decoded.png"  # route to serve it
    })


@app.route("/files/<filename>", methods=["GET"])
def get_file(filename):
    """Serve saved files back to client"""
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        return jsonify({"error": "File not found"}), 404
    return send_file(file_path, mimetype="image/png")



if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=True)
