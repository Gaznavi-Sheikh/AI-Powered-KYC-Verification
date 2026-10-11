# ML Service (Phase 9 — CNN + OCR + Groq + Graph + Final Decision Engine)

> **Scope of what's real here:** `/predict` runs real TFLite CNN
> inference, real EasyOCR text extraction, real Groq structured field
> extraction, real graph-based anomaly/risk signals, and now a
> deterministic **decision engine** that turns all of that into a final
> automated KYC state: `approved`, `suspicious`, `rejected`, or no
> decision at all (pending/error) when evidence is insufficient. **The
> decision engine is a rules engine, not a new model** — no new ML
> inference, no new Groq call, no combined "AI score." It is explicitly
> **not a statistically validated fraud classifier**: no labeled fraud
> dataset exists for this project, so "suspicious" means *"automated
> checks detected a risk signal requiring review,"* never *"fraud
> confirmed"* or a probability. There is no face matching, no liveness
> detection. "Approved" means *"passed the currently implemented
> automated checks,"* not *"guaranteed genuine."*

## Model

- **File**: `trained models/kyc_classifier.tflite` (project root, not
  copied into this service — loaded via a relative path, or override
  with `MODEL_PATH` in `.env`)
- **Architecture**: a small custom CNN (`Conv2D(32)→MaxPool→Conv2D(32)→
  MaxPool→Flatten→Dense(128)→Dense(64)→Dense(4, softmax)`), trained in
  `notebooks/Doc detection Notebooks/Document_Detection.ipynb` — **not**
  the EfficientNetV2 model from the other "KYC Identification" notebook,
  which saves a different `.keras` file and was never converted to
  TFLite.
- **Input**: shape `(1, 128, 128, 3)`, dtype `float32`, no quantization
  at the input/output boundary. Verified directly against the loaded
  model's `get_input_details()`/`get_output_details()`, not assumed.
- **Output**: shape `(1, 4)`, dtype `float32` — a softmax distribution
  over 4 classes.
- **Quantization**: internally INT8 (`TFLITE_BUILTINS_INT8` with a
  representative dataset), but `inference_input_type`/
  `inference_output_type` were explicitly kept `float32` at export time,
  so this service feeds/reads plain float32 arrays — no manual
  quantize/dequantize step is needed.

### Class labels

Verified against the label-creation and prediction cells in the source
notebook (not guessed):

| Model output index | Class | API slug |
|---|---|---|
| 0 | Aadhaar | `aadhaar` |
| 1 | PAN | `pan` |
| 2 | Passport | `passport` |
| 3 | Non-KYC Document | `unknown` |

The single source of truth for this mapping is `inference/classifier.py`
(`CLASS_NAMES` / `CLASS_SLUGS`) — nothing else in this service or in the
Node backend duplicates it.

### Preprocessing

`inference/preprocessing.py`: decode → convert to **RGB** → resize to
`128x128` → scale to `[0, 1]` (divide by 255) → `float32` → add batch
dimension.

**Known inconsistency in the source notebook, and the choice made here:**
the notebook's training-data loader used
`PIL.Image.open(...).convert('RGB')`, but its later demo/export cell
loaded test images with `cv2.imread` (which is BGR) and never converted
to RGB before feeding the model. That looks like an oversight in the
notebook, not the trained contract — this service preprocesses as RGB,
matching what the model actually saw during training. If real-world
accuracy looks off, this is the first assumption to revisit.

## OCR (EasyOCR)

- **Library**: EasyOCR, which requires a PyTorch backend — there is no
  lighter-weight option. **CPU-only** PyTorch/torchvision wheels are
  installed deliberately (`--extra-index-url
  https://download.pytorch.org/whl/cpu` in `requirements.txt`); the
  default PyPI build pulls in much larger CUDA dependencies this machine
  doesn't need. No GPU is required.
- **Languages**: `['en']` only. Every document type this service
  currently classifies can carry English text, so English-only proves
  extraction works. It does **not** handle non-Latin script well — see
  Known Limitations, where this was empirically observed on a real PAN
  sample (Hindi text came back garbled).
- **Initialization**: once at Flask startup (`inference/ocr.load_reader()`),
  not per-request. First run downloads ~98MB of model weights
  (detection + recognition) to `~/.EasyOCR/model/`; cached after that.
- **Decode path is separate from the CNN's**: the CNN resizes everything
  to 128×128 for classification, which would make text illegible. OCR
  (`inference/ocr.py`) decodes the original file bytes at full
  resolution independently.

## Setup

