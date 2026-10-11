const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const EmailVerification = require('../models/EmailVerification');
const LoginOtp = require('../models/LoginOtp');
const PasswordReset = require('../models/PasswordReset');
const jwt = require('jsonwebtoken');
const { sendOtpEmail, sendLoginOtpEmail, sendPasswordResetEmail } = require('../services/emailService');

const buildSafeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  twoFactorEnabled: user.twoFactorEnabled,
  role: user.role
});

const signToken = (user) => {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: '30d'
  });
};

// Same email format used by the User model, kept here so this validates
// before any DB work happens.
const EMAIL_RE = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;

const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const VERIFICATION_TOKEN_EXPIRES_IN = '15m';
// Distinguishes this token from a normal login JWT so it can never be
// used as a Bearer token on a protected route (protect() looks up a user
// by decoded.id, which this token never carries) and can never be
// mistaken for one by this codebase's own logic.
const VERIFICATION_TOKEN_PURPOSE = 'email_verification';

const PENDING_2FA_TOKEN_EXPIRES_IN = '10m';
// Same reasoning as VERIFICATION_TOKEN_PURPOSE above: this token's payload
// key is `userId`, never `id` - middleware/auth.js's protect() resolves
// any JWT with an `id` claim to a real user regardless of `purpose`, so a
// field literally named `id` would make this replayable as a session
// token before OTP verification. Using `userId` instead makes that
// structurally impossible.
const PENDING_2FA_TOKEN_PURPOSE = 'login_2fa';

const RESET_TOKEN_EXPIRY_MINUTES = 15;

// crypto.randomInt is a CSPRNG - deliberately not Math.random(). Zero-pads
// so values like 7 become "000007", a valid 6-digit code.
const generateOtp = () => crypto.randomInt(0, 1000000).toString().padStart(6, '0');

// A reset token is high-entropy (256 bits) and URL-embedded, unlike the
// low-entropy 6-digit OTPs above - bcrypt's deliberate slowness buys
// nothing here since brute-forcing 2^256 possibilities is already
// infeasible, so a fast SHA-256 hash is the correct, standard choice for
// storing it. Only this hash is ever persisted; the raw token exists only
// in the email link and is never logged.
const generateResetToken = () => crypto.randomBytes(32).toString('hex');
const hashResetToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Shared by login() (first send) and resendLoginOtp() - generates a fresh
// OTP, hashes it, upserts the one-per-user LoginOtp record (respecting the
// same resend cooldown as the registration OTP flow), emails it, and signs
// the pending-2FA token the client exchanges for a real session after
// verifyLoginOtp(). Returns a result object rather than throwing so both
// callers can shape their own HTTP response around a cooldown/email
// failure without duplicating that logic.
const issueLoginOtp = async (user) => {
  const existing = await LoginOtp.findOne({ userId: user._id });
  if (existing) {
    const secondsSinceLastSend = (Date.now() - existing.lastSentAt.getTime()) / 1000;
    if (secondsSinceLastSend < RESEND_COOLDOWN_SECONDS) {
      const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceLastSend);
      return { ok: false, status: 429, message: `Please wait ${wait} seconds before requesting a new code.` };
    }
  }

  const otp = generateOtp();
  const salt = await bcrypt.genSalt(10);
  const otpHash = await bcrypt.hash(otp, salt);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await LoginOtp.findOneAndUpdate(
    { userId: user._id },
    { userId: user._id, otpHash, expiresAt, attempts: 0, lastSentAt: now },
    { upsert: true, setDefaultsOnInsert: true }
  );

  try {
    await sendLoginOtpEmail(user.email, otp);
  } catch (emailErr) {
    console.error('Failed to send login OTP email:', emailErr.message);
    return { ok: false, status: 502, message: 'Could not send the verification email. Please try again.' };
  }

  const pending2faToken = jwt.sign(
    { userId: user._id.toString(), purpose: PENDING_2FA_TOKEN_PURPOSE },
    process.env.JWT_SECRET,
    { expiresIn: PENDING_2FA_TOKEN_EXPIRES_IN }
  );

  return { ok: true, pending2faToken };
};

