## Chapter 2 — Source Code Reference: ML Service

All paths in this chapter are relative to `ml-service/`.

---

### File: `app.py` (157 lines)

**A. Purpose.** The Flask application itself: process entry point, model initialization at startup, and the two HTTP endpoints (`/health`, `/predict`) that make up the service's entire public surface.

**B. Execution Context.** Runs as `python app.py` (or under any WSGI server). Module-level code (lines 10–22) executes once, at import/startup time: it creates the Flask app and immediately calls `classifier.load_model()` and `ocr.load_reader()` — both are deliberately synchronous, blocking calls made once before the server starts accepting requests, not per-request.

**C. Imports and Dependencies.** `flask` (web framework), `python-dotenv` (`load_dotenv()` reads `ml-service/.env`), and the project's own `inference` package (`classifier`, `ocr`, `extractor`, `graph`, `decision` — each documented below).

**D. Functions and Constants**

- **`health()`** (lines 25–37), `GET /health`. No parameters. Calls `classifier.is_ready()`, `ocr.is_ready()`, `extractor.is_configured()` and returns `200` always, with a body whose `status` field is `"healthy"` only if all three are true, otherwise `"degraded"`. This endpoint never fails with a non-200 status — the degraded state is communicated in the body, not the HTTP status code.
- **`predict()`** (lines 40–151), `POST /predict`. This is the only inference endpoint. Step by step:
  1. Validates a `document` file was actually attached (multipart field name `document`); `400` if not.
  2. Rejects `.pdf` filenames outright with a `400` and an explicit message — neither the CNN nor EasyOCR were ever exercised against PDFs (comment, lines 51–54).
  3. `503` if the classifier failed to load at startup.
  4. Calls `classifier.classify(file_bytes)`. A `ValueError` (corrupt/undecodable image) becomes `400`; any other exception is logged server-side only and becomes a generic `500` — the real exception message is never sent to the client (line 78, "Do not leak internals").
  5. Runs OCR **unconditionally** if the reader is ready, regardless of what the CNN decided the document type is (comment, line 84) — a real document with no legible text is a valid outcome, not an error. OCR failures are caught and logged but never abort the request; `ocr_payload` falls back to an empty-but-well-formed shape.
  6. Calls `extractor.extract_fields(document_class, ocr_payload['raw_text'])` — by design this function never raises (see its own entry below).
  7. Reads `current_user_id` and `existing_identities` (a JSON array) from the multipart form fields, defensively parsing with a `try/except` that falls back to an empty list on any malformed JSON (lines 120–126).
  8. Calls `graph.analyze(...)`, then `decision.decide(...)`.
  9. Returns one `200` JSON body with five top-level keys: `result` (classification), `ocr`, `extraction`, `graphAnalysis`, `decision`. **Every one of these five stages' outputs is included even if that stage degraded** — there is no scenario where the response silently omits a stage.

**E. Execution Logic.** Strictly linear, no branching concurrency. Each stage's output is an input to a later stage only where documented (extraction feeds graph; all four feed decision) — the CNN and OCR stages do not depend on each other and could in principle run in parallel, but the current implementation runs them sequentially in one request thread.

**F. Input/Output.** Input: `multipart/form-data` with `document` (file), optional `current_user_id` (string) and `existing_identities` (JSON string, see `identityHash.js` in Chapter 3). Output: see §5.7 for a full example response body.

**G. Connections.** Called exclusively by `backend/services/mlService.js`'s `classifyDocument()` — never called directly by the frontend. Calls into all five `inference/` modules.

**H. Design Decisions.** Loading models once at startup (not per-request) is explicit and intentional (comment, line 12) — the trade-off is slower startup in exchange for every request after the first being fast. Returning `200` with a degraded body for `/health` rather than a `503` is also deliberate, letting a caller distinguish "service unreachable" from "service reachable but not fully ready."

