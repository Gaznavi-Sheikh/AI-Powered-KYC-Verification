import os
import time
from ai_edge_litert.interpreter import Interpreter
from .preprocessing import preprocess_image_bytes

# Single, explicit, verified mapping from the model's output index to a
# class label. Confirmed against the label-creation and prediction cells
# in notebooks/Doc detection Notebooks/Document_Detection.ipynb (not
# assumed): 0=Aadhaar, 1=PAN, 2=Passport, 3=Non-KYC Document.
CLASS_NAMES = ['Aadhaar', 'PAN', 'Passport', 'Non-KYC Document']

# The external API contract uses lowercase slugs. "unknown" for the
# Non-KYC class matches Phase 5's instructions exactly.
CLASS_SLUGS = {
    'Aadhaar': 'aadhaar',
    'PAN': 'pan',
    'Passport': 'passport',
    'Non-KYC Document': 'unknown'
}

_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_MODEL_PATH = os.path.join(_SERVICE_DIR, '..', 'trained models', 'kyc_classifier.tflite')

_interpreter = None
_input_details = None
_output_details = None
_load_error = None
_load_time_seconds = None


def load_model():
    """Loads the TFLite model once. Call this at Flask startup, not per-request."""
    global _interpreter, _input_details, _output_details, _load_error, _load_time_seconds

    model_path = os.environ.get('MODEL_PATH', DEFAULT_MODEL_PATH)

    try:
        t0 = time.time()
        interpreter = Interpreter(model_path=model_path)
        interpreter.allocate_tensors()
        _load_time_seconds = time.time() - t0

        _interpreter = interpreter
        _input_details = interpreter.get_input_details()
        _output_details = interpreter.get_output_details()
        _load_error = None
        print(f'CNN model loaded successfully: {os.path.basename(model_path)}')
        return True
    except Exception as exc:
        _interpreter = None
        _load_error = str(exc)
        # Do not pretend the model is working - log clearly and let
        # is_ready() report the real state.
        print(f'CNN model failed to load: {exc}')
        return False


def is_ready():
    return _interpreter is not None


def get_load_error():
    return _load_error


def get_load_time_seconds():
    return _load_time_seconds


def classify(file_bytes):
    """
    Returns (document_class_slug, confidence, inference_ms).
    Raises ValueError for undecodable image bytes.
    Raises RuntimeError if the model is not loaded.
    """
    if not is_ready():
        raise RuntimeError('Model is not loaded')

    input_tensor = preprocess_image_bytes(file_bytes)

    t0 = time.time()
    _interpreter.set_tensor(_input_details[0]['index'], input_tensor)
    _interpreter.invoke()
    output = _interpreter.get_tensor(_output_details[0]['index'])[0]
    inference_ms = (time.time() - t0) * 1000

    idx = int(output.argmax())
    confidence = float(output[idx])
    class_name = CLASS_NAMES[idx]
    slug = CLASS_SLUGS[class_name]

    return slug, confidence, inference_ms