```bash
cd ml-service
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

No secrets are required for this phase.

## Running

```bash
python app.py
```

Default port **5001**. On startup you should see:

```
CNN model loaded successfully: kyc_classifier.tflite
EasyOCR reader initialized successfully (languages=['en'], CPU)
```

If either fails to load, the process still starts (so `/health` stays
reachable for monitoring) but reports it in `/health`, and `/predict`
degrades cleanly for that piece rather than faking a result.

## Endpoints

### `GET /health`

```json
{ "success": true, "service": "ml-service", "status": "healthy", "model_loaded": true, "ocr_loaded": true }
```

`status` is `"degraded"` if either `model_loaded` or `ocr_loaded` is `false`.

### `POST /predict`

`multipart/form-data`, field `document`.

| Case | Status | Response |
|---|---|---|
| No file | `400` | `{"success": false, "message": "No document file provided"}` |
| `.pdf` file | `400` | `{"success": false, "message": "PDF classification and OCR are not supported yet. ..."}` (see below) |
| Model not loaded | `503` | `{"success": false, "message": "Classification model is not available"}` |
| Undecodable/corrupted image | `400` | `{"success": false, "message": "Could not process the uploaded image. ..."}` |
| Valid JPG/PNG | `200` | see example below |

Example success response:
```json
{
  "success": true,
  "mock": false,
  "result": { "document_class": "aadhaar", "confidence": 0.9961 },
  "ocr": {
    "has_text": true,
    "raw_text": "INCOME TAX DEPARTMENT\nGOVT OF INDIA\nABCDE1234F",
    "detections": [
      { "text": "INCOME TAX DEPARTMENT", "confidence": 0.9907 },
      { "text": "GOVT OF INDIA", "confidence": 0.9145 },
      { "text": "ABCDE1234F", "confidence": 0.9779 }
    ]
  }
}
```
`result.confidence` is the CNN's softmax value — nothing hardcoded, no
extra threshold applied (see Known Limitations). `detections[].confidence`
is a **separate, unrelated** thing: EasyOCR's own per-text-region
confidence. Neither is a "KYC confidence," "verification confidence," or
"fraud confidence" — those concepts don't exist yet.

A valid image with no legible text is a normal outcome, not an error:
`{"has_text": false, "raw_text": "", "detections": []}` with `success: true`.

OCR failing for an image that otherwise classified fine does not fail
the whole request — `ocr` degrades to the empty-result shape above and
the CNN `result` is still returned.

### PDF behavior

The Node backend's multer config accepts JPEG/PNG/PDF for the identity
document. Neither the CNN nor EasyOCR here were exercised against PDFs,
and no PDF-to-image conversion was added (new dependency, scope creep).
A PDF upload still succeeds at the Node/MongoDB level (file saved,
record created, status `pending`), but both classification and OCR are
skipped — `docType` stays `"Pending Classification"`, `confidence` stays
`null`, and the upload response's `ocr` field is `null`.

## Groq (structured field extraction)

**Input**: CNN's `document_class` + OCR's `raw_text` only. The original
image is never sent to Groq this phase — the source of truth for
extraction is the already-extracted text, not the picture.

**Model choice**: `qwen/qwen3.8-27b` (configurable via `GROQ_MODEL`),
chosen empirically, not guessed. This account's live model catalog
(`client.models.list()`) does **not** include the classic small Llama
text models (`llama-3.1-8b-instant` etc.) that older Groq articles
mention — only `openai/gpt-oss-20b`, `openai/gpt-oss-120b`,
`qwen/qwen3.8-27b`, and a couple of narrow/non-general models. Real test
calls to all three general-purpose candidates showed:

| Model | Test result | Tokens used | Latency |
|---|---|---|---|
| `openai/gpt-oss-20b` | **empty output** at a small token budget | ~88 | 489ms |
| `openai/gpt-oss-120b` | **empty output** at a small token budget | ~88 | 413ms |
| `qwen/qwen3.8-27b` | correct answer | ~29 | 120ms |

The gpt-oss models are reasoning models that spend their token budget on
hidden reasoning before producing visible output — for a straightforward
text→JSON task with no multi-step reasoning needed, that makes them both
slower and more expensive per usable answer. A full PAN extraction with
`qwen/qwen3.8-27b` took only **161 total tokens** and 319ms. Given the
free-tier ceiling is a *shared, per-model* 8,000 tokens/minute and 1,000
requests/day (confirmed from this account's real rate-limit response
headers, not docs), `qwen/qwen3.8-27b` is the model most likely to let
this stay a genuinely free, long-running project.

`response_format: {"type": "json_object"}` (Groq's JSON mode) is used as
an extra reliability layer on top of the prompt instructions.

**Anti-hallucination prompt** (`inference/extractor._build_system_prompt`):
instructs the model to use only the supplied OCR text, never invent or
infer a value, never use outside knowledge to "correct" a value, return
`null` for anything not clearly present or ambiguous, and return only a
JSON object with exactly the expected keys for that document type.

**Server-side validation** (never trusts the LLM output directly):
1. The LLM is asked for a flat `{field: value}` object only — the
   `document_type`/`extraction_status` envelope is computed server-side,
   not trusted from the LLM, so there's nothing for it to get wrong there.
2. Only whitelisted keys for that document type are read from the
   response; anything else the LLM adds is silently dropped, never stored.
3. Deterministic format validation runs after the LLM, independent of
   it: PAN against `^[A-Z]{5}[0-9]{4}[A-Z]$`, Aadhaar against 12 digits
   (after stripping OCR-typical spaces/dashes), dates against a fixed
   list of explicit formats only — ambiguous dates become `null`, never
   a guess. No regex is applied to passport numbers (formats vary too
   much across countries to justify one).
4. `extraction_status` (`success`/`partial`/`no_data`/`error`) is
   computed from how many *validated* fields came back non-null — the
   LLM's own opinion of its status is never used.

**Non-KYC documents**: Groq is **not called at all** — `extraction_status`
is immediately `"not_applicable"`. Verified with a real non-document
upload, not just unit-tested.

**Empty OCR text**: Groq is **not called at all** — `extraction_status`
is immediately `"no_data"`. Both skips save API quota and avoid asking
the model to hallucinate from nothing.

**No fake "KYC confidence"**: `Verification.confidence` continues to
mean only the CNN's classification confidence, unchanged from Phase 5.
Groq does not produce a trustworthy confidence score for this project,
so none is combined, derived, or stored.

### `POST /predict` — now also returns `extraction`

```json
{
  "success": true,
  "mock": false,
  "result": { "document_class": "pan", "confidence": 0.9883 },
  "ocr": { "has_text": true, "raw_text": "...", "detections": [] },
  "extraction": {
    "document_type": "pan",
    "extraction_status": "success",
    "fields": {
      "name": "...",
      "pan_number": "...",
      "date_of_birth": "1994-03-10",
      "father_name": "..."
    }
  }
}
```
(Values here are illustrative — real extracted personal data is never
pasted into this README or into chat/commit history.)

## Graph anomaly/risk analysis (Phase 8)

**What this is NOT**: a fraud classifier, a trained model, or a
statistically validated anything. **No labeled fraud dataset exists for
this project** — there is no ground truth saying any given record is
fraudulent, so nothing could be trained to recognize fraud even if we
wanted to. This is a deterministic, explainable graph-statistics
heuristic: it detects when the *same* identifier (PAN/Aadhaar/passport
number, or name as a weaker signal) appears across *different users'*
records, and reports that as a risk **signal** — never a verdict.

### Why no GNN was trained

A graph neural network's value comes from learning embeddings across a
graph large and connected enough for patterns to be statistically
meaningful. This project's database has on the order of 15-20 real
Verification records (dev/demo scale). `torch-geometric` was confirmed
**pip-installable** in this environment (checked directly, not assumed
incompatible) — the decision to not use it is about data, not
dependencies: training anything on ~15-20 nodes would produce
embeddings that reflect noise and overfitting, not genuine learned
structure. Presenting that as a "trained graph model" would itself be a
form of fabrication. Deterministic graph statistics (`networkx`) give
the actual graph-theoretic primitives this phase needs (connected
components, node degree) without pretending to have learned anything.

### Architecture

Graph analysis runs as a 4th stage inside the same `/predict` call
(CNN → OCR → Groq → graph), not a separate endpoint. Flask has never had
its own MongoDB connection in this project, and that's preserved here:

```
Node (controllers/kyc.js)
  1. Queries OTHER users' prior Verification records with extracted fields
  2. Hashes their identifiers (backend/services/identityHash.js, SHA-256)
  3. Sends the file + these hashes + current user's ID to Flask /predict
       ↓
