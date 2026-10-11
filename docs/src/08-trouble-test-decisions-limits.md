## Chapter 13 — Troubleshooting Handbook

| Symptom | Likely cause | Relevant file | Diagnostic | Fix |
|---|---|---|---|---|
| ML service won't start / model error | `trained models/kyc_classifier.tflite` missing or `MODEL_PATH` wrong | `inference/classifier.py` | `curl localhost:5001/health` → `model_loaded: false` | Restore/retrain the artifact; see §10.1 |
| `torchvision::nms does not exist` | `torch`/`torchvision` versions drifted apart | `requirements.txt` | `pip show torch torchvision` | Reinstall both together from the pinned CPU extra index |
| EasyOCR very slow on first request | Expected — model weights load/warm up on first real use | `inference/ocr.py` | Compare first vs. second request latency | Not a bug; CPU-only inference, documented in the code's own comments |
| Backend can't reach ML service | `ML_SERVICE_URL` wrong, or the Flask process isn't actually running | `services/mlService.js` | Check the backend log for `"ML service communication error"` | Fix the URL / start the process |
| CORS error in browser console | Frontend origin not reachable at the URL the backend expects, or vice versa | `server.js` | Check the browser Network tab's failed preflight | Confirm `VITE_API_BASE` matches where the backend is actually listening |
| OTP/reset emails never arrive | Wrong `SMTP_*` values; Gmail needs an App Password, not the account password | `services/emailService.js` | Backend log: `"Failed to send ... email"` with the real (server-side-only) error | Fix SMTP credentials |
| `401` on every request | Missing/expired Bearer token | `middleware/auth.js` | Check the request's `Authorization` header | Log in again |
| `403` on `/api/admin/*` | Account's `role` is `"user"` | `middleware/adminOnly.js` | `GET /api/auth/me`, check `role` in the response | Promote via `scripts/promoteAdmin.js` or an existing admin |
| MongoDB connection failure at startup | Wrong `MONGODB_URI`, or the current IP isn't allow-listed in Atlas | `server.js` `connectDB()` | Startup log prints the raw connection error | Fix the URI / Atlas network access list |
| "next is not a function" on any `User.save()` | **Historical, fixed bug** — Mongoose 9's async pre-save hooks receive no `next` callback | `models/User.js` | N/A — already corrected in the current code | Documented here for anyone who reintroduces a similar pattern |
| Login/password-reset endpoints suddenly returning 429 for everyone | The in-memory rate limiter's window hasn't reset; or genuinely too many requests from one IP | `middleware/rateLimit.js` | Restart the backend process to clear the in-memory counters | Expected behavior at the configured thresholds (5/15min, 10/15min) |

