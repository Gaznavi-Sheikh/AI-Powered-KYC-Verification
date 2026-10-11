import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image, ImageDraw
from app import app
from inference import ocr


def _synthetic_text_image_bytes():
    """A tiny synthetic image with clearly rendered text - never a real document."""
    img = Image.new('RGB', (300, 80), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.text((10, 25), "TEST DOCUMENT 1234", fill=(0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format='JPEG')
    return buf.getvalue()


def _blank_image_bytes():
    img = Image.new('RGB', (200, 80), color=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format='JPEG')
    return buf.getvalue()


def test_ocr_reader_initialized_at_startup():
    # Test 1: OCR initialization
    assert ocr.is_ready() is True
    assert ocr.get_load_error() is None


def test_predict_with_text_image_returns_nonempty_ocr():
    # Test 2: synthetic image with clear text -> non-empty OCR
    client = app.test_client()
    data = {'document': (io.BytesIO(_synthetic_text_image_bytes()), 'text.jpg')}
    response = client.post('/predict', data=data, content_type='multipart/form-data')

    assert response.status_code == 200
    body = response.get_json()
    assert 'ocr' in body
    assert body['ocr']['has_text'] is True
    assert len(body['ocr']['detections']) > 0
    assert len(body['ocr']['raw_text']) > 0
    for detection in body['ocr']['detections']:
        assert 'text' in detection
        assert 'confidence' in detection
        assert 0.0 <= detection['confidence'] <= 1.0
    # CNN result must still be present and unaffected by OCR (Step 9)
    assert 'result' in body
    assert body['result']['document_class'] in ('aadhaar', 'pan', 'passport', 'unknown')


def test_predict_with_blank_image_returns_clean_empty_ocr():
    # Test 3: blank image -> clean empty OCR result, not an error
    client = app.test_client()
    data = {'document': (io.BytesIO(_blank_image_bytes()), 'blank.jpg')}
    response = client.post('/predict', data=data, content_type='multipart/form-data')

    assert response.status_code == 200
    body = response.get_json()
    assert body['success'] is True
    assert body['ocr']['has_text'] is False
    assert body['ocr']['raw_text'] == ''
    assert body['ocr']['detections'] == []


def test_predict_with_corrupted_image_has_clean_error():
    # Test 4: corrupted image -> clean error (shared with CNN's own check,
    # since corrupted bytes fail before OCR even runs)
    client = app.test_client()
    data = {'document': (io.BytesIO(b'not an image at all'), 'corrupted.jpg')}
    response = client.post('/predict', data=data, content_type='multipart/form-data')

    assert response.status_code == 400
    assert response.get_json()['success'] is False


def test_predict_missing_file_still_400():
    # Test 5: missing file -> 400 (unaffected by adding OCR)
    client = app.test_client()
    response = client.post('/predict')
    assert response.status_code == 400


def test_predict_pdf_still_unsupported():
    # Test 6: PDF -> clear unsupported response for OCR too
    client = app.test_client()
    data = {'document': (io.BytesIO(b'%PDF-1.4 fake pdf bytes'), 'identity.pdf')}
    response = client.post('/predict', data=data, content_type='multipart/form-data')

    assert response.status_code == 400
    body = response.get_json()
    assert body['success'] is False
    assert 'PDF' in body['message']