**I. Failure Scenarios.** Missing/corrupt model file → `classifier.load_model()` returns `False` at startup, `/health` reports `model_loaded: false`, every `/predict` call returns `503`. Missing `GROQ_API_KEY` → service stays fully functional for classification/OCR; extraction degrades to `extraction_status: "error"` per request, never a crash. ML service process down entirely → `backend/services/mlService.js` reports `reachable: false` (see Chapter 3), and the backend still saves a `Pending` verification record rather than losing the upload.

**J. Example.** A `.pdf` upload: response is `{"success": false, "message": "PDF classification and OCR are not supported yet. ..."}`, HTTP `400`.

---

### File: `inference/classifier.py` (92 lines)

**A. Purpose.** Loads the trained TFLite CNN once and exposes a single `classify()` function that turns raw image bytes into a document-type slug and a confidence score.

**B. Execution Context.** `load_model()` is called once from `app.py` at startup. `classify()` is called once per `/predict` request, synchronously, on the request thread.

**C. Imports.** `ai_edge_litert.interpreter.Interpreter` — the lightweight TFLite runtime (deliberately not full TensorFlow; see `requirements.txt` comment, Chapter 8). `.preprocessing.preprocess_image_bytes`.

**D. Functions and Constants**
- **`CLASS_NAMES = ['Aadhaar', 'PAN', 'Passport', 'Non-KYC Document']`** (line 10) — index-to-label mapping, stated in the code comment to be "confirmed against the label-creation and prediction cells in `notebooks/Doc detection Notebooks/Document_Detection.ipynb`, not assumed."
- **`CLASS_SLUGS`** (lines 14–19) — maps the above human labels to the lowercase API slugs used everywhere else in the system (`aadhaar`, `pan`, `passport`, `unknown`).
- **`DEFAULT_MODEL_PATH`** (line 22) — computed relative to this file's own location: `<ml-service>/../trained models/kyc_classifier.tflite`. Overridable via the `MODEL_PATH` environment variable.
- **`load_model()`** (lines 31–55). No parameters. Side effect: sets module-level globals `_interpreter`, `_input_details`, `_output_details`. On any exception (missing file, corrupt model, incompatible format), catches it, sets `_load_error`, prints a clear message, and returns `False` — it never raises out of this function, and never leaves the module in a state where `is_ready()` would incorrectly report success.
- **`is_ready()`** — `True` iff `_interpreter is not None`.
- **`get_load_error()` / `get_load_time_seconds()`** — introspection only, not used by any route currently but available for diagnostics.
- **`classify(file_bytes)`** (lines 70–92). Parameter: raw image bytes. Raises `RuntimeError` if called before `load_model()` succeeded; raises `ValueError` (propagated from `preprocess_image_bytes`) for undecodable bytes. Logic: preprocess → set input tensor → `interpreter.invoke()` → read output tensor → `argmax()` to pick the winning class index → look up its name and slug. Returns a 3-tuple `(slug, confidence, inference_ms)`.

**E. Execution Logic.** No branching beyond the two documented exception paths. The entire inference is one forward pass through the interpreter — there is no retry, no ensembling, no post-processing beyond the argmax.

**F. Input/Output.** Input: raw `bytes` of an image file. Output example: `("pan", 0.9961, 42.3)`.

**G. Connections.** Called by `app.py`'s `predict()`. Calls into `preprocessing.py`.

**H. Design Decisions.** The confidence returned is the raw softmax probability of the winning class — it is a measure of how certain the model is about **document type**, nothing else. This distinction matters and is repeated throughout this manual because it is easy to misread "99.6% confidence" as "99.6% certain this is authentic," which it does not mean.

**I. Failure Scenarios.** Corrupt/non-image bytes → `ValueError`, surfaced by `app.py` as a `400`. Model file absent → `load_model()` fails at startup, every later `classify()` call is unreachable because `app.py` checks `is_ready()` first and returns `503`.

**J. Example.** See §1.3 regarding this model's real architecture (a small custom Conv2D/Dense network trained from scratch at 128×128 input, not a transfer-learning model) — detailed in Chapter 5.

---

### File: `inference/preprocessing.py` (34 lines)

**A. Purpose.** The single shared image-decoding function the CNN classifier depends on, kept in its own module so the exact preprocessing contract (and its provenance) is documented once and reused, not duplicated.

