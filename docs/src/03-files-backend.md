## Chapter 3 — Source Code Reference: Backend

All paths relative to `backend/`.

---

### File: `server.js`

**A. Purpose.** Process entry point: creates the Express app, connects to MongoDB, registers global middleware, mounts the three route modules, and starts listening.

**B. Execution Context.** Runs as `node server.js`. Top-to-bottom execution at process start.

**D. Key elements.** `connectDB()` — an async function wrapping `mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })`; on failure, logs the error and calls `process.exit(1)` — the server does not start in a half-connected state. Global middleware, in registration order: `express.json()` (body parsing), `cors()` (see Chapter 8 for why this is a security note, not just a feature), `express.static()` for `/uploads`. Route mounts: `app.use('/api/auth', auth)`, `app.use('/api/kyc', kyc)`, `app.use('/api/admin', admin)`. Two inline routes: `GET /` (plain text liveness message) and `GET /api/health` (returns Mongoose's `connection.readyState` translated to a human string).

**G. Connections.** Imports `routes/auth.js`, `routes/kyc.js`, `routes/admin.js`. Every other backend file is reachable only through this file's route registration.

**H. Design Decisions.** `cors()` is called with **no options**, which means it reflects/allows any origin. This is flagged again in Chapter 8 as a real, unmitigated gap for a production deployment.

---

### File: `middleware/auth.js` — `protect()`

**A. Purpose.** The single authentication gate used by every protected route in the system.

**D. Function: `protect(req, res, next)`.** Reads `Authorization: Bearer <token>`; `401` if absent. `jwt.verify(token, process.env.JWT_SECRET)` — `401` ("Invalid or expired token") if this throws. **Then re-fetches the user from MongoDB by `decoded.id`** (`User.findById`) — `401` ("User no longer exists") if that user was deleted since the token was issued. Only then sets `req.user` to the full Mongoose document and calls `next()`.

**H. Design Decisions — the single most architecturally important fact in this codebase's authorization model:** because `protect()` loads the user fresh from the database on *every* request rather than trusting claims embedded in the JWT, any field on `User` (`role`, `twoFactorEnabled`, etc.) is always current as of the moment of the request. This is what makes `adminOnly.js` safe to implement as a simple field check (below) and is what was directly verified by testing in §9.3 (a promoted-then-demoted user's pre-existing token lost admin access on its very next request, with no new login).

**I. Failure Scenarios.** Expired token → `401`. Token signed with a different secret → `401`. Token structurally valid but for a deleted user → `401`, distinct message.

---

### File: `middleware/adminOnly.js`

**A. Purpose.** The authorization gate for admin-only routes. **D.** `adminOnly(req, res, next)`: `401` if `req.user` is unset (meaning it was called without `protect()` running first — a usage error this guards against); `403` ("Admin access required") if `req.user.role !== 'admin'`; otherwise `next()`. **G.** Always mounted after `protect()` — see `routes/admin.js`. **H.** Depends entirely on `protect()`'s live-lookup guarantee above; this file itself does not re-query the database.

---

### File: `middleware/rateLimit.js`

**A. Purpose.** A minimal, dependency-free rate limiter, used only on `POST /api/auth/forgot-password` and `POST /api/auth/reset-password`.

**D. `createRateLimiter({ windowMs, max, message })`** — a factory returning Express middleware. Internally keeps an in-memory `Map<ip, {count, windowStart}>`. On each request: if no entry exists for that IP, or the window has elapsed, resets the counter to 1 and allows the request. If the count is already at `max`, returns `429` with `message`. Otherwise increments and allows.

**H. Design Decisions, stated plainly in the code's own comment:** this is **in-memory and per-process** — it resets on every server restart and does not coordinate across multiple server instances. This is an accepted trade-off for a single-process deployment, not a production-grade distributed rate limiter, and is documented as a known limitation (Chapter 12).

**I. Failure Scenarios.** None — this is a pure counter with no external dependency that could fail. The only "failure" is the documented scaling limitation above.

---

### File: `controllers/auth.js` (706 lines — the largest file in the backend)

