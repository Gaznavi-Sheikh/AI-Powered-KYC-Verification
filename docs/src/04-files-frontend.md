## Chapter 4 — Source Code Reference: Frontend

All paths relative to `frontend/src/`.

---

### File: `context/AuthContext.jsx`

**A. Purpose.** The single source of truth for "who is logged in" across the entire SPA — a React Context provider wrapping the app.

**D. State.** `user` (the `buildSafeUser`-shaped object from the backend, or `null`), `token` (initialized from `localStorage.getItem('kyc_token')`), `loading` (true until the initial session check completes).

**D. Effects and functions.**
- A mount-time `useEffect` with no dependencies: if no token exists in `localStorage`, sets `loading: false` and stops. Otherwise calls `authApi.me(token)`. On success, sets `user`. **On a `401` specifically**, clears the token (treats it as a genuinely invalid/expired session). **On any other failure (network error, 5xx)**, the token is deliberately left alone — the code comment explains this is so a transient backend restart doesn't silently log the user out.
- **`login(newToken, userData)`** — the only function that establishes a session: writes the token to `localStorage` and sets both `token` and `user` state. Called by `Login.jsx`, `Register.jsx`, `ResetPassword.jsx` (indirectly — reset does not call this, by design) only after a real, complete authentication success.
- **`logout()`** — clears `localStorage` and both state values.
- **`updateUser(partial)`** — merges a partial object into the existing `user` state (e.g. `{twoFactorEnabled: false}` after a Settings toggle) without touching `localStorage` or re-fetching — added specifically so `Account.jsx`'s 2FA toggle and `UserManagement.jsx`'s role changes can reflect immediately without a full page reload.

**G. Connections.** Every component in the app that needs to know the current user or make an authenticated request calls `useAuth()`, the hook this file exports. It is the only file that touches `localStorage` for the session token.