**B. Execution Context.** Called synchronously by `classifier.classify()`, once per request.

**C. Imports.** `PIL.Image`, `numpy`.

**D. Functions and Constants**
- **`IMG_SIZE = (128, 128)`** (line 8) — the code comment states this was verified two ways: against the training notebook's data-loading cells, and against the actually-loaded model's own input tensor shape. This is a directly-verified fact, not a guess.
- **`preprocess_image_bytes(file_bytes)`** (lines 11–34). Decodes bytes → `PIL.Image.open` → `.convert('RGB')` (so grayscale or RGBA input images are normalized) → `.resize((128,128))` → `numpy` array → cast to `float32` → divide by 255 (scale to `[0,1]`) → `np.expand_dims(axis=0)` to add the batch dimension the TFLite interpreter expects. Raises `ValueError` on any decode failure.

**E. Execution Logic.** Linear, no branches other than the single `try/except` around image decoding.

**F. Input/Output.** Input: raw bytes. Output: a `numpy.ndarray` of shape `(1, 128, 128, 3)`, dtype `float32`, values in `[0, 1]`.

**G. Connections.** Called only by `classifier.classify()`.

**H. Design Decisions.** The code comment (lines 17–22) flags a specific, verified discrepancy: the training notebook's own later demo/export cell used `cv2.imread` (which loads images in BGR channel order) without converting to RGB before feeding the model — which would be an inconsistency with the RGB-based training-data loader used during actual training. This file deliberately reproduces the **training-time** RGB contract, not the notebook's possibly-inconsistent demo cell, and says so explicitly. This is noted here as a documented, author-acknowledged known limitation, not resolved by this manual.

**I. Failure Scenarios.** Any bytes that `PIL` cannot open (corrupted file, non-image content, unsupported format) → `ValueError`, which `classifier.classify()` propagates and `app.py` turns into a `400`.

---

### File: `inference/ocr.py` (89 lines)

**A. Purpose.** Wraps EasyOCR: a one-time reader initialization and a per-request text-extraction function.

**B. Execution Context.** `load_reader()` runs once at `app.py` startup. `extract_text()` runs once per `/predict` call where the reader is ready.

**C. Imports.** `easyocr`, `PIL.Image`, `numpy`.