This single file implements registration-OTP, login, login-time 2FA, password change, and forgot/reset password. It is organized here by feature group rather than line-by-line, since the file itself is organized that way.

**Shared helpers (top of file):**
- **`buildSafeUser(user)`** — the *only* function anywhere in the backend that shapes a `User` document for an API response. Returns exactly `{id, name, email, twoFactorEnabled, role}`. **Password, OTP hashes, and reset-token hashes live on separate collections entirely and are never read by this function in the first place** — there is no field to accidentally include.
- **`signToken(user)`** — `jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' })`. This exact shape (`{id}` only) is what makes `protect()`'s live-role-lookup property hold.
- Constants: `OTP_EXPIRY_MINUTES = 10`, `OTP_MAX_ATTEMPTS = 5`, `RESEND_COOLDOWN_SECONDS = 60` (shared by registration OTP and login OTP), `VERIFICATION_TOKEN_EXPIRES_IN = '15m'`, `PENDING_2FA_TOKEN_EXPIRES_IN = '10m'`, `RESET_TOKEN_EXPIRY_MINUTES = 15`.
- **`generateOtp()`** — `crypto.randomInt(0, 1000000)` zero-padded to 6 digits. A CSPRNG, deliberately not `Math.random()`.
- **`generateResetToken()` / `hashResetToken()`** — `crypto.randomBytes(32).toString('hex')` (256 bits of entropy) hashed with SHA-256 (not bcrypt — a design decision explained in Chapter 10: a high-entropy random token doesn't need bcrypt's deliberate slowness, unlike a 6-digit OTP).

**Registration OTP:**
- **`sendEmailOtp(req, res)`** — `POST /auth/send-email-otp`. Validates email format. Enforces the 60-second resend cooldown by checking an existing `EmailVerification` document's `lastSentAt`. Generates an OTP, bcrypt-hashes it, **upserts** the `EmailVerification` document (so a second request for the same email replaces, never duplicates). Calls `emailService.sendOtpEmail()`; a send failure returns `502` with a generic message (the real SMTP error is logged server-side only, never sent to the client).
- **`verifyEmailOtp(req, res)`** — `POST /auth/verify-email-otp`. Validates the 6-digit format. Loads the `EmailVerification` record; `400` if missing/expired. `429` if `attempts >= 5`. `bcrypt.compare()` the submitted code; a mismatch increments `attempts` and returns `400` — correct code marks the record `verified: true` and returns a short-lived `verificationToken` JWT with payload `{email, purpose: 'email_verification'}`. **This payload deliberately has no `id` field**, so `protect()` can never resolve it to a real user — it is structurally incapable of being used as a session token.
- **`register(req, res)`** — `POST /auth/register`. Requires `name`, `email`, `password`, and `verificationToken`. Verifies the token's signature, `purpose`, and that its `email` matches the submitted email. Re-checks the `EmailVerification` record's `verified` flag (belt-and-braces — the token alone proves it was legitimately issued, but this DB check is what makes it single-use). Creates the user with **`role: 'user'` hardcoded in the `User.create()` call, regardless of anything else in the request body** — this is the actual mass-assignment defense, verified directly in this file, not merely assumed. Deletes the `EmailVerification` record on success (one-time consumption) — explicitly *not* deleted on a later unrelated failure, so a transient error doesn't burn the user's verification.

