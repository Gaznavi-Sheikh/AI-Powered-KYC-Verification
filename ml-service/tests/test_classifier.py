import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image
from app import app
from inference import classifier


def _synthetic_jpg_bytes(color=(120, 60, 200)):
    """A tiny solid-color synthetic image - never a real document."""
    img = Image.new('RGB', (128, 128), color=color)
    buf = io.BytesIO()
    img.save(buf, format='JPEG')
    return buf.getvalue()


def test_model_loaded_at_startup():
    # Test 2: model loading
    assert classifier.is_ready() is True
    assert classifier.get_load_error() is None


def test_predict_with_valid_image_returns_real_classification():
    # Test 3: valid test image -> mock=false, verified class, real confidence
    client = app.test_client()
    data = {'document': (io.BytesIO(_synthetic_jpg_bytes()), 'test.jpg')}
    response = client.post('/predict', data=data, content_type='multipart/form-data')

    assert response.status_code == 200
    body = response.get_json()
    assert body['success'] is True
    assert body['mock'] is False
    assert body['result']['document_class'] in ('aadhaar', 'pan', 'passport', 'unknown')
    assert isinstance(body['result']['confidence'], float)
    assert 0.0 <= body['result']['confidence'] <= 1.0


def test_predict_with_invalid_image_bytes():
    # Test 4: invalid "image" (not real image bytes) -> clean 4xx
    client = app.test_client()
    data = {'document': (io.BytesIO(b'this is not an image, just text bytes'), 'fake.jpg')}
    response = client.post('/predict', data=data, content_type='multipart/form-data')

    assert response.status_code == 400
    body = response.get_json()
    assert body['success'] is False


def test_predict_with_corrupted_image_bytes():
    # Test 5: corrupted image (truncated JPEG header) -> clean error, no crash
    client = app.test_client()
    truncated = _synthetic_jpg_bytes()[:10]  # cut off most of the file
    data = {'document': (io.BytesIO(truncated), 'corrupted.jpg')}
    response = client.post('/predict', data=data, content_type='multipart/form-data')

    assert response.status_code == 400
    body = response.get_json()
    assert body['success'] is False


def test_predict_missing_document_field():
    # Test 6: missing file -> 400
    client = app.test_client()
    response = client.post('/predict')
    assert response.status_code == 400
    assert response.get_json()['success'] is False


def test_predict_with_pdf_returns_clear_unsupported_response():
    # Test 7: unsupported document type for the CNN (PDF) -> clear response, not a crash
    client = app.test_client()
    data = {'document': (io.BytesIO(b'%PDF-1.4 fake pdf bytes'), 'identity.pdf')}
    response = client.post('/predict', data=data, content_type='multipart/form-data')

    assert response.status_code == 400
    body = response.get_json()
    assert body['success'] is False
    assert 'PDF' in body['message']
