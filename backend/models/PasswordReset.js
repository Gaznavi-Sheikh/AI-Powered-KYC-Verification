const mongoose = require('mongoose');

// One active reset token per user - forgotPassword() upserts this (never
// inserts a duplicate), so issuing a new token automatically invalidates
// any previous one for that user. Keyed by userId, not email, consistent
// with LoginOtp.js rather than EmailVerification.js's email-keyed shape.
const passwordResetSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  tokenHash: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  lastRequestedAt: {
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
// explicitly before accepting a reset token as valid.
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PasswordReset', passwordResetSchema);