**Login and 2FA:**
- **`login(req, res)`** — `POST /auth/login`. Validates credentials via `User.matchPassword()` (bcrypt compare). **Branches on `user.twoFactorEnabled`:** if `false`, issues a session token immediately (`signToken` + `buildSafeUser`) — identical behavior to before 2FA existed. If `true` (the default for every account), calls the shared `issueLoginOtp(user)` helper and returns `{twoFactorRequired: true, pending2faToken}` — **no session token or user object is included in this branch at all.**
- **`issueLoginOtp(user)`** (shared helper, not a route) — generates/hashes/stores a `LoginOtp` document (upserted, keyed by `userId`, enforcing the same 60s cooldown), emails it via `emailService.sendLoginOtpEmail()`, and signs a `pending2faToken` with payload `{userId: user._id.toString(), purpose: 'login_2fa'}`. **The payload key is `userId`, not `id`** — the same structural defense as the registration token, verified directly in this file.
- **`verifyLoginOtp(req, res)`** — `POST /auth/verify-login-otp`. Verifies the pending token's signature/purpose, loads the matching `LoginOtp` record, checks expiry and the 5-attempt cap, `bcrypt.compare()`s the code, and on success **deletes the `LoginOtp` record** (one-time use) before issuing the real session token.
- **`resendLoginOtp(req, res)`** — re-runs `issueLoginOtp` for the user identified by a still-valid `pending2faToken`.
- **`updateTwoFactor(req, res)`** — `PATCH /auth/two-factor`, behind `protect()`. Sets `req.user.twoFactorEnabled` from the request body and saves — operates only on the authenticated caller's own account (`req.user`, never an id from the body).