Flask (inference/graph.py)
  4. Hashes the CURRENT document's freshly-extracted fields (same algorithm)
  5. Compares hashes - builds a small in-memory graph for this one analysis
  6. Returns graphAnalysis in the same /predict response
```

**Raw identity values for any record other than the one in the current
request never reach Flask at all** — only SHA-256 hashes do. This is a
stronger privacy boundary than strictly required; it was a deliberate
design choice, not an accident.

**Critical correctness requirement**: Node's `normalizeIdentityValue()`
and Python's `_normalize_identity_value()` must produce byte-for-byte
identical output (trim → uppercase → strip all whitespace → SHA-256) for
the same real-world value, or genuine matches get silently missed since
Node computes hashes for prior records while Flask computes them
independently for the current one. Verified directly: compared both
implementations' output for the same test values and confirmed identical
hashes before considering this phase done.

### Graph nodes and edges

- **Verification nodes**: the current upload, plus any prior record that
  shares an identifier with it (not all prior records - only matches).
- **Identifier nodes**: one per distinct `(field_type, hash)` pair
  actually present in the current document's extracted fields -
  `pan_number`, `aadhaar_number`, `passport_number` (strong signals), and
  `name` (weak signal - names collide innocently far more often).
  **Phone and email are not nodes** - Phase 7's extraction schemas never
  produce those fields, and inventing fields Phase 7 doesn't provide
  would violate this phase's own constraints.
- **Edges**: Verification —connects-to→ Identifier, for every record
  (current or prior) that has that exact identifier hash.

### Scoring (deterministic, not learned)

```python
STRONG_MATCH_WEIGHT = 0.5   # per distinct other user sharing PAN/Aadhaar/passport
WEAK_MATCH_WEIGHT = 0.15    # per distinct other user sharing only name
anomalyScore = min(1.0, strong_count * 0.5 + weak_count * 0.15)
riskLevel = "high" if anomalyScore >= 0.5 else ("medium" if anomalyScore > 0 else "low")
```
A user re-uploading their *own* document (same identifier, same
`userId`) is explicitly excluded from these counts - that's normal
behavior, not an anomaly. These weights are configurable constants in
`inference/graph.py`, chosen to be simple and explainable, not fit to
any data (there is none to fit to).

**`anomalyScore` is a normalized graph-based risk/anomaly signal, not a
probability of fraud.** A score of 0.5 does not mean "50% chance of
fraud" - it means "one other user shares a strong identifier with this
document," which is itself just a signal worth human review, not proof
of anything.

### Status values (not interchangeable)

| `status` | Meaning |
|---|---|
| `success` | Comparison was performed; `anomalyScore`/`riskLevel` reflect real findings |
| `insufficient_data` | No prior records existed to compare against, OR this document had no extractable identifiers at all. **Never treated as "low risk"** - there's a real difference between "compared and found nothing" and "had nothing to compare." |
| `not_applicable` | CNN classified this as a non-KYC document - graph analysis (and Groq) are skipped entirely |
| `error` | An unexpected internal failure - CNN/OCR/extraction results from earlier stages are preserved regardless |

### `POST /predict` — now also returns `graphAnalysis`

```json
{
  "graphAnalysis": {
    "status": "success",
    "anomalyScore": 0.15,
    "riskLevel": "medium",
    "signals": ["Name is shared with 1 other user(s), with no strong identifier match"],
    "graphFeatures": {
      "connectedUsers": 1,
      "connectedVerifications": 1,
      "nodeDegree": 1,
      "connectedComponentSize": 3
    }
  }
}
```
(This is an actual sanitized response from a real cross-user test run
during Phase 8 development — two different test users uploaded the same
real PAN sample from this repo's dataset; OCR extracted the name
consistently but not the PAN number itself on this particular sample,
so only the name-level weak signal fired. No real personal values
appear above.)

## Final decision engine (Phase 9)

`inference/decision.py` is the single source of truth for the final
automated KYC decision. It is a **deterministic rules engine**, not a
model: same inputs always produce the same output, no network calls, no
randomness. It consumes only the CNN/OCR/Groq/graph results already
computed earlier in the *same* `/predict` request - it never re-runs
classification, OCR, extraction, or graph analysis.

### Why there is no combined AI score

CNN confidence (a softmax value), OCR status, Groq's extraction_status,
and the graph's anomalyScore (a heuristic, see Phase 8 section above)
measure fundamentally different things. Adding them together into one
number would be mixing units that don't mean the same thing - the
result would look precise while being meaningless. The decision engine
reads each signal **for what it actually means**, never blends them.

### Required fields (a Phase 9 policy choice, not a Phase 7 schema)

`extractor.py`'s `SCHEMAS` lists every field worth *attempting* to
extract; it doesn't say which are mandatory for a decision. Phase 9
defines its own minimum, reusing Phase 7's exact field names:

| Document type | Required fields |
|---|---|
| PAN | `name`, `pan_number` |
| Aadhaar | `name`, `aadhaar_number` |
| Passport | `passport_number`, and at least one of `surname`/`given_name` |

No new format validation is added here: `extractor.py`'s
`_validate_field()` already nulls out a PAN/Aadhaar number that fails
its deterministic regex before it ever reaches this module, so "field
is null" already means *"no valid value is available"* (whether OCR
never found it, or Groq found something that didn't pass Phase 7's own
format check) - re-implementing that regex here would duplicate
validation for no benefit.

### Decision table (matches the code exactly)

| Condition | `decision.status` | `decision.decision` | Verification `status` |
|---|---|---|---|
| CNN classified as non-KYC | `success` | `rejected` | `Rejected` |
| Document type unrecognized (safety net - should not occur) | `error` | `null` | unchanged (`Pending`) |
| Groq extraction failed (`extraction_status: "error"`) | `error` | `null` | unchanged |
| Graph analysis failed (`graphAnalysis.status: "error"`) | `error` | `null` | unchanged |
| OCR/extraction found nothing usable (`extraction_status: "no_data"`) | `pending` | `null` | unchanged |
| Required identity field(s) missing/invalid after a genuine extraction attempt | `success` | `rejected` | `Rejected` |
| Required fields present + strong cross-user identifier match | `success` | `suspicious` | `Suspicious` |
| Required fields present + only a weak (name-only) match, or no match | `success` | `approved` | `Approved` |
| Required fields present + graph status `insufficient_data` (nothing to compare against - a valid finding, not a failure) | `success` | `approved` | `Approved` |
| Entire pipeline unreachable (Flask down, CNN never ran) | `error` | `null` | unchanged |

**`status` on the Verification record only ever moves away from
`'Pending'` when `decision.status === 'success'`** - a processing
failure or insufficient evidence never becomes Approved, Rejected, or
Suspicious. This is the one rule every other rule in this table serves.

### Strong vs. weak signal - the exact mechanism

The decision engine does **not** derive strong-vs-weak logic itself
(Step 11 explicitly asks not to invent new graph logic). It reads
`graphAnalysis.signals` - a list of strings graph.py already produces -
and checks whether any entry **starts with** `"A strong identifier"`
(graph.py's exact, deliberate phrasing for a PAN/Aadhaar/passport
match). This was **not** a bare substring check initially - an early
version checked `"strong identifier" in signal.lower()`, which wrongly
matched graph.py's weak-signal string too (it reads *"...with no
**strong identifier** match"*). Caught by `test_9` in
`test_decision.py` and fixed to a prefix match before this phase was
considered done. A high `riskLevel` alone is deliberately **not** used
as a proxy for "strong match either - enough weak (name-only) matches
can mathematically reach the same score threshold on their own, and
that must never read as a strong-identifier signal.

### `ruleVersion`

A single constant, `decision.RULE_VERSION = "1.0"`, referenced
everywhere rather than hardcoded per branch - any future change to
these rules bumps this one place, keeping decisions traceable to the
rule version that produced them.

### `POST /predict` — now also returns `decision`

```json
{
  "decision": {
    "status": "success",
    "decision": "suspicious",
    "reasons": ["Strong identity relationship detected across different users"],
    "ruleVersion": "1.0"
  }
}
```
(Real sanitized output from a full-stack test: the same real PAN sample
from this repo's dataset uploaded by two different test users - no raw
PAN/name values appear in the reasons, by design.)

## How the Node backend uses this

`backend/services/mlService.js` is the only code that calls this
service (one call per upload — CNN, OCR, Groq extraction, graph
analysis, and the decision engine all run server-side in that same
Flask request/response). It needed no further changes for Phase 9 on
top of what Phase 8 already added (`current_user_id`/
`existing_identities`) - the new `decision` key arrived automatically,
same generic-passthrough pattern as every prior phase. It distinguishes
"Flask unreachable" (network failure) from "Flask reachable but
declined to process this file" (400/503) - in both cases the KYC upload
itself still succeeds; only
`docType`/`confidence`/`ocrText`/`extractedData`/`graphAnalysis`/`decision`
differ. The frontend never calls this service directly, and the
`GROQ_API_KEY` never leaves this Flask service (not Node, not the
browser). `controllers/kyc.js` is where `decision.decision` gets mapped
to the Verification-level `status` field (`approved→Approved`,
`suspicious→Suspicious`, `rejected→Rejected`) - only when
`decision.status === 'success'`.

## Storage decision (MongoDB)

- `Verification.ocrText: String` — the OCR's `raw_text` only (Phase 6).
- `Verification.extractedData: { documentType, extractionStatus, fields }`
  (Phase 7) — `fields` is a flexible `Mixed` object rather than dozens of
  top-level columns, because PAN/Aadhaar/Passport each have a different
  field set.
- `Verification.graphAnalysis: { status, anomalyScore, riskLevel, signals, graphFeatures }`
  (Phase 8) — `graphFeatures` is `Mixed` for the same reason.
- `Verification.decision: { status, decision, reasons, ruleVersion }`
  (Phase 9) — the decision engine's own output, stored as-is. No fraud
  score, GNN embedding, or combined AI score fields exist anywhere.
- `Verification.status` enum was extended from `['Approved', 'Pending',
  'Rejected']` to add `'Suspicious'` - a purely additive change (every
  existing document's `status` was already one of the original three
  values, so nothing becomes invalid). Phase 9 is the first phase
  allowed to move `status` away from `'Pending'`; see the decision table
  above for the exact mapping.

Per-detection OCR confidence and any Groq-side confidence are **not**
persisted - OCR confidence is per-text-region, not one meaningful
record-level number, and Groq does not provide a trustworthy confidence
score at all. `Verification.confidence` continues to mean only CNN
classification confidence - it is never combined with `anomalyScore`,
`decision`, or anything else into a single number.

`ocrText`, `extractedData`, `graphAnalysis`, and the full `decision`
object (reasons/ruleVersion) are all deliberately **not** included in
`GET /api/kyc/history`'s list response (which returns many records at
once, and all are more sensitive than
summary data) — only in the single-upload response, where the user just
uploaded that specific document. The data is still in MongoDB for later
phases to read server-side.

## Tests

```bash
pytest
```

68 tests across `tests/test_health.py`, `tests/test_classifier.py`,
`tests/test_ocr.py`, `tests/test_extractor.py`, `tests/test_graph.py`,
and `tests/test_decision.py`: health check, model/OCR/Groq-configured-
at-startup, real classification + OCR + extraction contract, blank-image
(empty OCR) handling, invalid/corrupted image handling, missing file,
PDF-unsupported response, real PAN/Aadhaar/Passport extraction (actual
Groq API calls, controlled synthetic OCR text - not real documents),
missing-field-returns-null, non-KYC/empty-OCR skip Groq entirely,
malformed-JSON handling, invalid PAN format rejection, ambiguous-date
rejection, Groq-unavailable handling, missing-API-key handling, shared-
PAN/Aadhaar/passport relationship detection, false-positive rejection,
cross-language hash normalization, same-user-reupload not flagged,
duplicate-identity-across-two-users, anomaly score bounds, risk level
boundaries, no-raw-values-in-logs, insufficient-data-vs-low-risk
distinction, graph-failure-doesn't-crash, and (Phase 9) approved/
suspicious/rejected/pending for each document type, missing/invalid
required fields, strong-vs-weak graph signal distinction, Groq/graph/CNN/
ML-unavailable all correctly never approving, reasons present and free
of raw identity values, no API-key/sensitive logging, rule-version
consistency, and same-inputs-produce-same-output determinism. No real or
dataset document images are committed; all Groq/graph/decision tests use
hand-written fictional text ("JOHN DOE", "ABCDE1234F", etc.), never
actual personal data.

## Model validation (Phase 5 sanity check)

Ran real inference on 3 labeled samples per class from this repo's own
`dataset/` folders (not committed anywhere, read only for this check):
**12/12 correct** (3/3 Aadhaar, 3/3 PAN, 3/3 Passport, 3/3 Non-KYC).
Also tested 4 synthetic out-of-distribution images (random noise, solid
gray/white/black): noise, gray, and white all correctly fell into
"Non-KYC Document"; solid black was misclassified as PAN at the lowest
confidence seen (0.656) of any test.

**This is a spot-check, not a formal accuracy evaluation.** There was no
held-out test split or confusion matrix re-run against the full
dataset — only this informal 12+4 sample check. Treat classification as
"works correctly on the cases tested," not as a validated accuracy
number.

## OCR quality check (Phase 6 sanity check)

Ran OCR on 6 real samples (2 per class) from this repo's own `dataset/`
folders (read only, nothing committed). Reported here as counts/stats
only, never the extracted text itself:

| Class | Sample | Image size | Detections | Chars | Avg OCR confidence | Time |
|---|---|---|---|---|---|---|
| Aadhaar | sample 1 | 972×612 | 15 | 168 | 0.414 | 2671ms |
| Aadhaar | sample 2 | 238×158 | 0 | 0 | — | 131ms |
| PAN | sample 1 | 640×640 | 26 | 235 | 0.758 | 1838ms |
| PAN | sample 2 | 640×640 | 14 | 108 | 0.289 | 1605ms |
| Passport | sample 1 | 1088×813 | 24 | 231 | 0.454 | 3671ms |
| Passport | sample 2 | 762×513 | 30 | 260 | 0.531 | 2121ms |

**5 of 6 returned non-empty text; 1 (a small 238×158 Aadhaar back-side
crop) returned zero detections** — likely too small/low-resolution, or
genuinely low-text content. No crashes. OCR confidence on real documents
(0.29–0.76) is visibly lower and more variable than on the clean
synthetic test image (0.91–0.99), which is expected — real photos have
skew, glare, and overlapping stamps/watermarks that clean synthetic text
doesn't.

**No accuracy percentage is reported** — there is no ground-truth
transcription to compare against, only "did it return plausible-looking
text or not."

## Extraction quality check (Phase 7 — do not treat as an accuracy claim)

Controlled-input testing only, per the phase's own instructions not to
claim accuracy from a handful of examples:

- **3 controlled synthetic OCR-text cases** (one per document type:
  PAN, Aadhaar, Passport), hand-written to include some fields and
  deliberately omit others. **3/3 correctly extracted present fields**
  and **correctly returned `null` for every absent field** (date of
  birth, father's name, passport issue date, place of birth, etc.) —
  no hallucinated values observed.
- **1 real end-to-end test** (Test 13: real PAN sample from this repo's
  `dataset/`, through the full React→Node→Flask→CNN→OCR→Groq→Node→
  MongoDB pipeline): all 4 PAN fields extracted with
  `extraction_status: "success"`. Not reproduced here — real-looking
  personal data, never pasted into docs/logs/reports.
- **Malformed-output and invalid-field-format handling** tested via
  direct unit tests (mocked LLM responses, and direct calls to the
  deterministic validators) rather than hoping to provoke these
  conditions from the real API on demand — confirmed to reject cleanly
  with no fabricated values in every case.

This is **not** a measurement of real-world extraction accuracy on
varied, noisy, real document photos — only "does the pipeline behave
correctly on the cases tested, including its failure paths." A proper
accuracy evaluation needs a labeled dataset and is out of scope here.

## Graph anomaly quality check (Phase 8 — explicitly not an accuracy claim)

There is no labeled fraud dataset, so there is nothing to measure
"accuracy" against - only whether the mechanism works as designed:

- **17 controlled unit tests** (fictional PAN/Aadhaar/passport values):
  shared identifiers across different users correctly produce a
  non-zero score and the right `graphFeatures` counts; different
  identifiers correctly produce zero; a user's own repeat upload is
  correctly excluded from the anomaly count; `insufficient_data` is
  correctly distinguished from a genuine zero/`"low"` score.
- **1 real full-stack test**: the same real PAN sample from this repo's
  `dataset/` uploaded as two different test users through the complete
  React→Node→Flask→CNN→OCR→Groq→graph→Node→MongoDB pipeline. The system
  correctly detected the identifier that OCR actually extracted
  consistently (`name`) and correctly did *not* claim a PAN-number match
  that didn't happen (that field came back `null` from OCR on this
  particular sample) - produced `riskLevel: "medium"`, not a
  false `"high"`.
- **Cross-language hash parity**: ran the same 4 test values through
  both Node's and Python's hashing implementations directly and
  confirmed byte-for-byte identical SHA-256 output for every case.

This confirms the mechanism behaves correctly on the cases tested,
including correctly reporting a weaker signal rather than inflating it
when only partial data was available. It says nothing about how well
this heuristic would actually catch real fraud, because there is no
labeled fraud data to evaluate that against.

## Performance (measured on this machine, CPU only)

**Decision engine (`decision.py`):**
- ~0.003ms per decision (1000 calls measured in 3.42ms total) — pure
  in-memory rule evaluation, no I/O, no model, negligible compared to
  every other stage in the pipeline.

**Graph analysis (`networkx`):**
- ~0.3ms for a 20-prior-record comparison (negligible next to CNN/OCR/Groq)
- The Node-side MongoDB query (prior records with extracted fields) and
  SHA-256 hashing add a small, unmeasured-but-clearly-sub-100ms overhead
  at current data volumes (~15-20 records) - not optimized or
  benchmarked further since "do not optimize prematurely" was explicit
  guidance for this phase; **will need revisiting if the dataset grows
  into the thousands**, since every upload currently queries and hashes
  every prior record with extracted data.

**Groq (`qwen/qwen3.8-27b`):**
- A full PAN extraction (system prompt + OCR text in, JSON fields out):
  **~161 total tokens, ~319ms**
- Free-tier ceiling for this model on this account (read from real
  rate-limit response headers): 1,000 requests/day, 8,000 tokens/minute
  — at ~161 tokens/request, the request-count limit binds before the
  token limit does

**CNN:**
- Model load time: ~5ms
- Inference time per image: ~2.2ms average (range 2.15–2.51ms, small 128×128 input)

**OCR (EasyOCR):**
- Reader initialization: ~24s on first run (one-time ~98MB model
  download), ~1.6s on subsequent runs once cached
- Processing time per image: ~340ms on a small synthetic test image;
  **1.6s–3.7s on real, full-resolution document photos** (much larger
  inputs, more detected text regions) — see table above

## Known Limitations

- Confidence values are visibly quantized (INT8 internal quantization
  snaps outputs to roughly 1/256-sized steps, e.g. `0.9961`, `0.9766`,
  `0.6562`) — treat `confidence` as a coarse signal, not a smooth
  probability.
- No formal CNN accuracy evaluation has been run (see Model Validation
  above) - only a 12+4 sample spot-check.
- PDF documents are not classified or OCR'd (see PDF behavior above).
- The RGB-vs-BGR preprocessing choice (see Preprocessing above) resolves
  a genuine inconsistency in the source notebook by matching the
  training data loader, not the notebook's own demo cell — if accuracy
  in production looks wrong, this is worth revisiting first.
- No confidence threshold is applied - the model's own top class/score
  is returned as-is, including for inputs that don't resemble any
  trained class well (e.g. the solid-black test above).
- **OCR is English-only and empirically struggles with non-Latin
  script.** Observed directly on a real PAN card sample during Phase 6
  testing: Hindi text came back as garbled characters
  (e.g. `"3tee6r"`, `"fatt"`) while the English portions
  ("INCOME TAX DEPARTMENT", "GOVT OF INDIA") extracted correctly. Indian
  Aadhaar/PAN documents commonly carry bilingual Hindi+English text -
  this is a real, observed limitation, not a theoretical one.
- OCR processing time on real document photos (1.6–3.7s) adds up with
  Groq's own latency (~0.3s) in the same request path - a full upload
  with all three stages can take several seconds end-to-end.
- A small/low-resolution image can legitimately return zero OCR
  detections (observed on a 238×158 sample) - this is treated as a valid
  empty result, not an error, per the phase's own instructions.
- **Extraction quality inherits OCR quality.** Since Groq only ever sees
  OCR's raw text (never the image), the known Hindi-text OCR garbling
  above means any field whose value was only present in Hindi on the
  original document will likely come back `null` - not because Groq
  failed, but because the text it was given never had that value in a
  form it could use. This is expected, not a bug, but worth knowing.
- Free-tier Groq quota (1,000 requests/day, 8,000 tokens/minute, shared
  per model across the whole account/org, not per API key) is the
  practical ceiling on how many documents can be processed per day on
  this setup.
- `qwen/qwen3.8-27b` was chosen from the models available to *this*
  account at the time of testing. Groq's catalog has changed before
  (classic Llama 3.x models used to be available and aren't anymore on
  this account) and may change again - if `GROQ_MODEL` starts failing,
  re-run the same empirical comparison in this README before picking a
  replacement, rather than assuming any specific model name stays valid.
- **Graph anomaly scoring is a heuristic, not a validated fraud
  signal** - no labeled fraud dataset exists for this project, and the
  weights (`STRONG_MATCH_WEIGHT`/`WEAK_MATCH_WEIGHT`) were chosen to be
  simple and explainable, not fit to any data. Treat `riskLevel`/
  `anomalyScore` as "worth a human look," never as a verdict.
- **Graph analysis only sees what Groq extracted** - if a document's PAN
  number came back `null` from OCR/Groq (a real, observed outcome - see
  the Phase 8 quality check above), graph analysis cannot compare on
  that field at all, even if two documents genuinely share the same PAN.
  Signal quality is capped by everything upstream of it.
- **Every upload currently queries and hashes every prior record with
  extracted data** - fine at current scale (~15-20 records), but will
  need a different approach (indexing, pre-computed hash lookups) if the
  dataset grows substantially. Not addressed this phase per explicit
  "do not optimize prematurely" guidance.
- The graph only ever contains the current document's own identifier
  nodes plus whichever prior records share one of them - it is *not* a
  persistent, continuously-updated graph of the whole database, just a
  fresh, minimal comparison built for each request. A richer persistent
  graph (enabling things like multi-hop relationship discovery) would be
  a meaningfully larger undertaking, not attempted here.
- `name` as a weak-identifier field will produce more false positives
  the more common a name is - two unrelated people named "RAJESH KUMAR"
  would register as a weak match. This is inherent to using name at all
  without any disambiguating context (DOB, address), and is exactly why
  it's weighted at 0.15 instead of 0.5.
- **Decision rules are a deliberate policy choice, not a derived or
  validated optimum.** There is no labeled outcome data to tune
  `REQUIRED_FIELDS` or the strong/weak signal distinction against - they
  were chosen to be simple, explainable, and conservative (never
  approving on incomplete evidence), not fit to data that doesn't exist.
- **Rejection on missing-required-fields cannot distinguish "OCR missed
  it" from "the value was invalid."** Both collapse to the same `null`
  in `extraction.fields` (Phase 7 already nulls invalid PAN/Aadhaar
  formats before this stage sees them) - this phase treats them
  identically (no valid value = not approvable) rather than trying to
  tell them apart, since the operative fact is the same either way.
- **Real test data showed meaningful rejection rates on real OCR
  quality** - of 6 real PAN samples from this repo's dataset tested
  during development, 4 were approved and 2 were rejected purely because
  OCR/Groq didn't extract both required fields on those particular
  images. This is the system working as designed (never approving on
  incomplete evidence) - but it does mean real-world approval rates will
  track OCR quality on the actual document photos submitted, not some
  fixed rate.
- **`Suspicious` as a Verification status is new this phase** and has no
  dedicated frontend workflow beyond displaying it (see "Frontend"
  below) - there's no reviewer queue, no way to resolve a suspicious
  record back to approved/rejected. That's explicitly out of scope
  (Phase 10 territory: "manual review dashboard").
