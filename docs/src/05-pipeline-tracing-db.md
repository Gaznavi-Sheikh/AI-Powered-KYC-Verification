## Chapter 5 — ML Pipeline Summary and Terminology

Chapter 2 documents each ML-service file in full; this chapter consolidates the pipeline as a whole and is explicit about the four different numbers the system produces, which must not be confused with one another.

### 5.1 The Four Numbers

| Term | Produced by | Range | What it actually measures |
|---|---|---|---|
| Classification confidence | `classifier.py` (`classify()`) | `[0, 1]` softmax | How certain the CNN is about **document type** (Aadhaar/PAN/Passport/Non-KYC). Says nothing about authenticity. |
| Extraction status | `extractor.py` (`extract_fields()`) | categorical: `success`/`partial`/`no_data`/`error`/`not_applicable` | Whether structured fields could be read from the OCR text — a data-completeness signal, not a score. |
| Anomaly score | `graph.py` (`analyze()`) | `[0, 1]`, `min(1, 0.5·strong + 0.15·weak)` | A deterministic count of how many *other users* share this document's strong/weak identifiers — a connectivity measure, not a learned probability. |
| Decision | `decision.py` (`decide()`) | `approved` / `suspicious` / `rejected` / `null` | The only field that is an actual verdict, computed from fixed rules applied to the three numbers above plus required-field presence. |

### 5.2 Model and Dataset Inventory

| Artifact | Format | Produced by | Loaded by | Tracked in git? |
|---|---|---|---|---|
| `trained models/kyc_classifier.tflite` | TFLite (INT8-quantized) | `notebooks/Doc detection Notebooks/Document_Detection.ipynb` | `inference/classifier.py` | **No — was tracked, currently deleted from the working tree.** The ML service cannot start without it. |
| EasyOCR's own pretrained weights | PyTorch, downloaded by the `easyocr` package itself on first use | A third party (EasyOCR project), not this repository | `inference/ocr.py` | No — not part of this repository at all; downloaded automatically by the library. |
| Groq-hosted LLM (`qwen/qwen3.8-27b` by default) | Hosted API, no local file | N/A — external service | `inference/extractor.py` | N/A |

Three `.pth` GNN checkpoints and three `.npy` HOG feature files existed in `trained models/` earlier in this project's history and were confirmed, by direct code inspection, to be loaded by **no code path** in the current `ml-service/` — they belonged to the abandoned design in §1.2 and were removed during repository cleanup.

### 5.3 Pipeline Sequence

![ML inference sequence](diagrams/ml-pipeline-sequence.png)

*Figure 5.1 — the actual, verified order of operations inside one `POST /predict` call, as traced through `app.py`. Stages 1 and 2 (classification, OCR) do not depend on each other and run in this order only because the code happens to call them sequentially, not because of a data dependency between them; stages 3 and 4 each depend on stage 2's and stage 3's output respectively; stage 5 depends on all four prior outputs.*

### 5.4 What This Pipeline Does Not Establish

Stated plainly, because the project's own disclaimers depend on this: the CNN confirms a document *looks like* a given type's layout; OCR and the LLM extract *what text is printed on it*; the graph stage detects *whether the same identifier appears elsewhere in this system's own database*. **None of these four stages performs image forensics, face matching, hologram/security-feature verification, or any check against an external government identity registry.** A well-made fake document with internally consistent, unique-looking text would not be caught by this pipeline — this is stated explicitly rather than left implicit, per the project's own "do not overstate" requirement.

---

## Chapter 6 — Database and Data Lifecycle

### 6.1 Collections

Already introduced in Chapter 3's model entries; this section adds the lifecycle view.

**`User`** — durable, one document per account for the life of the account. **`Verification`** — durable, one document per upload, never updated after its ML fields are populated (no "edit a past verification" feature exists anywhere in the code). **`EmailVerification` / `LoginOtp` / `PasswordReset`** — each lives for, at most, `OTP_EXPIRY_MINUTES` (10) or `RESET_TOKEN_EXPIRY_MINUTES` (15), and is explicitly deleted by the controller on successful use, or swept by MongoDB's TTL index if left unused until expiry.

### 6.2 Verification Record Lifecycle (traced through actual code)

1. **Created** — `controllers/kyc.js`'s `verifyDocuments()`, immediately after file upload validation, with `status: 'Pending'` and placeholder `docType`. This happens **before** the ML call, so a crash or timeout talking to the ML service still leaves a real, queryable record.
2. **Enriched** — if the ML service was reachable, the same function writes `docType`, `confidence`, `ocrText`, `extractedData`, `graphAnalysis`, `decision` onto the same document and saves it once.
3. **Status promotion** — only if `decision.status === 'success'` does `status` move away from `Pending`.
4. **Read** — `getHistory()`, filtered by ownership (non-admin) or optionally by name (admin), sorted by `-date`.
5. **No deletion path exists anywhere in the codebase.** There is no endpoint, script, or scheduled job that removes a `Verification` document or its associated uploaded file. This is listed again in Chapter 12 as a real, verified retention gap for a system that processes identity documents.

![Data relationships](diagrams/data-persistence.png)

*(Same figure as Chapter 1, repeated here for chapter-local reference.)*

### 6.3 Representative Documents (fictional data only)

```json
// User
{
  "_id": "65f0...", "name": "Asha Rao", "email": "asha@example.com",
  "role": "user", "emailVerified": true, "twoFactorEnabled": true,
  "createdAt": "2026-01-15T09:00:00Z"
  // password: <bcrypt hash, select:false, never returned by default>
}
```

