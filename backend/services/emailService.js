const nodemailer = require('nodemailer');

let transporter = null;

// Lazily creates and caches the Nodemailer transporter. No network call
// happens here - just checks the config is present and constructs the
// transport object.
const getTransporter = () => {
  if (transporter) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE === 'true',
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  return transporter;
};

const isConfigured = () => getTransporter() !== null;

const sendOtpEmail = async (toEmail, otp) => {
  const transport = getTransporter();
  if (!transport) {
    throw new Error('Email service is not configured');
  }

  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

  try {
    await transport.sendMail({
      from: fromEmail,
      to: toEmail,
      subject: 'Verify your VerifyAI email',
      html: `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color:#0F172A; margin: 0 0 4px;">VerifyAI</h2>
        <p style="color:#334155; font-size: 15px; margin: 0 0 20px;">Verify your email address</p>
        <p style="color:#64748B; font-size: 14px; margin: 0 0 8px;">Your verification code is:</p>
        <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #18BCEB; margin: 8px 0 20px;">${otp}</div>
        <p style="color:#64748B; font-size: 13px; margin: 0 0 16px;">This code expires in 10 minutes.</p>
        <p style="color:#94A3B8; font-size: 12px; margin: 0;">If you did not create a VerifyAI account, you can ignore this email.</p>
      </div>
    `
    });
  } catch (err) {
    // Never let SMTP's own error object (can include auth/transport
    // detail) propagate as-is - normalize to a generic message. The
    // caller (controllers/auth.js) logs err.message server-side only.
    const safeMessage = String(err.message || 'Unknown email error')
    .replace(process.env.SMTP_PASS || '\u0000', '[REDACTED]');

  console.error('Password reset email SMTP failure:', {
    code: err.code,
    responseCode: err.responseCode,
    command: err.command,
    message: safeMessage
  });

  throw new Error('Email provider rejected the request');
}
  //   throw new Error('Email provider rejected the request');
  // }
};

const sendLoginOtpEmail = async (toEmail, otp) => {
  const transport = getTransporter();
  if (!transport) {
    throw new Error('Email service is not configured');
  }

  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

  try {
    await transport.sendMail({
      from: fromEmail,
      to: toEmail,
      subject: 'Your VerifyAI login code',
      html: `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color:#0F172A; margin: 0 0 4px;">VerifyAI</h2>
        <p style="color:#334155; font-size: 15px; margin: 0 0 20px;">Confirm it's you</p>
        <p style="color:#64748B; font-size: 14px; margin: 0 0 8px;">Someone signed in to your account and needs this code to continue:</p>
        <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #18BCEB; margin: 8px 0 20px;">${otp}</div>
        <p style="color:#64748B; font-size: 13px; margin: 0 0 16px;">This code expires in 10 minutes.</p>
        <p style="color:#94A3B8; font-size: 12px; margin: 0;">If this wasn't you, change your password as soon as possible.</p>
      </div>
    `
    });
  } catch (err) {
    // Never let SMTP's own error object (can include auth/transport
    // detail) propagate as-is - normalize to a generic message. The
    // caller (controllers/auth.js) logs err.message server-side only.
    throw new Error('Email provider rejected the request');
  }
};

const sendPasswordResetEmail = async (toEmail, resetUrl) => {
  const transport = getTransporter();
  if (!transport) {
    throw new Error('Email service is not configured');
  }

  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

  try {
    await transport.sendMail({
      from: fromEmail,
      to: toEmail,
      subject: 'Reset your VerifyAI password',
      html: `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color:#0F172A; margin: 0 0 4px;">VerifyAI</h2>
        <p style="color:#334155; font-size: 15px; margin: 0 0 20px;">Reset your password</p>
        <p style="color:#64748B; font-size: 14px; margin: 0 0 20px;">We received a request to reset your password. Click the button below to choose a new one:</p>
        <a href="${resetUrl}" style="display:inline-block; background:#18BCEB; color:#04141C; font-weight:700; font-size:14px; padding:12px 24px; border-radius:10px; text-decoration:none; margin-bottom:20px;">Reset Password</a>
        <p style="color:#64748B; font-size: 13px; margin: 0 0 16px;">This link expires in 15 minutes and can only be used once.</p>
        <p style="color:#94A3B8; font-size: 12px; margin: 0;">If you did not request a password reset, you can safely ignore this email - your password will not be changed.</p>
      </div>
    `
    });
  } catch (err) {
    // Never let SMTP's own error object (can include auth/transport
    // detail) propagate as-is - normalize to a generic message. The
    // caller (controllers/auth.js) logs err.message server-side only.
    throw new Error('Email provider rejected the request');
  }
};

module.exports = { sendOtpEmail, sendLoginOtpEmail, sendPasswordResetEmail, isConfigured };
