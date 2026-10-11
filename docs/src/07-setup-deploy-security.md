## Chapter 10 — Installation and Development Setup

### 10.1 Prerequisites

- Node.js 18+ (the backend uses native `fetch`; confirmed no `axios` dependency anywhere in `package.json`).
- Python 3.12 (the exact version `ml-service/requirements.txt`'s pins were tested against).
- A reachable MongoDB instance (MongoDB Atlas free tier is sufficient).
- A Groq API key — [console.groq.com](https://console.groq.com).
- A Gmail account with an App Password (or another SMTP provider, adjusting `SMTP_*` accordingly).
- `trained models/kyc_classifier.tflite` — **required and not currently present in this repository** (Chapter 5, §5.2). The ML service will start, but `classifier.load_model()` will fail and `/health` will report `model_loaded: false`; every `/predict` call will then return `503`. This must be resolved before the system can perform a real verification — either by retraining from `notebooks/Doc detection Notebooks/Document_Detection.ipynb` or obtaining the file from whoever last had it. There is no hosted download URL for it anywhere in this repository.

Python dependency installation (PyTorch, EasyOCR) is noticeably slower than the Node installs — budget several minutes.

### 10.2 Setup Steps (verified against actual file locations and `package.json`/`requirements.txt` contents)

```bash
git clone <repo-url>
cd Infosys_AI_KYC_Compliance
```

**Terminal 1 — ML service**
```bash
cd ml-service
python3 -m venv venv
source venv/bin/activate              # Windows: venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env                  # fill in GROQ_API_KEY
# place trained models/kyc_classifier.tflite at the repo root
python app.py
```
Expected: process listens on port 5001; `curl http://localhost:5001/health` should return `200` with `"model_loaded": true` (once the artifact is in place).

**Terminal 2 — Backend**
```bash
cd backend
npm install
cp .env.example .env                  # fill in MONGODB_URI, JWT_SECRET, SMTP_*, FRONTEND_URL
node server.js
```
Expected console output, verified directly against `server.js`: `Server running in development mode on port 5000` and `MongoDB Connected: <host>`.

**Terminal 3 — Frontend**
```bash
cd frontend
npm install
cp .env.example .env                  # VITE_API_BASE=http://localhost:5000/api
npm run dev
```

**Verifying the system is actually working end to end:** register a real account through the UI (this exercises the registration-OTP email flow — confirm the email actually arrives), log in (exercises login OTP, since 2FA defaults to on), and upload a sample (fake/test) identity document on the New Verification page. If any of these three steps fails, consult Chapter 13.

**Promoting an admin (optional, one-time):**
```bash
cd backend
node scripts/promoteAdmin.js
```
Edit `INITIAL_ADMIN_EMAIL` in `backend/scripts/promoteAdmin.js` first — it is hardcoded, not read from an environment variable (Chapter 3).

### 10.3 If the Project Cannot Currently Run From a Fresh Clone

As of this manual, it cannot — the missing `kyc_classifier.tflite` artifact (§10.1) blocks real verification results, though the auth system (registration, login, 2FA, password reset) and the frontend shell all function independently of it. This is stated here explicitly per the manual's own requirement not to pretend a clean install succeeds when it does not.

---

## Chapter 11 — Deployment and Infrastructure

### 11.1 What Exists Today: Nothing

Verified by direct repository inspection: no `Dockerfile`, no `docker-compose.yml`, no PM2 `ecosystem.config.js`, no CI workflow (`.github/workflows/` does not exist), no Terraform/CloudFormation, and no `aws-sdk`/`boto3` dependency anywhere in `package.json` or `requirements.txt`. All development and testing of this project has been three manually-started local processes.

### 11.2 Historical Document: `KYC_System_Deployment_Guide.pdf`

This PDF describes a specific AWS EC2 (×2) + S3 three-tier architecture with PM2 process management and a trained-GNN ML service. As established in Chapter 1, §1.2, **the GNN half of that document does not match the running code**, and the AWS/PM2 half of it does not match anything present in this repository's tracked files. This manual does not treat that PDF as a description of current infrastructure. Whether it should be updated, archived, or kept as a record of an earlier plan is a decision for the project owner, not something this manual resolves.

### 11.3 What Would Actually Be Required to Deploy This

Stated as **recommendations**, not as documentation of something that exists:

- Run the backend and ML service as separate processes or containers — their dependency footprints (Express vs. PyTorch/EasyOCR) are too different to share a runtime sensibly.
- Put the ML service behind the backend only — it should never be reachable from the public internet directly; only the backend's own `ML_SERVICE_URL` call should reach it, ideally over a private network segment.
- Terminate HTTPS at a reverse proxy in front of the backend; the backend itself has no TLS handling of its own.
- Set `cors()` (currently unrestricted — §12.2) to the real frontend origin(s) before any public exposure.
- Decide on a process manager or container orchestrator and a restart/health-check policy — none is currently implemented; a crashed Node or Flask process simply stays down until someone notices and restarts it manually.
- Decide on log aggregation — both services currently log to stdout/stderr only (`console.log`/`console.error` in Node, `print`/`app.logger` in Flask), with no file rotation, shipping, or retention policy configured anywhere.

---

## Chapter 12 — Security and Privacy Review

Each item below states what the code does, why it matters, and whether it is confirmed by direct inspection/testing or is a recommendation.

### 12.1 Confirmed Safeguards

| Safeguard | File | Confirmed by |
|---|---|---|
| Passwords bcrypt-hashed, never logged/returned | `models/User.js`, `controllers/auth.js` | Direct code read; `buildSafeUser()` never includes `password` |
| OTPs bcrypt-hashed; reset token SHA-256-hashed | `controllers/auth.js` | Direct code read of `generateOtp`/`hashResetToken` |
| Registration OTP: 10-min expiry, 5-attempt cap, 60s cooldown | `controllers/auth.js` | Direct code read of the relevant constants and branches |
| Reset token: 15-min expiry, single-use (deleted on success) | `controllers/auth.js`, `models/PasswordReset.js` | Direct code read; independently re-tested during the reset-password feature's own development (replaying a used token was rejected) |
| `forgot-password` returns an identical response regardless of account existence | `controllers/auth.js` | Direct code read; tested with a real vs. a nonexistent email, byte-identical responses observed |
| Role checked fresh from the database on every request, not from the JWT | `middleware/auth.js` | Direct code read; **independently tested**: a promoted-then-demoted test account's pre-existing token lost admin access on its very next request |
| KYC history filtered at the database query level by ownership | `controllers/kyc.js` | Direct code read; tested with a real second user account — zero cross-user leakage observed |
| Admin endpoints block self-role-change and (structurally) ever reaching zero admins | `controllers/admin.js` | Direct code read; see the dead-code note in Chapter 3 for the precise, honest nuance |
| Mass-assignment defense on registration (`role` always hardcoded) | `controllers/auth.js` | Direct code read; tested by sending `role: "admin"` in a real registration request body — account was created as `"user"` |

### 12.2 Confirmed Gaps

| Gap | File | Risk |
|---|---|---|
| `cors()` has no origin restriction | `server.js` | Any website can make authenticated-looking requests to this API from a user's browser if they hold a valid token; no same-origin protection exists today |
| No rate limiting on `/login` or `/register` | `routes/auth.js` | Credential-stuffing / brute-force login attempts are not throttled (only `forgot-password`/`reset-password` are) |
| Password change/reset does not invalidate other sessions | `controllers/auth.js` | A stolen token remains valid for its full 30-day life even after the account owner changes their password — there is no session-versioning or revocation mechanism anywhere in the codebase |
| Uploaded files never deleted | `routes/kyc.js`, `controllers/kyc.js` | Identity-document images accumulate indefinitely on local disk with no retention policy |
| In-memory rate limiter is single-process | `middleware/rateLimit.js` | Resets on restart; does not coordinate across multiple instances — explicitly acknowledged in the code's own comment |
| `backend/scripts/promoteAdmin.js` has a real email hardcoded | `scripts/promoteAdmin.js` | Not a runtime security issue, but a real-world PII exposure risk if this file is published as-is |
| No face-match or image forgery/tamper detection | (not implemented anywhere) | The system cannot detect a well-made fake document with consistent fields — stated plainly in Chapter 5, §5.4 |

### 12.3 Pre-Publication Checklist (repository-level, not code-level)

Carried over from the README-writing task's own audit, repeated here because it belongs in a complete reference:

- `backend/node_modules/` was found tracked in git (1,518 files) — needs `git rm -r --cached` before any public push.
- `ml-service/` was found entirely untracked — the ML service source would not exist in a public clone of this repository without an explicit `git add`.
- No `.env` file of any kind was found tracked — confirmed clean.
- No root-level `.gitignore` exists; each subproject has its own, with inconsistent coverage, which is how the two issues above happened in the first place.

### 12.4 Never Use Real Identity Data

Restated here as its own point because this system's whole purpose is processing identity documents: do not upload real Aadhaar, PAN, Passport, or other genuine identity documents belonging to yourself or anyone else when testing, developing, or demonstrating this project. Use clearly fake/sample documents only.