**D. Functions and Constants**
- **`LANGUAGES = ['en']`** (line 13) — English only. The code comment is explicit that this is a scope decision for this phase of the project ("prove text extraction works", not maximize multi-script recall), and flags that Aadhaar cards in particular often carry non-Latin script (e.g. Hindi) that this will not read.
- **`load_reader()`** (lines 20–40) — mirrors `classifier.load_model()`'s pattern exactly: try/except, sets `_reader`/`_load_error`, never raises, returns a boolean.
- **`is_ready()` / `get_load_error()` / `get_load_time_seconds()`** — same introspection pattern as the classifier module.
- **`extract_text(file_bytes)`** (lines 55–89). Decodes the image **independently** of the classifier's preprocessing — the code comment explains why (line 62–65): the CNN's 128×128 resize is far too small for legible text, so OCR needs the original resolution. Calls `_reader.readtext(arr)`, which returns a list of `(bounding_box, text, confidence)` tuples; this function discards the bounding box and returns a list of `{"text", "confidence"}` dicts plus `raw_text` (all detected text strings joined with newlines, in EasyOCR's natural reading order).

**E. Execution Logic.** Linear. Raises `RuntimeError` if the reader isn't initialized, `ValueError` if the bytes can't be decoded as an image.

**F. Input/Output.** Input: raw image bytes. Output: `(detections, raw_text, ocr_ms)`, e.g. `detections=[{"text": "INCOME TAX DEPARTMENT", "confidence": 0.94}, ...]`.

**G. Connections.** Called by `app.py`'s `predict()`. Its output (`raw_text`) feeds directly into `extractor.extract_fields()`.

**H. Design Decisions.** Running OCR on every document regardless of classification result (decided in `app.py`, not here) means this module has no document-type awareness at all — it is a generic text extractor, and all document-specific logic lives downstream in `extractor.py`.

**I. Failure Scenarios.** Reader not initialized (EasyOCR/PyTorch failed to load at startup — e.g. missing native library) → `app.py` never calls this function at all (`is_ready()` check first) and logs the reader was requested but unavailable. Undecodable bytes at this stage, despite having already passed the classifier's own decode step moments earlier, is treated by `app.py` as unusual but non-fatal — logged, not re-raised, OCR payload stays empty.

---

### File: `inference/extractor.py` (226 lines)

**A. Purpose.** Converts raw OCR text into a structured, document-type-specific JSON object using the Groq-hosted LLM, with deterministic validation on top of the LLM's output. This is the file with the most error-handling branches in the ML service.

**B. Execution Context.** `extract_fields()` is called once per `/predict` request, after OCR, before the graph stage. The Groq client itself is lazily constructed and cached on first real use (`_get_client()`), not at Flask startup — only a configuration check (`is_configured()`, no network call) happens at startup.

**C. Imports.** `groq.Groq` (the official SDK), `re`, `json`, `datetime`.

**D. Functions, Classes, Constants**
- **`GROQ_MODEL`** (line 13), default `qwen/qwen3.8-27b`, overridable via `GROQ_MODEL` env var. The code comment (lines 7–12) documents a specific, measured reason for this choice: on a free-tier account, this model answered a full PAN extraction in 161 total tokens / 319ms, while the account's available `gpt-oss` reasoning models spent their entire token budget on hidden reasoning and returned empty output at the same budget — making them both slower and effectively non-functional for this use case under the free-tier limits.
- **`GROQ_TIMEOUT_SECONDS = 15`, `GROQ_MAX_TOKENS = 500`** — request limits.
- **`SCHEMAS`** (lines 20–27) — the exact field list requested per document type:
  - `pan`: `name`, `pan_number`, `date_of_birth`, `father_name`
  - `aadhaar`: `name`, `aadhaar_number`, `date_of_birth`, `gender`, `address`
  - `passport`: `surname`, `given_name`, `passport_number`, `nationality`, `date_of_birth`, `sex`, `date_of_issue`, `date_of_expiry`, `place_of_birth`
- **`CNN_SLUG_TO_DOC_TYPE`** — maps the classifier's `unknown` slug to this module's `non_kyc`, everything else passes through unchanged.
- **`_PAN_RE`** — `^[A-Z]{5}[0-9]{4}[A-Z]$`, the exact statutory PAN format.
- **`_get_client()`** (lines 46–65) — lazy singleton. Returns `None` (never raises) if `GROQ_API_KEY` is unset or client construction fails, recording the reason in `_init_error`.
- **`_normalize_date(value)`** (lines 76–86) — tries six explicit date formats (`%d/%m/%Y`, `%d-%m-%Y`, `%d.%m.%Y`, `%Y-%m-%d`, `%d %B %Y`, `%d %b %Y`) in order; returns `None` (never a guessed date) if none match. The comment is explicit: "Ambiguous or unrecognized format — do not guess."
- **`_validate_field(field_name, value)`** (lines 89–114) — deterministic, non-LLM validation applied after the LLM responds. Dates go through `_normalize_date`. `pan_number` is uppercased, whitespace-stripped, and must match `_PAN_RE` or becomes `None`. `aadhaar_number` must be exactly 12 digits after stripping spaces/hyphens, or becomes `None`. Free-text fields (name, address, etc.) are kept as-is from the LLM but length-capped at 300 characters as a defensive measure — there is no deterministic correctness rule for free text.
- **`_build_system_prompt(doc_type, field_names)`** (lines 117–133) — constructs a 10-rule system prompt whose rules are worth stating verbatim because they are the actual anti-hallucination contract this project relies on: use only the supplied OCR text; never invent, guess, or infer; never use outside knowledge to "fix" a value; unclear/ambiguous fields must be `null`; never convert an uncertain value into a confident-looking one; return only a JSON object with exactly the requested keys; no extra keys; no explanatory text; every value is a string or `null`, never a number/boolean/object.
- **`extract_fields(cnn_slug, ocr_raw_text)`** (lines 136–226) — the main entry point. **Documented guarantee: this function never raises.** Every failure mode becomes a normal return value with an explicit `extraction_status`:
  - `cnn_slug` maps to `non_kyc` → returns immediately with `extraction_status: "not_applicable"`, **Groq is never called** (line 148–151) — the system will not ask an LLM to invent KYC fields for a document the CNN didn't recognize as a KYC type.
  - OCR text is empty/whitespace-only → `extraction_status: "no_data"`, Groq not called.
  - No Groq client available (missing/invalid key) → `extraction_status: "error"`.
  - The Groq API call itself raises any exception (auth failure, rate limit, timeout, network error) → caught, logged (the exception string only — never document content), `extraction_status: "error"`.
  - The response content isn't valid JSON, or isn't a JSON object → caught, logged, `extraction_status: "error"`.
  - Otherwise: only the schema's whitelisted keys are read from the LLM's JSON (any extra key the LLM added is silently dropped, line 211–216); each value passes through `_validate_field`. The final `extraction_status` is computed by counting non-null validated fields: `0` → `"no_data"`, all present → `"success"`, otherwise → `"partial"`.

**E. Execution Logic.** A sequence of early-return guard clauses (non-KYC, empty OCR, no client) followed by the actual API call wrapped in two separate `try/except` blocks (one for the network call, one for JSON parsing) — each with its own logged failure path, so a problem at one stage doesn't look like a problem at another when reading logs later.

**F. Input/Output.** Input: `cnn_slug` (e.g. `"pan"`), `ocr_raw_text` (string). Output example:
```json
{"document_type": "pan", "extraction_status": "success",
 "fields": {"name": "RAVI KUMAR", "pan_number": "ABCDE1234F",
            "date_of_birth": "1990-05-12", "father_name": "SURESH KUMAR"}}
```
(fictional values)

**G. Connections.** Called by `app.py`. Its output's `fields` dict is the direct input to `graph.hash_fields()`.

**H. Design Decisions.** `temperature=0` and `response_format={'type': 'json_object'}` (line 183–184) are both explicit choices to make the LLM's output as deterministic and parseable as possible, reducing (not eliminating) the JSON-parsing failure path.

**I. Failure Scenarios.** All six are enumerated in §D above — this is one of the few files in the codebase where every failure path was traced and given its own explicit status rather than a generic catch-all.

---

### File: `inference/graph.py` (185 lines)

**A. Purpose.** The deterministic, NetworkX-based risk signal — the replacement for the earlier, abandoned trained-GNN design (§1.2). Detects whether the current document's extracted identifiers (PAN/Aadhaar/passport number, name) also appear on a **different user's** prior record.

**B. Execution Context.** `analyze()` runs once per `/predict` request, after extraction, before the final decision.

**C. Imports.** `re`, `hashlib`, `networkx as nx`.

**D. Functions and Constants**
- **`STRONG_FIELDS = {'pan_number', 'aadhaar_number', 'passport_number'}`, `WEAK_FIELDS = {'name'}`** — a shared government ID number is treated as a much stronger signal than a shared name, since common names collide innocently far more often.
- **`STRONG_MATCH_WEIGHT = 0.5`, `WEAK_MATCH_WEIGHT = 0.15`, `MAX_ANOMALY_SCORE = 1.0`, `HIGH_RISK_THRESHOLD = 0.5`** (lines 13–16) — these are stated in the code comment to be deterministic, explainable, hand-chosen weights, **not learned from any dataset**.
- **`_normalize_identity_value(value)`** — trim, uppercase, strip all internal whitespace. The code comment is emphatic that this **must match `backend/services/identityHash.js`'s `normalizeIdentityValue()` byte-for-byte**, because Node and Python don't share code — any divergence silently breaks cross-record matching for values that are actually the same in the real world.
- **`_hash_identity_value(value)` / `hash_fields(fields)`** — SHA-256 of the normalized value. `hash_fields` extracts the three strong fields plus a combined name (for passports, `surname + " " + given_name`) and returns only the hashes that exist. **Used only for the current request's own fields** — hashes for every other record arrive already computed, via `existing_identities`, so this service never receives another user's raw PAN/Aadhaar/name.
- **`analyze(current_user_id, document_type, current_fields, existing_identities)`** (lines 72–185) — the main entry point. **Documented guarantee: never raises for expected conditions.**
  - `document_type == 'non_kyc'` → `status: "not_applicable"` immediately.
  - Nothing could be hashed from `current_fields` (extraction found nothing) → `status: "insufficient_data"`. The code comment is explicit that this is **not the same as "searched and found no risk"** — it means no search was possible at all.
  - No prior records exist anywhere → also `status: "insufficient_data"`.
  - Otherwise: builds an in-memory `networkx.Graph`. One node for the current document (`'current'`); one node per identifier hash the current document has; an edge from `'current'` to each identifier node. Then, for every prior record, for every identifier hash the current document has, if that *other* record has the same hash under the same field name, a node for that other record is added and connected to the shared identifier node — and, **only if the other record belongs to a different user** (`other_user_id != current_user_id`), that user is added to `strong_match_users` or `weak_match_users` depending on whether the shared field was a strong or weak one. A user's own repeat upload of their own document is explicitly excluded from counting as a match against themselves.
  - `strong_count` / `weak_count` are computed (weak count excludes anyone already counted as a strong match, to avoid double-counting one user twice).
  - Human-readable `signals` strings are built only when counts are non-zero (e.g. `"A strong identifier (PAN/Aadhaar/passport number) is shared with 2 other user(s)"`).
  - `anomaly_score = min(1.0, strong_count*0.5 + weak_count*0.15)`, rounded to 4 decimals.
  - `risk_level`: `"high"` if `anomaly_score >= 0.5`, `"medium"` if `> 0`, else `"low"`.
  - `graphFeatures` reports `connectedUsers`, `connectedVerifications`, `nodeDegree` (NetworkX's own `graph.degree()`), and `connectedComponentSize` (`nx.node_connected_component`) — these are the actual deterministic graph-theoretic primitives referenced throughout this project as the replacement for a trained GNN.
  - Any unexpected internal exception is caught at the outer level and becomes `status: "error"` with an empty result — never a fabricated score.

**E. Execution Logic.** One pass building the graph, one pass computing counts/score — no iteration beyond what's needed to compare the current document against every prior record once.

**F. Input/Output.** See §D for the full field-by-field output shape. Example (fictional): `{"status": "success", "anomalyScore": 0.5, "riskLevel": "high", "signals": ["A strong identifier (PAN/Aadhaar/passport number) is shared with 1 other user(s)"], "graphFeatures": {"connectedUsers": 1, "connectedVerifications": 1, "nodeDegree": 1, "connectedComponentSize": 3}}`.

**G. Connections.** Called by `app.py`. Reads `existing_identities`, which `backend/controllers/kyc.js` builds by querying every *other* user's prior `Verification` records and hashing their fields via `backend/services/identityHash.js` **before** this request is even sent (Chapter 4, §4.2).

**H. Design Decisions.** This is the file most directly tied to the project's central engineering decision — see Chapter 10 for the full rationale on why a deterministic graph replaced a trained model.

**I. Failure Scenarios.** Any NetworkX internal error (not expected in normal operation given the simple graph construction here) → caught, logged, `status: "error"`. Malformed `existing_identities` (not a list) is already defended against one layer up, in `app.py`.

---

### File: `inference/decision.py` (137 lines)

**A. Purpose.** The final, deterministic rules engine. Consumes the outputs of the four stages above and produces the one field (`decision.decision`) that actually represents a verdict.

**B. Execution Context.** `decide()` runs once per `/predict` request, last, after classification, OCR, extraction, and graph analysis are all already computed in the same request.

**C. Imports.** None beyond the standard library (pure rule logic, no model, no external call).

**D. Functions and Constants**
- **`RULE_VERSION = '1.0'`** — included in every decision result so a future rule change is traceable in stored records.
- **`REQUIRED_FIELDS`** — the minimum fields a decision can be reached without: `pan`: `name`, `pan_number`; `aadhaar`: `name`, `aadhaar_number`; `passport`: `passport_number` (passport's name requirement is handled specially, see below). The code comment clarifies this is a deliberate policy choice for this phase — a smaller, mandatory subset of `extractor.py`'s full `SCHEMAS`, not every field worth attempting to extract.
- **`_result(status, decision, reasons)`** — a small constructor returning the four-key shape `{status, decision, reasons, ruleVersion}`.
- **`_missing_required_fields(doc_type, fields)`** — returns the list of required fields that are `None`/absent. Passport is special-cased: the name requirement is satisfied by *either* `surname` or `given_name` being present (passports split the name into two fields; there's no single `name` field for them).
- **`_has_strong_graph_signal(graph_analysis)`** — checks whether `graph_analysis['signals']` contains a message starting with `"A strong identifier"` (matching `graph.py`'s exact wording for the strong-match case).
- **`decide(document_class, confidence, ocr_payload, extraction, graph_analysis)`** — the main entry point. In order:
  1. Defensive guard: if any of the four inputs is `None`, returns `status: "error"`. (Not reachable from the live `app.py` flow, which always supplies real dicts, but kept for standalone testability.)
  2. `document_class == 'non_kyc'` → `status: "success", decision: "rejected"`, reason `"Document was classified as a non-KYC document"`. This is treated as a **confident rejection**, not a processing gap — the CNN gave a real, decisive answer.
  3. `document_class` not one of the three known KYC types → `status: "error"` (a safety net only; the classifier's own slug mapping is a closed set, so this should not be reachable in practice).
  4. `extraction_status == 'error'` → `status: "error"`, reason `"Automated field extraction could not be completed"`. **A Groq failure is explicitly a processing failure, never evidence the document is invalid.**
  5. `graph_status == 'error'` → `status: "error"`, reason `"Automated risk analysis could not be completed"`.
  6. `extraction_status == 'no_data'` → `status: "pending"`, reason `"Insufficient data was extracted from the document to make a determination"`. **Insufficient OCR/extraction is insufficient evidence, not proof the document is bad.**
  7. From here, extraction succeeded (fully or partially) and graph analysis did not error. If any required field is still missing → `status: "success", decision: "rejected"`, reason `"Required identity field(s) could not be validated"`.
  8. If `graph_status == 'success'` and a strong graph signal was found → `status: "success", decision: "suspicious"`, reason `"Strong identity relationship detected across different users"`.
  9. Otherwise → `status: "success", decision: "approved"`, reasons `["Supported KYC document", "Required identity fields extracted successfully", "Deterministic identity validation passed", "No blocking graph anomaly detected"]` (exact reason text may vary slightly by code path; the four-reason shape is representative).

**E. Execution Logic.** A strict, ordered sequence of guard clauses — each one is checked only if all prior ones did not already return. This ordering is itself meaningful: processing failures (extraction/graph `error`) are checked and returned **before** any content-based rejection/approval logic runs, which is what guarantees a system failure never becomes a false "Approved" or a false "Rejected."

**F. Input/Output.** Output is always exactly `{status, decision, reasons: [...], ruleVersion}`. `status` is one of `success` / `pending` / `error`. `decision` is one of `approved` / `suspicious` / `rejected` / `null` (null whenever status isn't `success`).

**G. Connections.** Called last by `app.py`. Its output is persisted by `backend/controllers/kyc.js` into `Verification.decision`, and is also what moves the top-level `Verification.status` field away from `Pending` (see Chapter 6).

**H. Design Decisions.** Chapter 10 covers this in depth, but the single most important property of this file, verified directly by reading every branch above, is: **there is no code path in `decide()` that converts a processing failure or missing data into `approved` or `rejected`.** Those two decisive outcomes are reachable only through genuine, complete evidence.

**I. Failure Scenarios.** This file does not itself fail in the sense of raising exceptions under normal conditions — its entire job is to turn upstream failures into one of the three defined `status` values. A bug here would be a logic error (wrong branch reached), not a runtime crash; there is a dedicated pytest suite (`tests/test_decision.py`) covering these branches (Chapter 13).
