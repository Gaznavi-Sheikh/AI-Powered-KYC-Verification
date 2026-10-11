import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../services/api";
import "../styles/ForgotPassword.css";

const PIPELINE_POINTS = [
  "Document classification",
  "OCR extraction",
  "AI identity extraction",
  "Graph-based risk analysis",
  "Explainable decisions"
];

function ForgotPassword() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Once true, we show the same generic confirmation no matter what the
  // backend actually did (account existed or not, cooldown or not,
  // provider failure or not) - the response is deliberately generic, so
  // the UI doesn't vary either.
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    setError("");
    setLoading(true);
    try {
      const { ok, data } = await authApi.forgotPassword(email.trim());

      if (!ok || !data.success) {
        setError(data.message || "Something went wrong. Please try again.");
        return;
      }

      setSubmitted(true);
    } catch (err) {
      setError(`Unable to reach the server: ${err.message}`);
    } finally {
      setLoading(false);
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
          <h2>Forgot password?</h2>
          <p className="subtitle">Enter your email and we'll send you a link to reset it.</p>

          {submitted ? (
            <>
              <p className="auth-success" role="status">
                If that email is registered, a password reset link has been sent. Check your inbox - the link expires in 15 minutes.
              </p>
              <div className="extra-links">
                <a href="/login">Back to Sign In</a>
              </div>
            </>
          ) : (
            <>
              {error && <p className="auth-error" role="alert">{error}</p>}

              <form onSubmit={handleSubmit}>
                <div className="input-group">
                  <label htmlFor="forgot-email">Email</label>
                  <input
                    id="forgot-email"
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <button type="submit" className="forgot-password-btn" disabled={loading}>
                  {loading ? "Sending..." : "Send Reset Link"}
                </button>
              </form>

              <div className="extra-links">
                <span>Remembered your password?</span>
                <a href="/login">Sign In</a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ForgotPassword;
