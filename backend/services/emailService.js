// Brevo Transactional Email API (POST /v3/smtp/email) - replaces the former
// Nodemailer/SMTP transport. Uses Node's built-in fetch (Node 18+), so no
// extra dependency is needed. The public functions below keep the exact
// signatures, subjects and HTML bodies they had under SMTP.

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const REQUEST_TIMEOUT_MS = 15000;

const isConfigured = () =>
  Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL);

// Central send routine. Throws a generic Error on any failure so callers
// (controllers/auth.js) can never mistake a failed request for success.
// Logs only non-sensitive diagnostics: HTTP status, Brevo error code and
// message - never the API key, recipient address, OTP or reset URL.
const sendEmail = async ({ toEmail, subject, html }) => {
  if (!isConfigured()) {
    throw new Error('Email service is not configured');
  }

  // Tolerate BREVO_SENDER_EMAIL given as "Name <addr@host>" (the old
  // SMTP_FROM style) as well as a bare address.
  const rawSender = process.env.BREVO_SENDER_EMAIL.trim();
  const match = rawSender.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const sender = { email: match ? match[2].trim() : rawSender };
  const senderName = (match && match[1]) || process.env.BREVO_SENDER_NAME;
  if (senderName) sender.name = senderName;

  let response;
  try {
    response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        sender,
        to: [{ email: toEmail }],
        subject,
        htmlContent: html
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (err) {
    console.error('Brevo email request failed (network/timeout):', err.name);
    throw new Error('Email provider rejected the request');
  }

  if (!response.ok) {
    let code;
    let message;
    try {
      const body = await response.json();
      code = body.code;
      message = body.message;
    } catch (_) {
      // non-JSON error body - status alone is logged
    }
    console.error('Brevo email API error:', { status: response.status, code, message });
    throw new Error('Email provider rejected the request');
  }
};

const sendOtpEmail = async (toEmail, otp) => {
  await sendEmail({
    toEmail,
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
};

const sendLoginOtpEmail = async (toEmail, otp) => {
  await sendEmail({
    toEmail,
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
};

const sendPasswordResetEmail = async (toEmail, resetUrl) => {
  await sendEmail({
    toEmail,
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
};

module.exports = { sendOtpEmail, sendLoginOtpEmail, sendPasswordResetEmail, isConfigured };
