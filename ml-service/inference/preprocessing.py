import io
from PIL import Image
import numpy as np

# Verified against notebooks/Doc detection Notebooks/Document_Detection.ipynb
# (the actual code that produced trained models/kyc_classifier.tflite) and
# against the loaded model's own input tensor details - not assumed.
IMG_SIZE = (128, 128)


def preprocess_image_bytes(file_bytes):
    """
    Decode raw image bytes into the exact tensor shape/scale the model
    was trained on: RGB, resized to 128x128, scaled to [0, 1], float32,
    shape (1, 128, 128, 3).

    The source notebook's training-data loader used
    PIL Image.open(...).convert('RGB') (cells 22-25), so that is what this
    reproduces. Its later demo/export cell used cv2.imread (BGR) without
    converting to RGB before feeding the model - that looks like an
    oversight in the notebook, not the trained contract, so it is not
    reproduced here. See ml-service/README.md "Known Limitations".

    Raises ValueError if the bytes cannot be decoded as an image.
    """
    try:
        image = Image.open(io.BytesIO(file_bytes))
        image = image.convert('RGB')
        image = image.resize(IMG_SIZE)
    except Exception as exc:
        raise ValueError(f'Could not decode image: {exc}') from exc

    arr = np.array(image).astype(np.float32) / 255.0
    return np.expand_dims(arr, axis=0)