```json
// Verification
{
  "_id": "65f1...", "user": "65f0...", "name": "Asha Rao", "initials": "AR",
  "docType": "pan", "confidence": 0.9961, "status": "Approved",
  "originalFilename": "pan_card.jpg",
  "extractedData": {
    "documentType": "pan", "extractionStatus": "success",
    "fields": { "name": "ASHA RAO", "pan_number": "ABCDE1234F",
                "date_of_birth": "1995-03-20", "father_name": "RAMESH RAO" }
  },
  "graphAnalysis": { "status": "success", "anomalyScore": 0, "riskLevel": "low",
                      "signals": [], "graphFeatures": { "connectedUsers": 0 } },
  "decision": { "status": "success", "decision": "approved",
                "reasons": ["Supported KYC document", "Required identity fields extracted successfully"],
                "ruleVersion": "1.0" }
}
```

---

## Chapter 7 — End-to-End Execution Traces

Each trace below lists the real function call sequence, file by file, for one user-visible workflow. "Absent" workflows (from the original request list) are stated as such rather than invented.

### 7.1 Registration (with email OTP)

1. `frontend/.../Register.jsx` `handleSendOtp` → `api.js` `authApi.sendEmailOtp(email)` → `POST /api/auth/send-email-otp` → `controllers/auth.js` `sendEmailOtp()` → generates/hashes OTP → upserts `EmailVerification` → `emailService.sendOtpEmail()`.
2. User enters the code → `handleVerifyOtp` → `authApi.verifyEmailOtp` → `verifyEmailOtp()` → `bcrypt.compare` → on match, marks the record verified and returns a `verificationToken`.
3. User sets a password → `handleRegister` → `authApi.register(name, email, password, verificationToken)` → `register()` → verifies the token, creates the `User` with `role: 'user'` hardcoded, deletes the `EmailVerification` record.
4. Frontend navigates to `/login` — **registration does not log the user in automatically.**

### 7.2 Login (2FA enabled — the default)

See Figure 1.2. `Login.jsx` → `POST /auth/login` → credential check → `issueLoginOtp()` → OTP emailed, `pending2faToken` returned (no session token yet) → user enters code → `POST /auth/verify-login-otp` → `verifyLoginOtp()` → `LoginOtp` record checked and deleted → real session token issued → `AuthContext.login()` called → `localStorage` written → navigate to `/upload`.

### 7.3 Document Upload and Verification

1. `Upload.jsx` `handleStartVerification` → `kycApi.verify(token, file)` (multipart) → `POST /api/kyc/verify`.
2. `middleware/auth.js` `protect()` resolves `req.user`.
3. Multer writes the file(s) to `backend/uploads/`.
4. `controllers/kyc.js` `verifyDocuments()` creates the `Verification` document (`Pending`).
5. Queries other users' prior records with extracted fields; hashes them via `identityHash.js`.
6. `services/mlService.js` `classifyDocument()` → `POST http://<ML_SERVICE_URL>/predict`.
7. Inside the ML service: `classifier.classify` → `ocr.extract_text` → `extractor.extract_fields` → `graph.analyze` → `decision.decide` (Chapter 2, Figure 5.1).
8. Response returns to `kyc.js`, which writes the five ML-derived fields onto the `Verification` document and saves once.
9. Backend responds with the full result; `Upload.jsx` stores it in `result` state and renders via `getStageStates()` and the `DECISION_DISPLAY` lookup.

### 7.4 Verification History Retrieval (including the Admin/RBAC path)

1. `ChatHistory.jsx` mounts → `kycApi.history(token, isAdmin ? debouncedSearch : undefined)` → `GET /api/kyc/history?name=...`.
2. `protect()` resolves `req.user`.
3. `getHistory()` builds `filter` from `req.user.role` (own-records-only, or unrestricted + optional name regex for an admin) and issues **one** `Verification.find(filter)` call.
4. Response is mapped to the list shape the table renders; client-side status/date/document-type filters are applied on top of this already-scoped set.

### 7.5 Admin Role Change (RBAC)

1. `UserManagement.jsx` → confirm dialog → `adminApi.updateUserRole(token, userId, role)` → `PATCH /api/admin/users/:id/role`.
2. `protect()` then `adminOnly()` both run; a non-admin caller is rejected by `adminOnly()` before the controller even runs.
3. `controllers/admin.js` `updateUserRole()` validates the id/role, blocks self-modification, blocks demoting the last admin, saves the target's new `role`.
4. **Verified effect:** because `protect()` re-reads `role` from the database on every request, the target user's *existing, already-issued* session token reflects the new role on their very next API call — no new login, no token refresh step exists or is needed.

### 7.6 Password Reset

`ForgotPassword.jsx` → `POST /auth/forgot-password` (generic response always) → email sent only if a real, non-cooldown account was found → `ResetPassword.jsx` reads `?token=` from the URL → `POST /auth/reset-password` → token hashed and looked up directly (no user id ever sent by the client) → password updated via the same plaintext-assignment-then-`.save()` pattern as change-password → `PasswordReset` record deleted → **no session issued; user is redirected to sign in manually.**

### 7.7 Workflows Explicitly Not Implemented

Per the original request list, stated here rather than fabricated: there is no logout-everywhere/session-revocation mechanism (Chapter 9 covers what this means concretely); there is no manual administrative approve/reject override of a `Verification` record anywhere in the code; there is no document download/export endpoint; there is no session-expiration UI beyond the JWT's own 30-day expiry (no idle-timeout, no "your session is about to expire" warning).
