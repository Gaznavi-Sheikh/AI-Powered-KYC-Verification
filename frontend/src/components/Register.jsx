import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../services/api";
import "../styles/Register.css";

const PIPELINE_POINTS = [
  "Document classification",
  "OCR extraction",
  "AI identity extraction",
  "Graph-based risk analysis",
  "Explainable decisions"
];

const RESEND_COOLDOWN_SECONDS = 60;
const OTP_LENGTH = 6;

function Register() {
  const navigate = useNavigate();

  // 'details' -> name/email entry, 'otp' -> 6-digit code entry,
  // 'verified' -> email confirmed, password fields unlocked.
  const [step, setStep] = useState("details");

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: ""
  });

  const [otpDigits, setOtpDigits] = useState(Array(OTP_LENGTH).fill(""));
  // The verification token only ever lives in component state - never
  // localStorage - and is discarded the moment registration finishes
  // (success or failure) or the component unmounts.
  const [verificationToken, setVerificationToken] = useState(null);

  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [registering, setRegistering] = useState(false);

  const [detailsError, setDetailsError] = useState("");
  const [otpError, setOtpError] = useState("");
  const [registerError, setRegisterError] = useState("");

  const [cooldown, setCooldown] = useState(0);

  const otpRefs = useRef([]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setDetailsError("");

    if (!formData.name.trim()) {
      setDetailsError("Full name is required");
      return;
    }
    if (!formData.email.trim()) {
      setDetailsError("Email is required");
      return;
    }

    setSendingOtp(true);
    try {
      const { ok, data } = await authApi.sendEmailOtp(formData.email.trim());

      if (!ok || !data.success) {
        setDetailsError(data.message || "Could not send verification code. Please try again.");
        return;
      }

      setOtpDigits(Array(OTP_LENGTH).fill(""));
      setOtpError("");
      setStep("otp");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } catch (err) {
      console.error("sendEmailOtp failed:", err);
      setDetailsError(`Unable to reach the server: ${err.message}`);
    } finally {
      setSendingOtp(false);
    }
  };

  const handleResendOtp = async () => {
    if (cooldown > 0 || sendingOtp) return;
    setOtpError("");
    setSendingOtp(true);
    try {
      const { ok, data } = await authApi.sendEmailOtp(formData.email.trim());
      if (!ok || !data.success) {
        setOtpError(data.message || "Could not send verification code. Please try again.");
        return;
      }
      setOtpDigits(Array(OTP_LENGTH).fill(""));
      setCooldown(RESEND_COOLDOWN_SECONDS);
      otpRefs.current[0]?.focus();
    } catch (err) {
      console.error("resend sendEmailOtp failed:", err);
      setOtpError(`Unable to reach the server: ${err.message}`);
    } finally {
      setSendingOtp(false);
    }
  };

  const handleChangeEmail = () => {
    setStep("details");
    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setOtpError("");
    setCooldown(0);
  };

  const handleOtpDigitChange = (index, value) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...otpDigits];
    next[index] = digit;
    setOtpDigits(next);
    setOtpError("");

    if (digit && index < OTP_LENGTH - 1) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!pasted) return;
    e.preventDefault();
    const next = Array(OTP_LENGTH).fill("");
    for (let i = 0; i < pasted.length; i += 1) next[i] = pasted[i];
    setOtpDigits(next);
    const focusIndex = Math.min(pasted.length, OTP_LENGTH - 1);
    otpRefs.current[focusIndex]?.focus();
  };

  const otpCode = otpDigits.join("");
  const otpComplete = otpCode.length === OTP_LENGTH;

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otpComplete) return;

    setOtpError("");
    setVerifyingOtp(true);
    try {
      const { ok, data } = await authApi.verifyEmailOtp(formData.email.trim(), otpCode);

      if (!ok || !data.success) {
        setOtpError(data.message || "Invalid verification code.");
        setOtpDigits(Array(OTP_LENGTH).fill(""));
        otpRefs.current[0]?.focus();
        return;
      }

      setVerificationToken(data.verificationToken);
      setStep("verified");
    } catch (err) {
      console.error("verifyEmailOtp failed:", err);
      setOtpError(`Unable to reach the server: ${err.message}`);
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setRegisterError("");

    if (!verificationToken) {
      // Should not be reachable from the UI, but never let a request
      // without a real token leave this component.
      setRegisterError("Email verification is required before creating an account.");
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setRegisterError("Passwords do not match");
      return;
    }

    setRegistering(true);
    try {
      const { ok, data } = await authApi.register(
        formData.name.trim(),
        formData.email.trim(),
        formData.password,
        verificationToken
      );

      if (!ok || !data.success) {
        setRegisterError(data.message || "Registration failed. Please try again.");
        return;
      }

      setVerificationToken(null);
      navigate("/");
    } catch (err) {
      console.error("register failed:", err);
      setRegisterError(`Unable to reach the server: ${err.message}`);
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="auth-split">
      <div className="auth-side auth-side-brand">
        <div className="auth-brand-inner">
          <div className="auth-brand-logo" onClick={() => navigate("/")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5l-8-3z" />
              <polyline points="9 12 11 14 15 10" />
            </svg>
            <span>VerifyAI</span>
          </div>

          <h1 className="auth-brand-title">Intelligent KYC verification for modern compliance workflows.</h1>

          <ul className="auth-brand-points">
            {PIPELINE_POINTS.map((p) => (
              <li key={p}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="auth-side auth-side-form">
        <div className="auth-card">
          <h2>Create your VerifyAI account</h2>
          <p className="subtitle">Start using the intelligent KYC verification workflow.</p>

          {/* ===== Step 1: name + email ===== */}
          {step === "details" && (
            <>
              {detailsError && <p className="auth-error" role="alert">{detailsError}</p>}

              <form onSubmit={handleSendOtp}>
                <div className="input-group">
                  <label htmlFor="reg-name">Full Name</label>
                  <input
                    id="reg-name"
                    type="text"
                    name="name"
                    autoComplete="name"
                    required
                    value={formData.name}
                    onChange={handleChange}
                  />
                </div>

                <div className="input-group">
                  <label htmlFor="reg-email">Email</label>
                  <input
                    id="reg-email"
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                  />
                </div>

                <button type="submit" className="register-btn" disabled={sendingOtp}>
                  {sendingOtp ? "Sending..." : "Send OTP"}
                </button>
              </form>
            </>
          )}

          {/* ===== Step 2: OTP entry ===== */}
          {step === "otp" && (
            <>
              <p className="otp-hint">
                We've sent a 6-digit verification code to <strong>{formData.email}</strong>.
              </p>

              {otpError && <p className="auth-error" role="alert">{otpError}</p>}

              <form onSubmit={handleVerifyOtp}>
                <div className="otp-boxes" onPaste={handleOtpPaste}>
                  {otpDigits.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { otpRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={1}
                      autoComplete="one-time-code"
                      className="otp-box"
                      value={digit}
                      onChange={(e) => handleOtpDigitChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      aria-label={`Digit ${i + 1} of verification code`}
                    />
                  ))}
                </div>

                <button type="submit" className="register-btn" disabled={!otpComplete || verifyingOtp}>
                  {verifyingOtp ? "Verifying..." : "Verify OTP"}
                </button>
              </form>

              <div className="otp-actions">
                <button type="button" className="link-btn" onClick={handleChangeEmail}>
                  Change email
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={handleResendOtp}
                  disabled={cooldown > 0 || sendingOtp}
                >
                  {cooldown > 0 ? `Resend available in ${cooldown}s` : (sendingOtp ? "Sending..." : "Resend code")}
                </button>
              </div>
            </>
          )}

          {/* ===== Step 3: verified, password entry ===== */}
          {step === "verified" && (
            <>
              <p className="otp-verified">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Email Verified
              </p>

              {registerError && <p className="auth-error" role="alert">{registerError}</p>}

              <form onSubmit={handleRegister}>
                <div className="input-group">
                  <label htmlFor="reg-password">Password</label>
                  <input
                    id="reg-password"
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    required
                    value={formData.password}
                    onChange={handleChange}
                  />
                </div>

                <div className="input-group">
                  <label htmlFor="reg-confirm-password">Confirm Password</label>
                  <input
                    id="reg-confirm-password"
                    type="password"
                    name="confirmPassword"
                    autoComplete="new-password"
                    required
                    value={formData.confirmPassword}
                    onChange={handleChange}
                  />
                </div>

                <button type="submit" className="register-btn" disabled={registering}>
                  {registering ? "Creating account..." : "Create Account"}
                </button>
              </form>
            </>
          )}

          <div className="extra-links">
            <span>Already have an account?</span>
            <a href="/">Sign In</a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Register;
