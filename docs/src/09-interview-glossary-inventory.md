## Chapter 17 — Technical Interview and Knowledge Transfer

### Project Fundamentals

**Q: What problem does this project solve, in one sentence?**
A: It automates the mechanical parts of KYC document review — identifying the document type, reading its text, structuring the fields, and checking for duplicate identifiers across users — producing an explainable Approved/Suspicious/Rejected/Pending result instead of a human doing all of that by hand.

**Q: What are the main components?**
A: Three processes: a React/Vite frontend, a Node.js/Express backend, and a Python/Flask ML service — plus MongoDB Atlas, the Groq API, and an SMTP server as external dependencies (`backend/server.js`, `ml-service/app.py`, `frontend/src/main.jsx`).

**Q: What did we actually implement, versus what the project's name might suggest?**
A: A real, working classification → OCR → LLM-extraction → deterministic-graph-risk → deterministic-decision pipeline, plus a complete account-security system (OTP registration, 2FA login, password reset, RBAC). We did **not** implement face matching, forgery/tamper detection, or a trained graph neural network — an earlier GNN design was deliberately replaced with deterministic logic (`ml-service/requirements.txt`'s own comment explains why).

### Architecture

**Q: Why separate frontend, backend, and ML service instead of one application?**
A: Different runtimes and dependency weights. The ML service's dependencies (PyTorch, EasyOCR) are large and slow to install/start; keeping it as its own process means the backend can restart independently and the two don't compete for the same process's memory. (Chapter 15, §15.2.)

**Q: How does a document actually reach the ML service?**
A: `Upload.jsx` sends a multipart POST to `/api/kyc/verify`; `controllers/kyc.js` saves it via Multer, creates a `Pending` record, then `services/mlService.js` re-reads the file from disk and forwards it as a new multipart POST to the Flask service's `/predict` endpoint. The frontend never talks to the ML service directly.

**Q: What happens if the ML service is down?**
A: `mlService.js` catches the network failure and returns `{reachable: false}`. `kyc.js` still returns a successful upload response — the `Verification` record already exists, just without the ML-derived fields, and stays `Pending`. The upload is never lost.

### Backend

**Q: How does authentication actually work end to end?**
A: Credentials → `User.matchPassword()` (bcrypt) → if 2FA is on (default), an OTP step via a purpose-scoped intermediate token with no `id` claim → a real JWT (`{id}` only, 30-day expiry) → every protected route's `protect()` middleware re-verifies that JWT and **re-fetches the user from the database** on every single request, rather than trusting anything decoded from the token itself.

**Q: Why re-fetch the user on every request instead of trusting the JWT?**
A: So a role change, a 2FA toggle, or any other account-state change takes effect immediately — verified directly by testing a promoted-then-demoted account's pre-existing token.

**Q: How are admin-only routes protected?**
A: `middleware/adminOnly.js`, chained after `protect()`, checks `req.user.role === 'admin'`. Because `req.user` is always a fresh database read, this check can be a single field comparison and still be trustworthy.

**Q: Walk me through what happens if two different admins try to demote the same last remaining admin at the same time.**
A: This can't actually happen under the current design — only an admin can call this endpoint at all, so the caller is always a second admin distinct from the target (unless it's a self-demotion attempt, blocked separately first). The "last admin" count check exists in the code but is, by the endpoint's own structure, not reachable in normal operation — documented honestly in Chapter 3 rather than left implicit.

### Machine Learning

**Q: What does the CNN confidence score actually tell you?**
A: How sure the model is about document **type** — Aadhaar vs. PAN vs. Passport vs. non-KYC. It says nothing about whether the document is genuine.

**Q: Why run OCR even on a document the CNN thinks isn't a KYC document?**
A: Because the alternative — skipping OCR based on the CNN's own possibly-wrong classification — would make a misclassification unrecoverable. OCR text is also what the project's documented heuristic reasoning relies on more broadly; running it unconditionally keeps that option available. (`app.py`, line 84 comment.)

