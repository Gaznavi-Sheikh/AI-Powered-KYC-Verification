import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app


def test_health_check():
    # Test 1: GET /health -> 200, healthy
    client = app.test_client()
    response = client.get('/health')
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
    assert data['status'] == 'healthy'
    assert data['model_loaded'] is True


def test_predict_without_file():
    client = app.test_client()
    response = client.post('/predict')
    assert response.status_code == 400
    data = response.get_json()
    assert data['success'] is False