exports.sendEmailOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existing = await EmailVerification.findOne({ email: normalizedEmail });
    if (existing) {
      const secondsSinceLastSend = (Date.now() - existing.lastSentAt.getTime()) / 1000;
      if (secondsSinceLastSend < RESEND_COOLDOWN_SECONDS) {
        const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceLastSend);
        return res.status(429).json({
          success: false,
          message: `Please wait ${wait} seconds before requesting a new code.`
        });
      }
    }

    const otp = generateOtp();
    const salt = await bcrypt.genSalt(10);
    const otpHash = await bcrypt.hash(otp, salt);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Upsert: at most one EmailVerification record per email, ever -
    // this replaces any prior (expired or not) record for this address
    // rather than creating a duplicate.
    await EmailVerification.findOneAndUpdate(
      { email: normalizedEmail },
      {
        email: normalizedEmail,
        otpHash,
        expiresAt,
        attempts: 0,
        verified: false,
        lastSentAt: now
      },
      { upsert: true, setDefaultsOnInsert: true }
    );

    try {
      await sendOtpEmail(normalizedEmail, otp);
    } catch (emailErr) {
      // emailErr here is a generic provider-failure message (see
      // emailService.js) - never the API key, never OTP, safe to log.
      console.error('Failed to send OTP email:', emailErr.message);
      return res.status(502).json({
        success: false,
        message: 'Could not send the verification email. Please try again.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Verification code sent to your email.'
    });
  } catch (err) {
    console.error('Send email OTP error:', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong, please try again' });
  }
};

exports.verifyEmailOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and verification code are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const submittedOtp = String(otp).trim();

    if (!/^\d{6}$/.test(submittedOtp)) {
      return res.status(400).json({ success: false, message: 'Invalid verification code.' });
    }

    const record = await EmailVerification.findOne({ email: normalizedEmail });

    if (!record || record.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'Verification code expired. Please request a new code.'
      });
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        message: 'Too many attempts. Please request a new code.'
      });
    }

    const isMatch = await bcrypt.compare(submittedOtp, record.otpHash);

    if (!isMatch) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ success: false, message: 'Invalid verification code.' });
    }

    record.verified = true;
    await record.save();

    // Short-lived, registration-purpose-only token. It carries no user
    // id, so middleware/auth.js's protect() can never resolve it to a
    // real user - it is structurally incapable of standing in for a
    // login JWT.
    const verificationToken = jwt.sign(
      { email: normalizedEmail, purpose: VERIFICATION_TOKEN_PURPOSE },
      process.env.JWT_SECRET,
      { expiresIn: VERIFICATION_TOKEN_EXPIRES_IN }
    );

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully.',
      verificationToken
    });
  } catch (err) {
    console.error('Verify email OTP error:', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong, please try again' });
  }
};

