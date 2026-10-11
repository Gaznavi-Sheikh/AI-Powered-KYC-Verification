import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { authApi } from "../services/api";
import "../styles/ResetPassword.css";

const PIPELINE_POINTS = [
  "Document classification",
  "OCR extraction",
  "AI identity extraction",
  "Graph-based risk analysis",
  "Explainable decisions"
];

function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resetToken = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    setError("");

    if (!resetToken) {
      setError("This reset link is missing its token. Please request a new one.");
      return;
    }
    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { ok, data } = await authApi.resetPassword(resetToken, newPassword, confirmPassword);

      if (!ok || !data.success) {
        setError(data.message || "Could not reset your password. Please try again.");
        return;
      }

      setSuccess(true);
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
          <h2>Reset password</h2>
          <p className="subtitle">Choose a new password for your account.</p>

          {success ? (
            <>
              <p className="auth-success" role="status">
                Your password has been reset. You can now sign in with your new password.
              </p>
              <div className="extra-links">
                <a href="/login">Go to Sign In</a>
              </div>
            </>
          ) : (
            <>
              {error && (
                <p className="auth-error" role="alert">
                  {error}
                  {!resetToken || /expired|invalid/i.test(error) ? (
                    <>
                      {" "}
                      <a href="/forgot-password">Request a new link</a>
                    </>
                  ) : null}
                </p>
              )}

              <form onSubmit={handleSubmit}>
                <div className="input-group">
                  <label htmlFor="reset-new-password">New Password</label>
                  <div className="input-with-action">
                    <input
                      id="reset-new-password"
                      type={showNew ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="toggle-password"
                      onClick={() => setShowNew(!showNew)}
                      aria-label={showNew ? "Hide new password" : "Show new password"}
                    >
                      {showNew ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="reset-confirm-password">Confirm New Password</label>
                  <div className="input-with-action">
                    <input
                      id="reset-confirm-password"
                      type={showConfirm ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="toggle-password"
                      onClick={() => setShowConfirm(!showConfirm)}
                      aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"}
                    >
                      {showConfirm ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <button type="submit" className="reset-password-btn" disabled={loading}>
                  {loading ? "Resetting..." : "Reset Password"}
                </button>
              </form>

              <div className="extra-links">
                <a href="/login">Back to Sign In</a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ResetPassword;