**Q: Why use an LLM after OCR instead of just regex?**
A: OCR output is messy free text; the LLM turns it into a fixed JSON schema per document type. Deterministic regex is still used, but *after* the LLM, as validation (PAN format, Aadhaar digit count, date formats) — never as the primary extraction method, because free-text fields like names and addresses don't have a reliable regex shape.

**Q: Is there a Graph Neural Network in this project?**
A: Not in the running application. One was built and partially trained earlier (`notebooks/GNN Notebooks/`), but the deployed `graph.py` uses deterministic NetworkX graph primitives instead, for a reason stated directly in the code: not enough real data for a trained model to learn genuine structure rather than noise.

**Q: What's the difference between the anomaly score and the final decision?**
A: The anomaly score is one input, among several (document type, required-field presence), to the decision engine's fixed rules — it does not by itself determine the outcome. A high anomaly score contributes to a `suspicious` decision only if the graph stage's status is `success` *and* a strong-field match was found; a missing required field produces `rejected` regardless of the anomaly score; any upstream processing failure produces `pending`/`error`, never a decision based on an incomplete picture.

**Q: What are the limitations of the current ML pipeline?**
A: It cannot detect a well-forged document with internally consistent fields; it performs no face match or image forensics; OCR is English-only; and the "risk" signal only ever reflects identifiers *already present in this system's own database* — it has no connection to any external identity registry.

### Database

**Q: Why MongoDB?**
A: Not independently evidenced in the repository beyond it being the chosen implementation — the schema is a natural fit for MongoDB's document model (nested `extractedData`/`graphAnalysis`/`decision` objects per record), but no comparison against an alternative is recorded anywhere, so this answer should be framed as "this is what was used and it fits reasonably well," not as a documented, deliberated choice.

**Q: What sensitive information does the database actually store?**
A: Extracted identity fields (name, PAN/Aadhaar/passport number, DOB, address) inside `Verification.extractedData.fields`, and raw OCR text in `Verification.ocrText` — both in plaintext in the database, not hashed (hashing is applied only to the *comparison* values used for the graph stage, never to the stored record itself).

### Cloud and Deployment

**Q: How would you deploy this today?**
A: You would need to build it — nothing in the repository currently does this. At minimum: separate processes/containers for backend and ML service, the ML service never directly internet-facing, HTTPS terminated at a reverse proxy, and `cors()` restricted to the real frontend origin. (Chapter 11.)

**Q: What's the security risk of exposing the ML service's `/predict` endpoint publicly?**
A: It has no authentication of its own at all — it trusts whatever `current_user_id`/`existing_identities` values are sent to it. It is safe only because, today, the only thing that can reach it is the backend, on a trusted network path. Exposing it directly would let anyone submit arbitrary `existing_identities` data and bypass the backend's own identity-hashing privacy guarantee entirely.

### Security

**Q: How are passwords stored?**
A: bcrypt-hashed via a Mongoose pre-save hook (`models/User.js`), only when the password field was actually modified on that save — never logged, never included in any API response (`buildSafeUser()` never reads it).

**Q: What happens if a user's password is changed — are their other logged-in sessions killed?**
A: No. This was directly tested: a session token issued before a password change remains valid for the rest of its 30-day life. There is no session-versioning mechanism in the codebase. This is documented as a confirmed limitation, not silently assumed to be fine.

**Q: What's the single most important security design decision in the authentication system?**
A: Intermediate, purpose-scoped tokens (`verificationToken`, `pending2faToken`) never carry a field literally named `id`, because `protect()` resolves any `id`-bearing JWT to a session regardless of its `purpose` claim. This makes a half-completed OTP/verification flow structurally incapable of being escalated into a real session.

### Debugging and Trade-offs

**Q: What would you improve first if you had one week?**
A: Restore the missing `kyc_classifier.tflite` artifact (the system cannot produce a real result without it) and add rate limiting to `/login`/`/register` — both are small, well-scoped, high-impact fixes compared to the larger items on the roadmap (Chapter 16).

**Q: What happens if the Groq API is unavailable mid-request?**
A: `extractor.extract_fields()` catches the exception, logs only the error string (never document content), and returns `extraction_status: "error"` — which `decision.py` then explicitly maps to an `error` status, never a false `approved` or `rejected`.

