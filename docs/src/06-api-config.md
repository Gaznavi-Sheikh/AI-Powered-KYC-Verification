## Chapter 8 — API Reference

All backend paths are prefixed `/api`; the ML service's two endpoints are unprefixed and are **internal-only** — nothing in the frontend calls them directly, and they should never be exposed on a public network interface (Chapter 11).

### 8.1 Auth — `/api/auth`

#### `POST /send-email-otp`
Auth: none. Body: `{"email": string}`. Validates format against the same regex as the `User` schema. Rate-limited only by the 60-second per-email resend cooldown (not by IP). Success `200`: `{"success": true, "message": "Verification code sent to your email."}`. Errors: `400` invalid email; `429` cooldown active; `502` email provider rejected the send.

#### `POST /verify-email-otp`
Auth: none. Body: `{"email": string, "otp": string (6 digits)}`. Success `200`: `{"success": true, "verificationToken": "<jwt>"}`. Errors: `400` bad format / expired / no record / wrong code; `429` ≥5 failed attempts for this email.

#### `POST /register`
Auth: none. Body: `{"name", "email", "password", "verificationToken"}`. `role` is **never** accepted from the body even if present — always created as `"user"`. Success `201`: `{"success": true, "data": {"user": {id, name, email, twoFactorEnabled, role}}}`. Errors: `400` missing field, invalid/expired/mismatched token, email already registered, password too short.

#### `POST /login`
Auth: none. Body: `{"email", "password"}`. **Two distinct success shapes**, both `200`:
- 2FA disabled for this account: `{"success": true, "data": {"token": "<jwt>", "user": {...}}}`.
- 2FA enabled (default): `{"success": true, "data": {"twoFactorRequired": true, "pending2faToken": "<jwt>"}}` — **no `token` or `user` key present at all.**

Error: `401` invalid credentials (generic message, does not distinguish unknown email from wrong password).

#### `POST /verify-login-otp`
Auth: none (holds `pending2faToken` instead). Body: `{"pending2faToken", "otp"}`. Success `200`: same shape as the direct-login success case above. Errors: `400` invalid/expired pending token or wrong/expired code; `429` ≥5 attempts.

#### `POST /resend-login-otp`
Auth: none (holds `pending2faToken`). Body: `{"pending2faToken"}`. Success `200`: a fresh `{"twoFactorRequired": true, "pending2faToken": "<new jwt>"}`. Error: `429` within 60s of the last send.

#### `GET /me`
Auth: **required** (`protect`). No body. Success `200`: `{"success": true, "data": {"user": {...}}}`.

#### `PATCH /two-factor`
Auth: **required**. Body: `{"enabled": boolean}`. Operates only on `req.user` — there is no way to target another user's 2FA setting through this endpoint, by construction (no id parameter exists on the route at all). Success `200`: updated safe user object.

#### `PATCH /change-password`
Auth: **required**. Body: `{"currentPassword", "newPassword", "confirmPassword"}`. Errors: `400` mismatch/too short/same-as-current; `401` current password wrong.

#### `POST /forgot-password`
Auth: none. Rate-limited: 5 requests / 15 minutes / IP. Body: `{"email"}`. **Always** `200` with the identical generic message, regardless of whether the account exists, is on cooldown, or the email send itself failed.

#### `POST /reset-password`
Auth: none. Rate-limited: 10 requests / 15 minutes / IP. Body: `{"token", "newPassword", "confirmPassword"}`. Success `200`, **no session token returned.** Errors: `400` invalid/expired/already-used token, or mismatch/too-short password.

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"your-password"}'
```

### 8.2 KYC — `/api/kyc` (all routes require `Authorization: Bearer <token>`)

#### `POST /verify`
Content-Type: `multipart/form-data`. Fields: `identity` (required, exactly one file), `supporting` (optional, up to 5 files). Accepted types: JPG/JPEG/PNG/PDF; 5 MB max per file (enforced by Multer's `fileFilter`/`limits` in `routes/kyc.js`). Success `201`: a body containing `verification`, `ocr`, `extraction`, `graphAnalysis`, `decision`, `mlService` (connectivity flag). Errors: `400` missing identity file, unsupported type, file too large.

```bash
curl -X POST http://localhost:5000/api/kyc/verify \
  -H "Authorization: Bearer <token>" \
  -F "identity=@/path/to/document.jpg"
