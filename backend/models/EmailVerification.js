const mongoose = require('mongoose');

// One active OTP record per email - sendEmailOtp() upserts this (never
// inserts a duplicate), so there is at most one row per normalized email
// at any time.
const emailVerificationSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    unique: true
  },
  otpHash: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  attempts: {
    type: Number,
    default: 0
  },
  verified: {
    type: Boolean,
    default: false
  },
  lastSentAt: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// MongoDB TTL: once expiresAt passes, the document is eventually removed
// automatically. This is a cleanup convenience, NOT the expiry check
// itself - TTL sweeps run periodically (not instantly), so
// controllers/auth.js still compares expiresAt against Date.now()
// explicitly before accepting an OTP as valid.
emailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('EmailVerification', emailVerificationSchema);
