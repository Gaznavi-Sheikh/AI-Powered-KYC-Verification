import io
import time
import numpy as np
from PIL import Image
import easyocr

# English only for Phase 6. This project's current document types
# (Aadhaar/PAN/Passport) often carry English text even when a document
# also has non-Latin script (e.g. Hindi on Aadhaar) - OCR scope this
# phase is "prove text extraction works", not "maximize recall across
# every script". See README "Known Limitations" for the non-English-text
# caveat.
LANGUAGES = ['en']

_reader = None
_load_error = None
_load_time_seconds = None


def load_reader():
    """Initializes the EasyOCR Reader once. Call at Flask startup, not per-request."""
    global _reader, _load_error, _load_time_seconds

    try:
        t0 = time.time()
        reader = easyocr.Reader(LANGUAGES, gpu=False)
        _load_time_seconds = time.time() - t0

        _reader = reader
        _load_error = None
        print(f'EasyOCR reader initialized successfully (languages={LANGUAGES}, CPU)')
        return True
    except Exception as exc:
        _reader = None
        _load_error = str(exc)
        # Do not pretend OCR is working - log clearly and let is_ready()
        # report the real state. Never log document content here (there
        # is none at init time, but keep the pattern consistent).
        print(f'EasyOCR failed to initialize: {exc}')
        return False


def is_ready():
    return _reader is not None


def get_load_error():
    return _load_error


def get_load_time_seconds():
    return _load_time_seconds


def extract_text(file_bytes):
    """
    Returns (detections, raw_text, ocr_ms).
      detections: list of {"text": str, "confidence": float}, in the
        order EasyOCR returns them (its natural reading order).
      raw_text: detections' text joined with newlines ("" if none found).

    Deliberately decodes file_bytes independently of the CNN's
    preprocessing (inference/preprocessing.py), which resizes to 128x128
    for classification - that resolution is far too small for legible
    text. OCR runs on the image at its original resolution.

    Raises ValueError for undecodable image bytes.
    Raises RuntimeError if the reader is not initialized.
    """
    if not is_ready():
        raise RuntimeError('OCR reader is not initialized')

    try:
        image = Image.open(io.BytesIO(file_bytes)).convert('RGB')
        arr = np.array(image)
    except Exception as exc:
        raise ValueError(f'Could not decode image: {exc}') from exc

    t0 = time.time()
    results = _reader.readtext(arr)
    ocr_ms = (time.time() - t0) * 1000

    detections = [
        {"text": text, "confidence": round(float(conf), 4)}
        for (_bbox, text, conf) in results
    ]
    raw_text = '\n'.join(d['text'] for d in detections)

    return detections, raw_text, ocr_ms