Items above are either **confirmed** (directly observed during this project's own development and testing — the Mongoose hook bug, the regex-filter behavior, the role-live-lookup behavior) or **common possibilities** for a stack of this shape, labeled as such rather than claimed as verified defects in every case.

---

## Chapter 14 — Testing and Validation

### 14.1 What Exists

`ml-service/tests/` contains a real pytest suite: `test_classifier.py`, `test_decision.py`, `test_extractor.py`, `test_graph.py`, `test_health.py`, `test_ocr.py`. Run with:
```bash
cd ml-service && source venv/bin/activate && pytest
```

### 14.2 What Does Not Exist

`backend/package.json`'s `test` script is a placeholder (`echo "Error: no test specified" && exit 1`) — **there is no automated backend test suite.** The frontend has no automated test suite either; `npm run build` (which succeeds, confirmed) is the only available automated check that the frontend compiles. No CI workflow runs any of this automatically on any event.

### 14.3 Manual Smoke-Test Checklist (proposed, not a substitute for automated tests)

1. Register a new account; confirm the OTP email arrives and registration completes.
2. Log in; confirm the login-OTP email arrives (2FA is on by default) and login completes.
3. Toggle 2FA off in Settings; log out and back in; confirm login now skips the OTP step.
4. Upload a sample document; confirm a result renders with real (not placeholder) values.
5. As a second account, confirm `GET /kyc/history` shows only that account's own records.
6. Promote one account to admin; confirm `GET /kyc/history` now shows records from multiple accounts, and `/admin/users` is reachable.
7. Attempt a non-admin call to `/admin/users`; confirm `403`.
8. Request a password reset; confirm the email, confirm the link works once and is rejected on a second use.

---

## Chapter 15 — Engineering Decisions

### 15.1 Deterministic Graph Analysis Instead of a Trained GNN

**Problem:** detect whether an uploaded document's identifiers also appear on a different user's record. **Earlier implementation:** a per-document-type trained PyTorch GNN with Sentence-Transformer embeddings (`notebooks/GNN Notebooks/`). **Current implementation:** `ml-service/inference/graph.py`, NetworkX graph primitives with fixed, hand-chosen weights. **Stated reason** (verified directly in `requirements.txt`'s own comment, not inferred): with only a few dozen real `Verification` records in the database, a trained model would not have enough data to learn genuine structure rather than noise. **Trade-off:** the deterministic approach cannot discover subtle, non-obvious fraud patterns a sufficiently-trained model might eventually find — but it is fully explainable (every signal has a stated reason) and does not degrade as the dataset stays small. **Alternative considered and rejected**, per the same comment: the trained-GNN path, abandoned specifically for this reason.

### 15.2 Separate Node.js and Python Processes

**Problem:** the system needs both a conventional web backend and a heavy ML inference workload. **Decision:** two separate processes communicating over HTTP, rather than one process or a Python web framework serving everything. **Benefit:** each process's dependency footprint stays independent (Express is lightweight; PyTorch/EasyOCR are not), and either can be restarted or scaled without affecting the other. **Trade-off:** every verification request now includes a network hop and JSON serialization between the two services, and failure handling has to account for the ML service being unreachable (handled explicitly in `mlService.js` and `kyc.js`, Chapter 3).

### 15.3 Models Loaded Once, at Process Startup

**Decision:** `classifier.load_model()` and `ocr.load_reader()` both run once, synchronously, before Flask starts accepting requests — not lazily on first request, not per-request. **Benefit:** every request after the process is up pays no model-load cost. **Trade-off:** the process takes longer to become ready, and a model-loading failure is a startup-time failure rather than a per-request one — reflected directly in `/health`'s `model_loaded`/`ocr_loaded` flags.

### 15.4 Live Role Lookup Over JWT Claims

**Decision:** `protect()` re-reads the user from the database on every request rather than trusting a role embedded in the token. **Benefit, directly tested:** a role change (or a 2FA toggle, or a password change) takes effect on the very next request, with no token-refresh mechanism needed. **Trade-off:** one extra database read per authenticated request, compared to a stateless-JWT design that trusts the token's own claims.

### 15.5 Purpose-Scoped Tokens Without an `id` Claim

**Decision:** every non-session JWT in the system (`verificationToken`, `pending2faToken`) deliberately omits a field named `id`. **Reason, directly verified in `middleware/auth.js`:** `protect()` resolves *any* JWT with an `id` field to a real session, with no check of a `purpose` claim — so a field named `id` would make these intermediate tokens usable as session tokens before the flow they belong to actually completes. **This is a structural defense, not a documentation promise** — the token literally cannot carry the field `protect()` looks for.

---

## Chapter 16 — Known Limitations and Proposed Improvements

### 16.1 Confirmed Limitations

- `trained models/kyc_classifier.tflite` is required but currently absent from the repository.
- No automated backend or frontend test suite; no CI.
- No rate limiting on login/registration.
- Password change/reset does not revoke other existing sessions.
- No deployment/infrastructure configuration exists in the repository.
- Uploaded documents are never deleted; no retention policy.
- `notebooks/GNN Notebooks/` and `notebooks/Document_Forgery_Detection.ipynb` represent experiments never integrated into the running application.
- The "last admin" protection in `controllers/admin.js` has an unreachable branch under the current endpoint design (Chapter 3) — the overall guarantee still holds via the separate self-modification check.
- The Account page's "Email Alerts for High Risk Fraud" and "Push Notifications" toggles are local UI state only, with no backend behind them (Chapter 4).
- OCR is English-only; non-Latin script on a document (e.g. Hindi on an Aadhaar card) will not be read.
- The system performs no face-match, image-forgery, or hologram/security-feature verification of any kind.

### 16.2 Proposed Improvements (not existing features)

Prioritized roughly by security/reliability impact:

1. **Session revocation** — a token-version field on `User`, checked by `protect()` alongside the existing live role lookup, so a password change can actually invalidate other sessions.
2. **Rate limiting on `/login` and `/register`** — the same `createRateLimiter` helper already exists and could be applied with minimal new code.
3. **Automated backend tests** — the ML service's pytest suite is a usable model for how to structure this; the backend currently has none.
4. **Uploaded-file retention policy** — a scheduled cleanup job or an explicit delete-on-decision policy for `backend/uploads/`.
5. **Restore or retrain `kyc_classifier.tflite`** and track it (or a reproducible way to obtain it) so a fresh clone can actually run a real verification.
6. **Distributed-safe rate limiting** if this is ever run as more than one process (Redis-backed or similar), replacing the current in-memory limiter.
7. **Reconcile or retire `KYC_System_Deployment_Guide.pdf`** so it does not continue to describe infrastructure and an ML design that no longer match the codebase.
