const fs = require('fs');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';
const ML_SERVICE_TIMEOUT_MS = 8000;

// Centralizes all communication with the Flask ML service - nothing else
// in the backend should call ML_SERVICE_URL directly.
//
// Distinguishes two different failure modes for the caller:
//   - reachable: false  -> Flask could not be reached at all (down, DNS
//     failure, timeout). No HTTP response exists.
//   - reachable: true, status: 400/503/etc. -> Flask responded with a
//     clean error for THIS file (e.g. unsupported PDF, model not loaded,
//     corrupted image). The service itself is fine.
// Never throws: the caller decides what each case means for the upload.
const classifyDocument = async (filePath, originalName, mimeType, currentUserId, existingIdentities) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ML_SERVICE_TIMEOUT_MS);

  try {
    const fileBuffer = await fs.promises.readFile(filePath);
    const blob = new Blob([fileBuffer], { type: mimeType || 'application/octet-stream' });

    const formData = new FormData();
    formData.append('document', blob, originalName);
    // Phase 8: for graph/anomaly analysis. existingIdentities already
    // contains only hashes (computed by identityHash.js before this call)
    // - never raw PAN/Aadhaar/passport/name values for any record other
    // than the one in this request.
    if (currentUserId) formData.append('current_user_id', String(currentUserId));
    formData.append('existing_identities', JSON.stringify(existingIdentities || []));

    const res = await fetch(`${ML_SERVICE_URL}/predict`, {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      console.error(`ML service responded with status ${res.status}`);
    }

    return { reachable: true, status: res.status, result: data };
  } catch (err) {
    // Network-level failure only: connection refused (Flask not running),
    // timeout/abort, DNS failure, etc.
    console.error('ML service communication error:', err.message);
    return { reachable: false, status: null, result: null };
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = { classifyDocument };