**Password change and reset:**
- **`changePassword(req, res)`** — `PATCH /auth/change-password`, behind `protect()`. Re-fetches the user **with the password field explicitly selected** (`.select('+password')` — `protect()`'s own lookup excludes it, since the schema marks it `select: false`), verifies `currentPassword` via `matchPassword()`, rejects if the new password equals the old one (via a direct `bcrypt.compare` against the stored hash), then **assigns `user.password = newPassword` as plaintext and calls `.save()`** — the hashing happens automatically in `models/User.js`'s pre-save hook (below); this function never calls `bcrypt.hash()` itself, which is exactly what prevents double-hashing.
- **`forgotPassword(req, res)`** — `POST /auth/forgot-password`, rate-limited. **Returns the identical generic message on every code path** — valid email, invalid-format email, unknown email, an email that's on cooldown, and even an unexpected internal error all produce the same `200` response body, `FORGOT_PASSWORD_GENERIC_MESSAGE`. Internally, only if a real user exists and is not on cooldown does it actually generate a token, upsert a `PasswordReset` document, and send the email — but none of that internal branching is ever visible to the caller.
- **`resetPassword(req, res)`** — `POST /auth/reset-password`, rate-limited. The submitted raw token is hashed and used as the **sole lookup key** into `PasswordReset` — no user id is ever accepted from the request body. Checks expiry, sets the new password (again via plaintext assignment + `.save()`, never manual hashing), and **deletes the `PasswordReset` record** on success. **Returns no session token** — the spec for this feature explicitly required that a password reset never auto-logs the user in, and this function has no `signToken()` call anywhere in it.

**H. Design Decisions (file-wide).** Every token type in this file that is *not* a full session token (`verificationToken`, `pending2faToken`) deliberately avoids a field literally named `id` in its JWT payload, for the single reason stated in `middleware/auth.js`'s entry above: `protect()` resolves any JWT with an `id` field to a real session, regardless of a `purpose` claim. This pattern appears three separate times in this file and is the project's primary defense against a partially-completed auth flow being escalated into a full session.

---

### File: `controllers/kyc.js`

**D. `verifyDocuments(req, res)`** — `POST /kyc/verify`. Requires `req.files.identity` (one file, via Multer); `400` if absent (and any `supporting` files that were already written to disk are cleaned up before returning, so a validation failure doesn't leave orphaned files). Creates a `Verification` document immediately (`status: 'Pending'`, `docType: 'Pending Classification'`) **before** calling the ML service — so the upload is never lost even if the ML service is down. Queries every *other* `Verification` record that has `extractedData.fields`, hashes their identifiers via `identityHash.js`'s `hashIdentityFields()` (never sending raw PII), and passes that as `existingIdentities` to `mlService.classifyDocument()`. On a reachable ML response, updates the `Verification` document's `docType`, `confidence`, `ocrText`, `extractedData`, `graphAnalysis`, and `decision` fields — and **only if `decision.status === 'success'`** does the top-level `status` field move away from `'Pending'`, mapped via `{approved: 'Approved', suspicious: 'Suspicious', rejected: 'Rejected'}`. An unreachable ML service leaves the record exactly as created — `Pending`, with no ML fields populated — rather than erroring the whole upload.

**D. `getHistory(req, res)`** — `GET /kyc/history`. **The ownership filter is one line:** `const filter = req.user.role === 'admin' ? {} : { user: req.user.id }`. For an admin, an additional `?name=<string>` query parameter is honored — trimmed, regex-escaped (`escapeRegex`, defined in this file), and applied as a case-insensitive `RegExp` against the `name` field, merged into the same `filter` object used for the ownership query, **combined in one single `Verification.find(filter)` call** — never an unfiltered fetch followed by in-memory filtering. For a non-admin, the `name` parameter is simply never read, regardless of what's sent.

**H. Design Decisions.** The `escapeRegex` helper (`str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`) exists specifically so a user-supplied search string can't alter the meaning of the constructed regex or build an unintentionally expensive pattern — verified directly by testing with a deliberately regex-hostile name during development (§9.4).

---

### File: `controllers/admin.js`

**D. `listUsers(req, res)`** — `GET /admin/users`, behind `protect()` + `adminOnly()`. Uses `.select('name email role emailVerified twoFactorEnabled createdAt')` — an explicit field **allowlist**, so there is no field on the schema (password, anything else added later) that could leak through this endpoint by accident.

**D. `updateUserRole(req, res)`** — `PATCH /admin/users/:id/role`, body `{role}`. Validates the id is a real Mongo ObjectId and `role` is exactly `'admin'` or `'user'`. **Blocks self-modification**: `if (String(req.user._id) === String(target._id)) return 403`. **Blocks demoting the last admin**: if the target is currently an admin and is being set to `user`, counts other admins (`User.countDocuments({role:'admin', _id:{$ne: target._id}})`) and returns `400` if that count is zero.

**H. Design Decisions — a verified, honestly-documented limitation:** because this endpoint is itself admin-gated, the *caller* is always an admin distinct from a self-demotion attempt (which is already blocked separately). This means the "last admin" count check can only ever be reached when at least two admins exist — at which point demoting one always leaves the other, so the count is never actually zero in practice. **This was confirmed by direct testing, not assumed**: with a single admin, attempting self-demotion correctly hits the self-check message, not the last-admin message; no reachable test scenario triggers the last-admin message specifically. The code is not wrong — the outcome it protects (the system never reaching zero admins) is still fully guaranteed by the self-check — but the dedicated count-based branch is effectively dead code under the current endpoint design.

---

### File: `models/User.js`

Fields: `name` (required, trimmed), `email` (required, unique, lowercased, regex-validated), `password` (required, min length 6, `select: false` — never returned by a default query), `emailVerified` (Boolean, default `false`), `twoFactorEnabled` (Boolean, **default `true`**), `role` (enum `['admin', 'user']`, default `'user'`), `createdAt` (default `Date.now`).

**Pre-save hook** — hashes `password` with bcrypt (`genSalt(10)` + `hash`), but **only if `isModified('password')`**; otherwise returns immediately. The code comment documents a real bug that existed here and was fixed: Mongoose 9's async pre-save hooks are promise-based and are never passed a `next` callback, so an earlier version of this hook that called `next()` in the "password not modified" branch crashed with `"next is not a function"` — invisible for a long time because every earlier code path that called `.save()` also happened to modify the password, until the 2FA-toggle feature added the first `.save()` that didn't.

**Method `matchPassword(enteredPassword)`** — `bcrypt.compare()` against the stored hash.

---

### File: `models/Verification.js`

Fields, in the order the schema actually declares them: `user` (ObjectId ref `User`, required — the ownership field every query filters on), `name`/`initials` (denormalized from the uploader at creation time, so an admin's combined-user view doesn't need a join), `docType`, `docTypeSub`, `date` (default now), `confidence`, `status` (enum `Approved`/`Pending`/`Rejected`/`Suspicious`, default `Pending`), `details` (an object with `faceMatch`/`forgeryDetection`/`documentStatus`/`extractedName`/`extractedAddress` — **present on the schema but never written to by any controller code**, verified by grep; a leftover from earlier planning, documented here rather than silently omitted), `originalFilename`/`identityFile`/`supportingFiles`, `ocrText`, `extractedData` (`{documentType, extractionStatus, fields: Mixed}`), `graphAnalysis` (`{status, anomalyScore, riskLevel, signals, graphFeatures: Mixed}`), `decision` (`{status, decision, reasons, ruleVersion}`).

---

### File: `models/EmailVerification.js`, `models/LoginOtp.js`, `models/PasswordReset.js`

All three share one shape and purpose: a short-lived, single-purpose token store.

| | Keyed by | Secret field | Hash algorithm | TTL index on |
|---|---|---|---|---|
| `EmailVerification` | `email` (unique) | `otpHash` | bcrypt | `expiresAt`, `expireAfterSeconds: 0` |
| `LoginOtp` | `userId` (unique) | `otpHash` | bcrypt | same |
| `PasswordReset` | `userId` (unique) | `tokenHash` | SHA-256 | same |

The `unique` index on the owner field is what makes every "send a new OTP/token" operation an **upsert** rather than an insert — issuing a new one always replaces (invalidates) any prior one for that same owner, by construction, not by an extra explicit delete step. The `expireAfterSeconds: 0` TTL index is MongoDB's own periodic-sweep cleanup, explicitly documented in each file's comment as a convenience **only** — the actual expiry check used to accept/reject a code is always an explicit `Date.now()` comparison in the controller, since TTL sweeps don't run instantly.

---

### File: `services/emailService.js`

**D.** `getTransporter()` — lazily constructs and caches a single Nodemailer transporter from `SMTP_*` env vars; returns `null` (no error thrown) if any required var is missing. `isConfigured()` — boolean wrapper. Three send functions, one per email type, each with its own subject line and copy: `sendOtpEmail` ("Verify your VerifyAI email"), `sendLoginOtpEmail` ("Your VerifyAI login code"), `sendPasswordResetEmail` ("Reset your VerifyAI password", includes the reset link built from `FRONTEND_URL`). **Every one of the three catches its own `sendMail` failure and re-throws a single generic `Error('Email provider rejected the request')`** — the real SMTP error (which can include auth details) is never allowed to propagate to a caller; it exists only in the error object the caller may choose to log server-side.

### File: `services/identityHash.js`

Documented in full already in Chapter 2's discussion of `graph.py`, since the two files form one matched pair. The important fact restated here: `normalizeIdentityValue()` in this file and `_normalize_identity_value()` in `graph.py` must stay byte-for-byte identical, because the two languages don't share code — this is called out as a real, standing maintenance risk (Chapter 12).

### File: `services/mlService.js`

Documented in full in Chapter 2 (§ `app.py` connections). One addition: `classifyDocument()` uses an `AbortController` with an 8-second timeout (`ML_SERVICE_TIMEOUT_MS`), and distinguishes `reachable: false` (network-level failure — service down, DNS failure, timeout) from `reachable: true` with a non-2xx `status` (the service responded, just with an error for this particular file) — this distinction is what lets `kyc.js` know whether to treat the upload as "saved but not yet processed" versus "the ML service rejected this specific file."

---

### File: `scripts/promoteAdmin.js`

**A. Purpose.** The one-time, manually-run script that creates the system's first admin. **Not imported by `server.js` and never runs automatically** — this was a specific design requirement (never hardcode an automatic email-based promotion into startup or ordinary request handling).

**D.** A single hardcoded constant, `INITIAL_ADMIN_EMAIL`, normalized (trim + lowercase) before lookup. If no matching user exists, logs an error and exits with a non-zero code — **it never creates an account**. If the user already has `role: 'admin'`, logs that and exits 0 (idempotent, safe to re-run). Otherwise sets `role = 'admin'` and calls `.save()` — which touches only the `role` field, so the pre-save hook's `isModified('password')` guard (above) correctly skips re-hashing.

**I. Note for anyone publishing this repository:** the `INITIAL_ADMIN_EMAIL` constant currently holds a real email address belonging to this project's account owner. If this repository is made public, that value should be replaced with a placeholder or moved to an environment variable before publishing — this was flagged during the README-writing task and is repeated here for completeness.