**Q: What happens if `kyc_classifier.tflite` is missing when the ML service starts?**
A: `classifier.load_model()` catches the exception, logs it, and `is_ready()` returns `False` from then on. `/health` reports `model_loaded: false`. Every `/predict` call returns `503` before even reading the uploaded file. The process itself does not crash.

---

## Chapter 18 — Glossary

| Term | Meaning in this project |
|---|---|
| KYC | Know Your Customer — identity verification required in regulated (BFSI) industries |
| BFSI | Banking, Financial Services & Insurance — the target domain this project is framed around |
| JWT | JSON Web Token — this project's session and purpose-scoped-token format, signed with `JWT_SECRET` |
| Middleware | An Express function run before a route handler; `protect`/`adminOnly`/the rate limiter are all middleware |
| OCR | Optical Character Recognition — EasyOCR, reading text out of the uploaded image |
| CNN | Convolutional Neural Network — the document-type classifier (`classifier.py`) |
| TFLite | TensorFlow Lite — the lightweight runtime format the CNN is exported to and run with via `ai-edge-litert` |
| LLM | Large Language Model — Groq's hosted model, used only for structured field extraction |
| GNN | Graph Neural Network — **planned but not used** in the running application (§1.2) |
| Anomaly score | This project's deterministic, NetworkX-derived connectivity score (`graph.py`) — not a learned probability |
| Classification confidence | The CNN's own softmax output for its predicted document type — not a fraud/authenticity measure |
| MongoDB / Mongoose | The database and the Node.js ODM library used to define schemas and query it |
| CORS | Cross-Origin Resource Sharing — currently unrestricted in this backend (`server.js`) |
| TTL index | A MongoDB index that auto-deletes documents after their `expiresAt` passes — used for the three short-lived token collections |
| Rate limiting | Restricting how many requests a client can make in a time window — implemented only for two endpoints, in-memory, per-process |

---

## Appendix A — Quick Reference

