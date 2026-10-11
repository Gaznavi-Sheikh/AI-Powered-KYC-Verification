const mongoose = require('mongoose');

// One active login OTP per user - verifyLoginOtp()/login() upsert this
// (never insert a duplicate), so there is at most one row per userId at
// any time. Keyed by userId rather than email so this can never collide
// with an in-flight registration OTP in EmailVerification for the same
// address - those are two separate collections for two separate purposes.
const loginOtpSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
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
loginOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('LoginOtp', loginOtpSchema);