**H. Design Decisions.** `user` itself is never persisted to `localStorage` — only the token is. This means a hard refresh always re-derives `user` from a fresh `/auth/me` call, which is also what guarantees a role change is reflected after a reload (consistent with the backend's live-lookup design in Chapter 3).

---

### File: `services/api.js`

**A. Purpose.** The only file in the frontend that constructs a `fetch()` call to the backend — every component goes through this.

**D.** `request(path, {method, body, token})` — a shared helper: sets `Content-Type: application/json`, adds `Authorization: Bearer <token>` if a token was passed, JSON-stringifies the body, and always returns `{ok, status, data}` (never throws for a non-2xx response — a component checks `ok`/`data.success` itself). `authApi` exports one function per backend auth endpoint (11 total, matching Chapter 8's API reference exactly). `adminApi` exports `listUsers` and `updateUserRole`. `kycApi.verify` is the one exception to the shared `request()` helper — it builds a `FormData` body directly (for the multipart file upload) and does not set a `Content-Type` header itself, deliberately, so the browser can set the correct multipart boundary. `kycApi.history(token, nameSearch)` appends `?name=<encoded>` to the URL only when `nameSearch` is truthy.

---

### File: `components/ProtectedRoute.jsx`

**D.** Wraps `children`. While `loading`, renders a centered "Checking session..." message. If not authenticated, `<Navigate to="/login" replace />`. **New prop: `adminOnly`** — if set and `user?.role !== 'admin'`, redirects to `/upload`. The code comment is explicit that this check is a **UX convenience only** — the real security boundary is the backend's `adminOnly` middleware (Chapter 3); this component existing or being bypassed has no bearing on whether the API actually permits the request.

---

### File: `components/DashboardLayout.jsx`

**A. Purpose.** The shared shell (sidebar + topbar) wrapping every authenticated page (`Upload`, `ChatHistory`, `Account`, `UserManagement`).

**D.** `PAGE_TITLES` — a path-to-title lookup used for the topbar breadcrumb. Sidebar navigation links: New Verification, Verification History, Settings, and — **conditionally, only when `user?.role === 'admin'`** — User Management. A mobile hamburger menu with its own open/close state and a backdrop overlay. A user-profile dropdown with Sign Out (which calls `useAuth().logout()` after a `window.confirm`).

**H. Design Decisions.** The admin nav item's visibility check is the frontend half of the same "hide, don't rely on hiding" pattern as `ProtectedRoute`'s `adminOnly` — both exist purely so a non-admin's UI doesn't show controls that would just fail server-side anyway.

---

### File: `components/Login.jsx`

**A. Purpose.** A two-step state machine: credentials, then (conditionally) a 2FA OTP step.

**D. State.** `step` (`'credentials'` | `'otp'`), `formData` (`email`, `password`), `otpDigits` (array of 6 single-character strings), `pending2faToken` (held only in component state — **never written to `localStorage`**), `cooldown` (resend timer, driven by a `useEffect`/`setInterval` pair).

**E. Execution logic.** `handleSubmitCredentials` calls `authApi.login`. If the response has `data.twoFactorRequired`, stores `pending2faToken`, resets the OTP boxes, switches to the `'otp'` step, and starts the 60-second cooldown. Otherwise (2FA disabled for that account) it calls `useAuth().login(token, user)` directly and navigates to `/upload` — identical to the pre-2FA behavior. `handleVerifyOtp` calls `authApi.verifyLoginOtp`; success calls `login()` + navigates, failure clears the boxes and shows the server's message. Digit input handling (`handleOtpDigitChange`, `handleOtpKeyDown`, `handleOtpPaste`) implements auto-advance-on-type, backspace-to-previous-box, and paste-a-full-code-at-once — this exact pattern is reused unchanged in `Register.jsx`'s own OTP step.

**I. Failure Scenarios.** Every `catch` block around a fetch call sets an error state to the *actual* caught error's message (e.g. `Unable to reach the server: Failed to fetch`) rather than a generic string — a deliberate choice made during development specifically because a generic message had previously made a real connectivity bug very hard to diagnose from the UI alone (§13, Troubleshooting).

---

### File: `components/Register.jsx`

Structurally the same three-step pattern as `Login.jsx`'s OTP step, extended with a third step: `'details'` (name/email) → `'otp'` (6-digit code, identical digit-handling code to `Login.jsx`) → `'verified'` (password + confirm-password fields, unlocked only after OTP success). The `verificationToken` returned by OTP verification is held only in component state and sent once, with the final `register()` call — never stored in `localStorage`.

### File: `components/ForgotPassword.jsx`

A single email field and a "Send Reset Link" button. **Always shows the identical success message after a submission that the backend accepted** (`If that email is registered, a password reset link has been sent...`) — the component does not and cannot distinguish "email exists" from "email doesn't exist," because the backend's response is itself generic (Chapter 3).

### File: `components/ResetPassword.jsx`

Reads `token` from the URL query string via `useSearchParams()`. New-password + confirm-password fields with independent show/hide toggles. Client-side validates length and match before submitting (mirroring, not replacing, the backend's own validation). On success, shows a confirmation and a link to `/login` — **it does not call `useAuth().login()`**, consistent with the backend never issuing a session token for this flow.

---

### File: `components/Upload.jsx` (610 lines — the largest frontend component)

**A. Purpose.** The "New Verification" page: file selection for the required identity document and optional supporting documents, the upload action, and the results display.

**D. State machine.** `aiStatus`: `'idle'` → `'scanning'` → `'results'`. `mainFile` / `supportingFiles` (File objects, browser-only, never persisted). `result` (the full `data.data` object from the backend's `/kyc/verify` response, stored as-is once received).

**D. Key functions.** `getStageStates(aiStatus, result)` — a pure function (not a component) that derives a truthful per-stage UI status (`waiting`/`processing`/`completed`/`pending`/`failed`/`skipped`) for each of the five pipeline stages **from the actual response fields**, never from elapsed time. For example: the classification stage is `'failed'` if `docType` is still the placeholder `'Pending Classification'`; the extraction stage reads `extraction.extractionStatus` directly; if classification itself failed, every later stage is marked `'skipped'` rather than guessed. During the `'scanning'` state (before any response exists), every stage is shown collectively as `'processing'` — the code comment is explicit that this is because the backend returns one final result, not incremental per-stage events, so showing a specific stage as "currently running" would be a fabrication.

**D. `handleStartVerification`** — calls `kycApi.verify(token, mainFile, supportingFiles)`; on success stores the full response in `result` and moves to `'results'`; on failure shows the real error message and returns to `'idle'`.

**D. Results rendering.** A `DECISION_DISPLAY` lookup maps `approved`/`suspicious`/`rejected` to a label, CSS class, and (for suspicious/rejected) an explanatory note. **If `decision.status !== 'success'`**, the UI explicitly shows "Pending" rather than defaulting to any particular decision — there is no code path that displays an decision the backend didn't actually return. Extracted fields are rendered through a `maskValue(key, value)` helper that partially masks `pan_number`/`aadhaar_number`/`passport_number` (showing only the last 4 characters) before display.

**H. Design Decisions.** This file went through several iterations during development specifically to remove fabricated progress indication (a numeric percentage progress bar was replaced with a genuine CSS-only indeterminate animation) — documented here as a real example of a UI choice that was deliberately made *less* flashy in order to stay truthful to what the backend can actually report.

---

### File: `components/ChatHistory.jsx`

**A. Purpose.** The "Verification History" page — a metrics summary, a filter bar, and a results table.

**D.** `isAdmin = user?.role === 'admin'`. Four filters: `searchTerm` (admin-only, debounced 300ms before being sent to the backend as `?name=`), `statusFilter`, `dateFilter`, `docFilter` (the latter three applied client-side to whatever record set the backend already returned). The search input itself is only rendered in the DOM at all when `isAdmin` is true — a non-admin user never receives this control, consistent with the backend ignoring the parameter for them regardless. A `filtersActive` flag drives a "Clear filters" affordance, and the empty-state message is context-aware: it distinguishes "no records exist at all" from "your filters matched nothing" from "no admin search results for this name" — three different messages for three different real situations, rather than one generic "no data" message in all cases.

---

### File: `components/UserManagement.jsx`

**A. Purpose.** The admin-only user list and role-management page.

**D.** Fetches `adminApi.listUsers(token)` on mount. Each row shows name/email/role badge/join date and, for every user except the currently logged-in admin themselves (`isSelf` check, disabled with "Not editable"), a Promote/Demote button. `handleRoleChange` shows a `window.confirm()` dialog naming the target user and the new role **before** calling `adminApi.updateUserRole` — no role change happens without this confirmation step. On success, updates the local list in place (no full re-fetch needed) via `setUsers`.

---

### File: `components/Account.jsx`

**A. Purpose.** The Settings page: profile display, Change Password (expand/collapse form), the 2FA toggle, and two notification toggles.

**D.** The 2FA toggle (`twoFactor` state) is initialized from `user?.twoFactorEnabled` and kept in sync via a `useEffect`; `handleToggleTwoFactor` calls `authApi.updateTwoFactor`, and on success calls `AuthContext`'s `updateUser()` so the change is reflected everywhere in the app immediately, not just in this component. The Change Password section is collapsed by default; clicking expands a form with three password fields (current/new/confirm), each with its own show/hide toggle, submitting to `authApi.changePassword`; on success the form collapses and a success message shows, on failure it stays open with the real error.

**I. Note.** The "Email Alerts for High Risk Fraud" and "Push Notifications for New Verifications" toggles on this page are **local component state only** — they call no API and persist nothing. This is flagged explicitly in Chapter 12 as a feature that looks implemented in the UI but is not backed by any real functionality.

---

### Concise entries: remaining components

- **`components/Landingpage.jsx`** — the public marketing page. No business logic; contains the product description, a pipeline-stage overview, and navigation links to `/login` and `/register`. Its content was specifically reviewed during development to ensure it describes the deterministic graph analysis accurately (never calling it a trained GNN) and makes no fabricated accuracy/customer claims.
- **`components/Learnmore.jsx`** — a secondary informational page, similarly static.
- **CSS files** (`styles/*.css`) — one stylesheet per auth page plus a shared `dashboard.css`; pure presentation, no logic. `Login.css` is the shared base that `Register.css`, `ForgotPassword.css`, and `ResetPassword.css` all `@import`, which is why the six-digit OTP box styling, the input show/hide toggle, and the generic auth-error/auth-success banners look identical across all four pages — they are, literally, the same CSS rules.
