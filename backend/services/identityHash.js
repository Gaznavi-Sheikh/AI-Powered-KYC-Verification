const crypto = require('crypto');

// Canonical normalization + SHA-256 hashing for identity fields. Lets the
// graph layer (Phase 8) detect the same real-world PAN/Aadhaar/passport
// number/name appearing across different Verification records WITHOUT
// comparing or transmitting the raw value itself to the ML service for
// any record other than the one in the current request.
//
// IMPORTANT: this exact algorithm - trim, uppercase, strip ALL internal
// whitespace, then SHA-256 - MUST match
// ml-service/inference/graph.py's _normalize_identity_value()/
// _hash_identity_value() byte-for-byte. Node and Python don't share code,
// so if one side changes, the other must change identically, or the same
// real-world value will hash differently on each side and genuine
// cross-record matches will be silently missed.
const normalizeIdentityValue = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, '');
  return normalized.length > 0 ? normalized : null;
};

const hashIdentityValue = (value) => {
  const normalized = normalizeIdentityValue(value);
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
};

// Extracts hashable identifiers from one Verification's
// extractedData.fields, returning only the ones actually present.
// 'name' exists directly for PAN/Aadhaar; passport splits it into
// surname + given_name, so those are combined into one comparable value.
const hashIdentityFields = (fields) => {
  if (!fields || typeof fields !== 'object') return {};

  const hashes = {};

  ['pan_number', 'aadhaar_number', 'passport_number'].forEach((key) => {
    const h = hashIdentityValue(fields[key]);
    if (h) hashes[key] = h;
  });

  const name = fields.name || [fields.surname, fields.given_name].filter(Boolean).join(' ');
  const nameHash = hashIdentityValue(name);
  if (nameHash) hashes.name = nameHash;

  return hashes;
};

module.exports = { normalizeIdentityValue, hashIdentityValue, hashIdentityFields };