exports.register = async (req, res) => {
  try {
    const { name, email, password, verificationToken } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!email || !String(email).trim()) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required' });
    }
    if (!verificationToken) {
      return res.status(400).json({
        success: false,
        message: 'Email verification is required before creating an account'
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // The frontend is never trusted to merely claim the email was
    // verified - this token is cryptographically signed by this same
    // server and checked for purpose + email binding + expiry.
    let decoded;
    try {
      decoded = jwt.verify(verificationToken, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: 'Email verification has expired or is invalid. Please verify your email again.'
      });
    }

    if (decoded.purpose !== VERIFICATION_TOKEN_PURPOSE || decoded.email !== normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email verification does not match this email address.'
      });
    }

    // Belt-and-braces: the token alone proves it was legitimately issued,
    // but this DB check is what makes the token single-use - it's
    // cleared the moment registration succeeds (see below).
    const verificationRecord = await EmailVerification.findOne({ email: normalizedEmail });
    if (!verificationRecord || !verificationRecord.verified) {
      return res.status(400).json({
        success: false,
        message: 'Email verification is required before creating an account'
      });
    }

    // role is always hardcoded here, never derived from req.body - public
    // registration can never create anything but a Normal User.
    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      password,
      emailVerified: true,
      role: 'user'
    });

    // One-time consumption: remove the verification record now that it
    // produced a real account. A retry after some OTHER failure (e.g. a
    // transient DB error) never reaches this line, so the token/record
    // stays usable for that retry - only a genuine success consumes it.
    await EmailVerification.deleteOne({ email: normalizedEmail });

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: { user: buildSafeUser(user) }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'Email is already registered' });
    }
    if (err.name === 'ValidationError') {
      const firstError = Object.values(err.errors)[0]?.message || 'Invalid registration data';
      return res.status(400).json({ success: false, message: firstError });
    }
    console.error('Register error:', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong, please try again' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide an email and password' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // 2FA defaults to on for every user. When it's off, behavior is
    // unchanged from before this feature existed - issue the real session
    // token immediately. When it's on, no token/user is returned here at
    // all; the client must complete verifyLoginOtp() first.
    if (!user.twoFactorEnabled) {
      const token = signToken(user);
      return res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
          token,
          user: buildSafeUser(user)
        }
      });
    }

    const otpResult = await issueLoginOtp(user);
    if (!otpResult.ok) {
      return res.status(otpResult.status).json({ success: false, message: otpResult.message });
    }

    return res.status(200).json({
      success: true,
      message: 'Verification code sent to your email.',
      data: {
        twoFactorRequired: true,
        pending2faToken: otpResult.pending2faToken
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong, please try again' });
  }
};

exports.verifyLoginOtp = async (req, res) => {
  try {
    const { pending2faToken, otp } = req.body;

    if (!pending2faToken || !otp) {
      return res.status(400).json({ success: false, message: 'Verification code is required' });
    }

    const submittedOtp = String(otp).trim();
    if (!/^\d{6}$/.test(submittedOtp)) {
      return res.status(400).json({ success: false, message: 'Invalid verification code.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(pending2faToken, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: 'Your session has expired. Please log in again.'
      });
    }

    if (decoded.purpose !== PENDING_2FA_TOKEN_PURPOSE || !decoded.userId) {
      return res.status(400).json({ success: false, message: 'Your session has expired. Please log in again.' });
    }

    const record = await LoginOtp.findOne({ userId: decoded.userId });

    if (!record || record.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'Verification code expired. Please request a new code.'
      });
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        message: 'Too many attempts. Please request a new code.'
      });
    }

    const isMatch = await bcrypt.compare(submittedOtp, record.otpHash);

    if (!isMatch) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ success: false, message: 'Invalid verification code.' });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(400).json({ success: false, message: 'Your session has expired. Please log in again.' });
    }

    // One-time consumption: this OTP can never be replayed for another
    // login once it has successfully produced a session.
    await LoginOtp.deleteOne({ userId: decoded.userId });

    const token = signToken(user);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: buildSafeUser(user)
      }
    });
  } catch (err) {
    console.error('Verify login OTP error:', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong, please try again' });
  }
};

exports.resendLoginOtp = async (req, res) => {
  try {
    const { pending2faToken } = req.body;

    if (!pending2faToken) {
      return res.status(400).json({ success: false, message: 'Your session has expired. Please log in again.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(pending2faToken, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ success: false, message: 'Your session has expired. Please log in again.' });
    }

    if (decoded.purpose !== PENDING_2FA_TOKEN_PURPOSE || !decoded.userId) {
      return res.status(400).json({ success: false, message: 'Your session has expired. Please log in again.' });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(400).json({ success: false, message: 'Your session has expired. Please log in again.' });
    }

    const otpResult = await issueLoginOtp(user);
    if (!otpResult.ok) {
      return res.status(otpResult.status).json({ success: false, message: otpResult.message });
    }

    return res.status(200).json({
      success: true,
      message: 'Verification code sent to your email.',
      data: {
        twoFactorRequired: true,
        pending2faToken: otpResult.pending2faToken
      }
    });
  } catch (err) {
    console.error('Resend login OTP error:', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong, please try again' });
  }
};

exports.updateTwoFactor = async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'enabled must be true or false' });
    }

    // req.user comes from protect() - always the authenticated caller's
    // own account, never an id taken from the request body.
    req.user.twoFactorEnabled = enabled;
    await req.user.save();

    return res.status(200).json({
      success: true,
      data: { user: buildSafeUser(req.user) }
    });
  } catch (err) {
    console.error('Update two-factor error:', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong, please try again' });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password, new password, and confirmation are required'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'New passwords do not match' });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    // req.user (from protect()) never carries the password field - the
    // query that loads it excludes it (select: false on the schema). Load
    // it again here, explicitly, only for this one comparison - never
    // trust a user id from the request body, only req.user.id.
    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    const isSameAsOld = await bcrypt.compare(newPassword, user.password);
    if (isSameAsOld) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from the current password'
      });
    }

    // Plaintext assignment only - User.js's pre('save') hook hashes this
    // automatically because isModified('password') is true. Hashing it
    // again here would double-hash and lock the account out.
    user.password = newPassword;
    await user.save();

    return res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error:', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong, please try again' });
  }
};

