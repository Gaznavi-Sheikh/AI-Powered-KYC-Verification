// Minimal in-memory, IP-keyed, fixed-window rate limiter. No external
// dependency - the codebase already hand-rolls its one other piece of
// rate limiting (the OTP resend cooldown, via a lastSentAt timestamp
// comparison) rather than pulling in a library, so this follows the same
// pattern.
//
// Deliberate limitation: this state lives in process memory only. It
// resets on every server restart and does not coordinate across multiple
// server instances/processes. That is an acceptable tradeoff for this
// app's current single-process deployment, but it is NOT a
// production-grade distributed rate limiter - do not present it as one.
const createRateLimiter = ({ windowMs, max, message }) => {
  const hits = new Map(); // ip -> { count, windowStart }

  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = hits.get(ip);

    if (!entry || now - entry.windowStart >= windowMs) {
      hits.set(ip, { count: 1, windowStart: now });
      return next();
    }

    if (entry.count >= max) {
      return res.status(429).json({
        success: false,
        message: message || 'Too many requests. Please try again later.'
      });
    }

    entry.count += 1;
    return next();
  };
};

module.exports = { createRateLimiter };
