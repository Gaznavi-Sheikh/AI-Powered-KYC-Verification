## Chapter 1 — System Architecture

### 1.1 Three Independent Processes

The system is three separately-run processes that communicate over HTTP, plus one managed cloud database and two external APIs:

| Process | Technology | Entry point | Default port |
|---|---|---|---|
| Frontend | React 19 + Vite, served by Vite's dev server | `frontend/src/main.jsx` | 5173 (Vite default) / 8000 (used during this project's development) |
| Backend API | Node.js + Express 5 | `backend/server.js` | 5000 |
| ML service | Python 3.12 + Flask 3 | `ml-service/app.py` | 5001 |

MongoDB Atlas (cloud-managed), the Groq API (hosted LLM), and an SMTP server (Gmail, for OTP/reset emails) are the three external dependencies. There is no message queue, no cache layer, no background worker process, and no API gateway — every request is handled synchronously, end to end, inside a single HTTP request/response cycle.

![Logical architecture](diagrams/logical-architecture.png)

*Figure 1.1 — every arrow is a real, verified call path. The frontend never talks to the ML service or MongoDB directly; the backend is the only component with those credentials/connections.*

### 1.2 Project History: Two Divergent Designs

This repository contains evidence of **two different designs for the risk-analysis stage**, and it is important to be precise about which one is actually running:

1. **An earlier, more ambitious design** — described in `KYC_System_Deployment_Guide.pdf` and partially implemented in `notebooks/GNN Notebooks/` (`Aadhaar_GNN_model.ipynb`, `Pan_Card_GNN_model.ipynb`, `passport_GNN_model.ipynb`). This design called for a trained PyTorch GNN per document type, Sentence-Transformer embeddings, a three-tier AWS EC2/S3 deployment, and PM2 process management.
2. **The design actually implemented and running today** — `ml-service/inference/graph.py`. A code comment in `ml-service/requirements.txt` states the reason for the change directly: *"a trainable GNN is not used: with only ~15-20 real Verification records in this database, there isn't enough data for learned graph embeddings to represent genuine structure rather than noise."* The shipped implementation uses NetworkX's deterministic graph primitives (shared-identifier connections, node degree) instead — see Chapter 5.

**Verified facts supporting this conclusion:**
- `ml-service/requirements.txt` has no `torch-geometric` or `sentence-transformers` entry.
- `ml-service/inference/graph.py` imports only `re`, `hashlib`, and `networkx` — no PyTorch, no model loading.
- No `.pth` GNN model file is loaded by any code path in `ml-service/app.py` or `inference/*.py`.
- There is no AWS SDK, PM2 config, or Dockerfile anywhere in the tracked repository.

This manual documents design #2 throughout, because it is what the code actually does. Where design #1 is referenced (e.g. when explaining why a notebook exists), it is explicitly labeled as historical/unused.

### 1.3 Request/Response Boundary

The frontend authenticates with a JWT Bearer token and talks only to the backend's REST API (`/api/auth/*`, `/api/kyc/*`, `/api/admin/*`). The backend is the only component that:
- Holds the MongoDB connection.
- Holds the SMTP credentials.
- Calls the ML service (`backend/services/mlService.js`, which calls `POST http://<ML_SERVICE_URL>/predict`).

The ML service holds the Groq API key and is the only component that calls Groq. It has no database connection and no knowledge of users, sessions, or JWTs — it receives one document per request and already-hashed identifier data for the graph stage (see §5.5), and returns a single JSON response. It does not persist anything itself; persistence is entirely the backend's responsibility.

### 1.4 Authentication and Authorization Boundary

Every `backend` route except the public auth endpoints (register, login, OTP, password reset) requires a valid JWT in an `Authorization: Bearer <token>` header, checked by `middleware/auth.js`'s `protect()`. Admin-only routes additionally require `middleware/adminOnly.js`, chained after `protect()`. Both middleware modules are documented in full in Chapter 3.

A key architectural property, verified by direct testing during development: **`protect()` re-reads the user's role from MongoDB on every single request** — it does not decode role/permission data from the JWT itself (the JWT only ever carries `{ id }`). This means a role change (admin→user or the reverse) takes effect on the very next API call, even for a session token issued before the change. See Chapter 7 for the authentication sequence diagram and Chapter 9 for the RBAC request trace.

![Authentication sequence](diagrams/auth-sequence.png)

*Figure 1.2 — login with 2FA enabled (the default for every account). If `twoFactorEnabled` is false for that user, the flow collapses to just steps 1–3 with a direct token issuance — see §3.9.*

### 1.5 Deployment Reality (Local Development Only)

**Verified, not inferred:** `git ls-files` shows no Dockerfile, no `ecosystem.config.js` (PM2), no CI workflow file, and no AWS/Terraform configuration anywhere in this repository. `backend/package.json` and `ml-service/requirements.txt` contain no `aws-sdk`, `boto3`, or `pm2` dependency. The only way this project has been run, as far as the repository shows, is three local processes started manually (`node server.js`, `python app.py`, `npm run dev`).

![Runtime boundary — what actually exists today](diagrams/runtime-deployment.png)

*Figure 1.3 — this is the complete, current runtime picture. `KYC_System_Deployment_Guide.pdf`'s AWS EC2/S3 diagram describes infrastructure that does not exist in this repository; see Chapter 11 for what would actually be required to deploy this.*

### 1.6 Data Persistence Boundary

MongoDB Atlas holds five collections, all accessed exclusively through Mongoose from the backend (never from the ML service or the frontend). Three of the five are short-lived, TTL-indexed, single-purpose token stores; the other two are the actual application data. Full schemas are in Chapter 6.

![Data model relationships](diagrams/data-persistence.png)

*Figure 1.4 — `User` and `Verification` are the durable application data. The other three collections exist only for the lifetime of one OTP/reset flow and are deleted on successful use or by MongoDB's TTL sweep on expiry.*