### Services and ports
| Service | Port (default) |
|---|---|
| Frontend (Vite) | 5173 (or 8000, as used during this project's development) |
| Backend | 5000 |
| ML service | 5001 |

### Key file paths
| Concern | File |
|---|---|
| Auth logic | `backend/controllers/auth.js` |
| KYC upload/history | `backend/controllers/kyc.js` |
| RBAC | `backend/controllers/admin.js`, `backend/middleware/adminOnly.js` |
| Login gate | `backend/middleware/auth.js` |
| ML orchestration | `ml-service/app.py` |
| Final decision rules | `ml-service/inference/decision.py` |
| Session state (frontend) | `frontend/src/context/AuthContext.jsx` |

### Startup commands
```bash
# ML service
cd ml-service && source venv/bin/activate && python app.py
# Backend
cd backend && node server.js
# Frontend
cd frontend && npm run dev
```

### Log/health commands
```bash
curl http://localhost:5000/api/health
curl http://localhost:5001/health
```

---

## Appendix B — File Inventory (Application Source Only)

Generated files, `node_modules/`, `venv/`, `__pycache__/`, build output (`dist/`), and binary model artifacts are excluded from this table — they are either fully reproducible from the tracked manifests (`package.json`, `requirements.txt`) or, in the model artifact's case, not currently present at all (§5.2).

| File | Component | Purpose | Verification status |
|---|---|---|---|
| `backend/server.js` | Backend | Entry point, DB connect, middleware/route registration | Confirmed |
| `backend/middleware/auth.js` | Backend | `protect()` — authentication | Confirmed |
| `backend/middleware/adminOnly.js` | Backend | Admin authorization | Confirmed |
| `backend/middleware/rateLimit.js` | Backend | In-memory rate limiter | Confirmed |
| `backend/controllers/auth.js` | Backend | Registration, login, 2FA, password change/reset | Confirmed |
| `backend/controllers/kyc.js` | Backend | Upload orchestration, history | Confirmed |
| `backend/controllers/admin.js` | Backend | User listing, role changes | Confirmed |
| `backend/models/User.js` | Backend/DB | User schema | Confirmed |
| `backend/models/Verification.js` | Backend/DB | Verification record schema | Confirmed |
| `backend/models/EmailVerification.js` | Backend/DB | Registration OTP store | Confirmed |
| `backend/models/LoginOtp.js` | Backend/DB | Login OTP store | Confirmed |
| `backend/models/PasswordReset.js` | Backend/DB | Reset token store | Confirmed |
| `backend/services/emailService.js` | Backend | Nodemailer wrapper, 3 email types | Confirmed |
| `backend/services/identityHash.js` | Backend | Identifier normalization/hashing | Confirmed |
| `backend/services/mlService.js` | Backend | HTTP client to the ML service | Confirmed |
| `backend/scripts/promoteAdmin.js` | Backend | One-time admin promotion | Confirmed |
| `backend/routes/auth.js`, `kyc.js`, `admin.js` | Backend | Route → middleware → controller wiring | Confirmed |
| `ml-service/app.py` | ML | Flask app, `/health`, `/predict` | Confirmed |
| `ml-service/inference/classifier.py` | ML | CNN loading/inference | Confirmed |
| `ml-service/inference/preprocessing.py` | ML | Image decode/resize/scale | Confirmed |
| `ml-service/inference/ocr.py` | ML | EasyOCR wrapper | Confirmed |
| `ml-service/inference/extractor.py` | ML | Groq structured extraction | Confirmed |
| `ml-service/inference/graph.py` | ML | Deterministic risk signal | Confirmed |
| `ml-service/inference/decision.py` | ML | Final decision rules | Confirmed |
| `ml-service/tests/*.py` | ML | pytest suite | Confirmed present; not re-run for this manual |
| `frontend/src/context/AuthContext.jsx` | Frontend | Session state | Confirmed |
| `frontend/src/services/api.js` | Frontend | All backend calls | Confirmed |
| `frontend/src/components/ProtectedRoute.jsx` | Frontend | Route guard (UX only) | Confirmed |
| `frontend/src/components/DashboardLayout.jsx` | Frontend | Shared authenticated shell | Confirmed |
| `frontend/src/components/Login.jsx`, `Register.jsx` | Frontend | Credential + OTP flows | Confirmed |
| `frontend/src/components/ForgotPassword.jsx`, `ResetPassword.jsx` | Frontend | Password recovery flow | Confirmed |
| `frontend/src/components/Upload.jsx` | Frontend | Verification workflow UI | Confirmed |
| `frontend/src/components/ChatHistory.jsx` | Frontend | History + admin search | Confirmed |
| `frontend/src/components/UserManagement.jsx` | Frontend | Admin role management UI | Confirmed |
| `frontend/src/components/Account.jsx` | Frontend | Settings, change password, 2FA toggle | Confirmed |
| `frontend/src/components/Landingpage.jsx`, `Learnmore.jsx` | Frontend | Public marketing pages | Confirmed, concise treatment (no logic) |
| `frontend/src/styles/*.css` | Frontend | Presentation only | Confirmed, excluded from line-level treatment (no logic) |
| `trained models/kyc_classifier.tflite` | ML artifact | Required CNN weights | **Confirmed absent from the repository** |
| `KYC_System_Deployment_Guide.pdf` | Historical doc | Describes an earlier, unimplemented design | Confirmed mismatch with running code (§1.2) |

---

## Closing Summary

This manual documents the AI-Powered KYC Verification System as it actually exists in source code at the time of writing: a three-process local system (React/Vite, Node/Express, Python/Flask) with a genuinely deterministic, explainable ML pipeline (CNN classification → EasyOCR → Groq-LLM extraction → NetworkX-based risk signal → rule-based decision) and a complete, independently-tested authentication and authorization system (OTP registration, default-on login 2FA, password reset, role-based access control). It is not production-ready, not regulatory-compliant, and does not perform image forensics or face matching — none of this manual's chapters claim otherwise. The single most consequential open item is the missing `kyc_classifier.tflite` model artifact, without which the system cannot produce a real classification result; this is stated here one final time because it is the one gap that affects whether the system runs at all, not just how well it runs.