```

#### `GET /history`
Query params: `name` (optional, **admin only** — silently ignored for a non-admin caller, never a `403`, since it's simply not read). Success `200`: `{"success": true, "count": n, "data": [{id, name, initials, docType, filename, status, confidence, submittedAt}, ...]}`, sorted newest-first.

### 8.3 Admin — `/api/admin` (all routes require an admin's `Authorization: Bearer <token>`)

#### `GET /users`
No params. Success `200`: `{"success": true, "count": n, "data": [{id, name, email, role, emailVerified, twoFactorEnabled, createdAt}, ...]}`.

#### `PATCH /users/:id/role`
Path param: `id` (must be a valid Mongo ObjectId). Body: `{"role": "admin" | "user"}`. Errors: `400` invalid id/role or "cannot demote the last remaining admin"; `403` "you cannot change your own role"; `404` user not found.

**Both routes return `401` with no token at all, and `403` for a valid-but-non-admin token**, verified directly by testing in §12 (Security).

### 8.4 ML Service (internal — not for direct frontend/public use)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | `{"success", "service", "status": "healthy"\|"degraded", "model_loaded", "ocr_loaded", "groq_configured"}`, always `200`. |
| POST | `/predict` | `multipart/form-data`, field `document` (one image), optional `current_user_id` and `existing_identities` (JSON string). See Chapter 2 for the full response shape. |

---

## Chapter 9 — Environment and Configuration Reference

### 9.1 `backend/.env`

| Variable | Required | Read by | Purpose |
|---|---|---|---|
| `MONGODB_URI` | Yes | `server.js` | Database connection string |
| `JWT_SECRET` | Yes | `controllers/auth.js`, `middleware/auth.js` | Signs/verifies every token type in the system |
| `PORT` | No (default `5000`) | `server.js` | Backend listen port |
| `NODE_ENV` | No | `server.js` (log line only) | `development` / `production` |
| `ML_SERVICE_URL` | Yes | `services/mlService.js` | Base URL of the Flask service |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Yes | `services/emailService.js` | SMTP transport credentials |
| `SMTP_FROM` | No (falls back to `SMTP_USER`) | `services/emailService.js` | Display "From" address |
| `FRONTEND_URL` | Yes | `controllers/auth.js` (`forgotPassword`) | Builds the password-reset link embedded in the email |

### 9.2 `frontend/.env`

| Variable | Required | Read by |
|---|---|---|
| `VITE_API_BASE` | Yes | `services/api.js` |

The only frontend variable; contains no secret (Vite exposes all `VITE_`-prefixed variables to the browser bundle, so nothing sensitive may ever be placed in this file).

### 9.3 `ml-service/.env`

| Variable | Required | Read by |
|---|---|---|
| `GROQ_API_KEY` | Yes | `inference/extractor.py` |
| `PORT` | No (default `5001`) | `app.py` |
| `FLASK_DEBUG` | No (default `false`) | `app.py` |
| `MODEL_PATH` | No (default `../trained models/kyc_classifier.tflite`) | `inference/classifier.py` |
| `GROQ_MODEL` | No (default `qwen/qwen3.8-27b`) | `inference/extractor.py` |

### 9.4 Local vs. Production

Every URL-shaped value above (`ML_SERVICE_URL`, `VITE_API_BASE`, `FRONTEND_URL`) currently points at `localhost` in this project's own `.env` files. A production deployment would need all three changed to the real reachable addresses of each service, plus `cors()` restricted (Chapter 11) — none of this is configured anywhere in the repository today; it would be new work, not a flag to flip.
