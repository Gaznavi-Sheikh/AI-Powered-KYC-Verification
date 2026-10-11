import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../services/api";
import { useAuth } from "../context/AuthContext";
import "../styles/Login.css";

const PIPELINE_POINTS = [
  "Document classification",
  "OCR extraction",
  "AI identity extraction",
  "Graph-based risk analysis",
  "Explainable decisions"
];

const RESEND_COOLDOWN_SECONDS = 60;
const OTP_LENGTH = 6;

function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();

  // 'credentials' -> email/password entry, 'otp' -> 6-digit 2FA code entry.
  const [step, setStep] = useState("credentials");

  const [formData, setFormData] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);

  const [otpDigits, setOtpDigits] = useState(Array(OTP_LENGTH).fill(""));
  // Only ever lives in component state, never localStorage - it proves
  // nothing on its own (no `id` claim) until paired with the right OTP.
  const [pending2faToken, setPending2faToken] = useState(null);

  const [credentialsLoading, setCredentialsLoading] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);

  const [credentialsError, setCredentialsError] = useState("");
  const [otpError, setOtpError] = useState("");

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

  const handleSubmitCredentials = async (e) => {
    e.preventDefault();
    setCredentialsError("");
    setCredentialsLoading(true);

    try {
      const { ok, data } = await authApi.login(formData.email, formData.password);

      if (!ok || !data.success) {
        setCredentialsError(data.message || "Login failed. Please try again.");
        return;
      }

      if (data.data.twoFactorRequired) {
        setPending2faToken(data.data.pending2faToken);
        setOtpDigits(Array(OTP_LENGTH).fill(""));
        setOtpError("");
        setStep("otp");
        setCooldown(RESEND_COOLDOWN_SECONDS);
        setTimeout(() => otpRefs.current[0]?.focus(), 50);
        return;
      }

      // 2FA is off for this account - same behavior as before this
      // feature existed.
      login(data.data.token, data.data.user);
      navigate("/upload");
    } catch (err) {
      setCredentialsError(`Unable to reach the server: ${err.message}`);
    } finally {
      setCredentialsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (cooldown > 0 || sendingOtp || !pending2faToken) return;
    setOtpError("");
    setSendingOtp(true);
    try {
      const { ok, data } = await authApi.resendLoginOtp(pending2faToken);
      if (!ok || !data.success) {
        setOtpError(data.message || "Could not send verification code. Please try again.");
        return;
      }
      setPending2faToken(data.data.pending2faToken);
      setOtpDigits(Array(OTP_LENGTH).fill(""));
      setCooldown(RESEND_COOLDOWN_SECONDS);
      otpRefs.current[0]?.focus();
    } catch (err) {
      setOtpError(`Unable to reach the server: ${err.message}`);
    } finally {
      setSendingOtp(false);
    }
  };

  const handleBackToCredentials = () => {
    setStep("credentials");
    setPending2faToken(null);
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
    if (!otpComplete || !pending2faToken) return;

    setOtpError("");
    setVerifyingOtp(true);
    try {
      const { ok, data } = await authApi.verifyLoginOtp(pending2faToken, otpCode);

      if (!ok || !data.success) {
        setOtpError(data.message || "Invalid verification code.");
        setOtpDigits(Array(OTP_LENGTH).fill(""));
        otpRefs.current[0]?.focus();
        return;
      }

      setPending2faToken(null);
      login(data.data.token, data.data.user);
      navigate("/upload");
    } catch (err) {
      setOtpError(`Unable to reach the server: ${err.message}`);
    } finally {
      setVerifyingOtp(false);
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
          {step === "credentials" && (
            <>
              <h2>Welcome back</h2>
              <p className="subtitle">Sign in to continue to your verification workspace.</p>

              {credentialsError && (
                <p className="auth-error" role="alert">
                  {credentialsError}
                </p>
              )}

              <form onSubmit={handleSubmitCredentials}>
                <div className="input-group">
                  <label htmlFor="login-email">Email</label>
                  <input
                    id="login-email"
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                  />
                </div>

                <div className="input-group">
                  <label htmlFor="login-password">Password</label>
                  <div className="input-with-action">
                    <input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      name="password"
                      autoComplete="current-password"
                      required
                      value={formData.password}
                      onChange={handleChange}
                    />
                    <button
                      type="button"
                      className="toggle-password"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <a href="/forgot-password" className="forgot-password-link">Forgot password?</a>

                <button type="submit" className="login-btn" disabled={credentialsLoading}>
                  {credentialsLoading ? "Signing in..." : "Sign In"}
                </button>
              </form>

              <div className="extra-links">
                <span>Don't have an account?</span>
                <a href="/register">Create an account</a>
              </div>
            </>
          )}

          {step === "otp" && (
            <>
              <h2>Verify it's you</h2>
              <p className="otp-hint">
                We've sent a 6-digit code to <strong>{formData.email}</strong>.
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

                <button type="submit" className="login-btn" disabled={!otpComplete || verifyingOtp}>
                  {verifyingOtp ? "Verifying..." : "Verify & Sign In"}
                </button>
              </form>

              <div className="otp-actions">
                <button type="button" className="link-btn" onClick={handleBackToCredentials}>
                  Back
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
        </div>
      </div>
    </div>
  );
}

export default Login;
