import os
import json
from flask import Flask, request, jsonify
from dotenv import load_dotenv

from inference import classifier, ocr, extractor, graph, decision

load_dotenv()

app = Flask(__name__)

# Load once at startup, not per-request. If any fail, the process keeps
# running (so /health stays reachable) but is_ready()/is_configured()
# report false and /predict degrades that piece cleanly instead of
# faking a result. Checking Groq configuration here is just "is the key
# present" - no network call, so no quota is spent at startup.
classifier.load_model()
ocr.load_reader()
if extractor.is_configured():
    print(f'Groq extraction configured (model={extractor.GROQ_MODEL})')
else:
    print(f'Groq extraction NOT configured: {extractor.get_init_error()}')


@app.route('/health', methods=['GET'])
def health():
    model_ready = classifier.is_ready()
    ocr_ready = ocr.is_ready()
    groq_ready = extractor.is_configured()
    return jsonify({
        "success": True,
        "service": "ml-service",
        "status": "healthy" if (model_ready and ocr_ready and groq_ready) else "degraded",
        "model_loaded": model_ready,
        "ocr_loaded": ocr_ready,
        "groq_configured": groq_ready
    }), 200


@app.route('/predict', methods=['POST'])
def predict():
    if 'document' not in request.files or request.files['document'].filename == '':
        return jsonify({
            "success": False,
            "message": "No document file provided"
        }), 400

    file = request.files['document']
    filename = (file.filename or '').lower()

    # Neither the CNN nor EasyOCR here work on PDFs - both were exercised
    # only against JPEG/PNG images (see dataset structure in
    # ml-service/README.md). PDFs are accepted by the Node upload endpoint
    # but are not supported for classification or OCR here.
    if filename.endswith('.pdf'):
        return jsonify({
            "success": False,
            "message": "PDF classification and OCR are not supported yet. Only JPG, JPEG, and PNG images can be processed at this time."
        }), 400

    if not classifier.is_ready():
        return jsonify({
            "success": False,
            "message": "Classification model is not available"
        }), 503

    try:
        file_bytes = file.read()
        document_class, confidence, inference_ms = classifier.classify(file_bytes)
    except ValueError:
        # Undecodable/corrupted image bytes.
        return jsonify({
            "success": False,
            "message": "Could not process the uploaded image. It may be corrupted or in an unsupported format."
        }), 400
    except Exception as exc:
        # Do not leak internals (file paths, model details, tracebacks).
        app.logger.error(f'Inference error: {exc}')
        return jsonify({
            "success": False,
            "message": "Classification failed due to an internal error."
        }), 500

    # OCR runs regardless of which class the CNN picked - a valid image
    # that happens to have no legible text is a normal outcome (Step 15),
    # not an error. OCR failure, though, must not take down the whole
    # response when classification already succeeded - degrade cleanly.
    ocr_payload = {"has_text": False, "raw_text": "", "detections": []}
    if ocr.is_ready():
        try:
            detections, raw_text, ocr_ms = ocr.extract_text(file_bytes)
            ocr_payload = {
                "has_text": len(detections) > 0,
                "raw_text": raw_text,
                "detections": detections
            }
        except ValueError:
            # Same bytes just succeeded CNN preprocessing, so this would
            # be unusual, but don't let it crash the whole request.
            app.logger.error('OCR could not decode an image that passed CNN preprocessing')
        except Exception as exc:
            app.logger.error(f'OCR error: {exc}')
    else:
        app.logger.error('OCR requested but reader is not initialized')

    # Structured field extraction (Phase 7). extract_fields() never
    # raises - it internally skips the Groq call for non-KYC documents
    # and empty OCR text, and returns extraction_status="error" rather
    # than fabricating data on any Groq failure. The CNN result above is
    # already finalized and unaffected either way.
    extraction = extractor.extract_fields(document_class, ocr_payload['raw_text'])

    # Graph-based anomaly/risk signal (Phase 8). existing_identities is a
    # JSON array Node computed BEFORE this request from other users'
    # already-stored records - already hashed there
    # (backend/services/identityHash.js), so this service never receives
    # another user's raw PAN/Aadhaar/passport/name value. current_user_id
    # identifies the requester so a user's own repeat upload of their own
    # document isn't flagged as a cross-user match.
    current_user_id = request.form.get('current_user_id') or None
    try:
        existing_identities = json.loads(request.form.get('existing_identities', '[]'))
        if not isinstance(existing_identities, list):
            existing_identities = []
    except (TypeError, ValueError):
        existing_identities = []

    graph_analysis = graph.analyze(
        current_user_id,
        extraction['document_type'],
        extraction['fields'],
        existing_identities
    )

    # Final KYC decision (Phase 9). Deterministic rules only, consuming
    # the results already computed above in this same request - never
    # calls the CNN, OCR, Groq, or graph analysis again.
    decision_result = decision.decide(document_class, confidence, ocr_payload, extraction, graph_analysis)

    return jsonify({
        "success": True,
        "mock": False,
        "result": {
            "document_class": document_class,
            "confidence": round(confidence, 4)
        },
        "ocr": ocr_payload,
        "extraction": extraction,
        "graphAnalysis": graph_analysis,
        "decision": decision_result
    }), 200


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug)
