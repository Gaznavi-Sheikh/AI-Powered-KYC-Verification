// Must always be chained AFTER protect (which sets req.user from a fresh
// DB lookup on every request - see middleware/auth.js). req.user.role is
// therefore always the live database value, never a cached JWT claim, so
// a role change takes effect on the very next request even for an
// already-issued, still-valid token.
exports.adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};