exports.getMe = async (req, res) => {
  return res.status(200).json({
    success: true,
    data: { user: buildSafeUser(req.user) }
  });
};

// Deliberately a single constant message, returned on every code path
// below (account found or not, on cooldown or not, email send failed or
// not) - this is what makes the endpoint "generic": nothing about the
// response can be used to learn whether an email is registered.
const FORGOT_PASSWORD_GENERIC_MESSAGE = 'If that email is registered, a password reset link has been sent.';

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !EMAIL_RE.test(String(email).trim())) {
      // Even this is deliberately the generic message, not a "please
      // provide a valid email" validation error - an attacker toggling
      // through hand-crafted request bodies should see an identical
      // response regardless of input shape.
      return res.status(200).json({ success: true, message: FORGOT_PASSWORD_GENERIC_MESSAGE });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (user) {
      const existing = await PasswordReset.findOne({ userId: user._id });
      const onCooldown = existing
        && (Date.now() - existing.lastRequestedAt.getTime()) / 1000 < RESEND_COOLDOWN_SECONDS;

      if (!onCooldown) {
        const rawToken = generateResetToken();
        const tokenHash = hashResetToken(rawToken);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);

        // Upsert: issuing a new token replaces (invalidates) any prior
        // one for this user, same one-record-per-owner convention as
        // LoginOtp/EmailVerification.
        await PasswordReset.findOneAndUpdate(
          { userId: user._id },
          { userId: user._id, tokenHash, expiresAt, lastRequestedAt: now },
          { upsert: true, setDefaultsOnInsert: true }
        );

        const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${rawToken}`;

        try {
          await sendPasswordResetEmail(user.email, resetUrl);
        } catch (emailErr) {
          // Logged server-side only (generic provider-failure message,
          // never the token/URL) - the client response below is
          // unaffected, so a send failure can't be distinguished from
          // "email not registered" or "on cooldown" by the caller.
          console.error('Failed to send password reset email:', emailErr.message);
        }
      }
    }

    return res.status(200).json({ success: true, message: FORGOT_PASSWORD_GENERIC_MESSAGE });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    // Still generic on an unexpected error - a 500 with a distinct body
    // would itself be a timing/shape side-channel.
    return res.status(200).json({ success: true, message: FORGOT_PASSWORD_GENERIC_MESSAGE });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;

    if (!token || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Reset token, new password, and confirmation are required'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'New passwords do not match' });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    // The token hash is the ONLY lookup key - never a user id from the
    // request body. Anyone presenting a valid, unexpired, unused token
    // (i.e. anyone who received the email) can reset that token's owner's
    // password; nothing here trusts client-asserted identity.
    const tokenHash = hashResetToken(String(token));
    const record = await PasswordReset.findOne({ tokenHash });

    if (!record || record.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'This password reset link is invalid or has expired. Please request a new one.'
      });
    }

    const user = await User.findById(record.userId);
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'This password reset link is invalid or has expired. Please request a new one.'
      });
    }

    // Plaintext assignment only - User.js's pre('save') hook hashes this
    // automatically. Hashing it again here would double-hash and lock the
    // account out.
    user.password = newPassword;
    await user.save();

    // One-time consumption: delete immediately so this exact token can
    // never be replayed, same convention as LoginOtp's post-verify delete.
    await PasswordReset.deleteOne({ _id: record._id });

    // No session token is issued here on purpose - the user must sign in
    // again with their new password (and will still hit login-time 2FA if
    // they have it enabled, since twoFactorEnabled is untouched by this).
    return res.status(200).json({ success: true, message: 'Password has been reset. Please sign in.' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong, please try again' });
  }
};
