# AI-Powered KYC Verification System
## Complete Technical Documentation

**Document purpose:** a complete, source-verified technical reference for this repository — architecture, every significant source file, the machine-learning pipeline, API contracts, database schemas, configuration, setup, security posture, troubleshooting, and a structured interview-preparation section.

**Generated:** 2026-10-10
**Source of truth:** the actual repository at the time of writing, not the README, not `KYC_System_Deployment_Guide.pdf`, and not assumptions about what a typical KYC system does. Every claim in this manual was checked against source code, configuration files, or direct testing; where something could not be verified, it is labeled explicitly rather than guessed.

---

### Documentation Scope and Coverage Decisions

This manual applies **full depth** (purpose, execution context, every significant function/class with parameters and return values, control flow, connections to other files, and failure scenarios) to the files that determine the system's actual behavior:

- The entire ML service: `app.py` and all six `inference/` modules.
- The entire backend auth/authorization/KYC layer: all controllers, middleware, models, and services.
- The frontend's authentication and core-workflow components: `AuthContext.jsx`, `api.js`, `Upload.jsx`, `Login.jsx`, `Register.jsx`, `ChatHistory.jsx`, `UserManagement.jsx`, `Account.jsx`, `ProtectedRoute.jsx`, `DashboardLayout.jsx`.

It applies **concise but accurate** treatment (purpose, key behavior, what it reuses from an already-documented pattern) to:

- `ForgotPassword.jsx` / `ResetPassword.jsx` (structurally mirror `Login.jsx`'s OTP-step pattern, documented in full there).
- `Landingpage.jsx`, `Learnmore.jsx` (marketing/informational pages with no business logic).
- All `.css` files (pure styling, no logic — listed by purpose, not line-by-line).

This split is a deliberate choice to keep the manual's length proportional to where the actual engineering risk and complexity live, rather than giving a CSS file the same page count as the authentication controller. Every file in the repository is at least listed and categorized in the File Inventory.

**What could not be verified and is stated as such throughout:** the exact internal layer structure of the trained CNN beyond what the training notebook's cells show; any runtime performance/memory figures (none were measured); the GNN/embedding architecture described in `KYC_System_Deployment_Guide.pdf` and the `GNN Notebooks/` folder, because **that code path is not part of the running application** (see "Project History: Two Divergent Designs" in the Architecture chapter).

**What this manual will not claim:** that the system is production-ready, legally compliant, free of security gaps, or that its ML components achieve any particular accuracy. No accuracy/precision/recall figures exist anywhere in this repository, so none are reported here.
