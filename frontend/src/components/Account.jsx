import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "./DashboardLayout";
import { useAuth } from "../context/AuthContext";
import { authApi } from "../services/api";

const PASSWORD_FIELDS = [
  { key: "currentPassword", label: "Current Password", autoComplete: "current-password" },
  { key: "newPassword", label: "New Password", autoComplete: "new-password" },
  { key: "confirmPassword", label: "Confirm New Password", autoComplete: "new-password" }
];

function PasswordField({ field, value, visible, onChange, onToggleVisible }) {
  return (
    <div className="form-group">
      <label htmlFor={`pw-${field.key}`}>{field.label}</label>
      <div className="password-input-wrapper">
        <input
          id={`pw-${field.key}`}
          type={visible ? "text" : "password"}
          className="form-input"
          autoComplete={field.autoComplete}
          value={value}
          onChange={onChange}
          required
        />
        <button
          type="button"
          className="password-toggle-btn"
          onClick={onToggleVisible}
          aria-label={visible ? `Hide ${field.label}` : `Show ${field.label}`}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

const Account = () => {
  const navigate = useNavigate();
  const { user, token, logout, updateUser } = useAuth();

  const [activeSection, setActiveSection] = useState("profile");
  const profileCardRef = useRef(null);
  const securityCardRef = useRef(null);

  const scrollToSection = (id, ref) => {
    setActiveSection(id);
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Real, server-backed setting (not fake local state) - initialized from
  // the authenticated user and kept in sync if it changes (e.g. the /me
  // fetch on page load resolves after this component's first render).
  const [twoFactor, setTwoFactor] = useState(!!user?.twoFactorEnabled);
  const [twoFactorSaving, setTwoFactorSaving] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState("");

  useEffect(() => {
    if (user) setTwoFactor(!!user.twoFactorEnabled);
  }, [user?.twoFactorEnabled]);

  const handleToggleTwoFactor = async () => {
    const next = !twoFactor;
    setTwoFactorError("");
    setTwoFactorSaving(true);
    try {
      const { ok, data } = await authApi.updateTwoFactor(token, next);
      if (!ok || !data.success) {
        setTwoFactorError(data.message || "Could not update two-factor authentication.");
        return;
      }
      setTwoFactor(next);
      updateUser({ twoFactorEnabled: next });
    } catch (err) {
      setTwoFactorError(`Unable to reach the server: ${err.message}`);
    } finally {
      setTwoFactorSaving(false);
    }
  };

  const [emailAlerts, setEmailAlerts] = useState(true);
  const [pushAlerts, setPushAlerts] = useState(false);


  const [formData, setFormData] = useState({
    fullName: user?.name || "",
    email: user?.email || "",
    phone: ""
  });

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSaveProfile = (e) => {
    e.preventDefault();
    alert("✅ Personal Information updated successfully!");
  };

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordFields, setPasswordFields] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [passwordVisible, setPasswordVisible] = useState({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false
  });
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  const resetPasswordForm = () => {
    setPasswordFields({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setPasswordVisible({ currentPassword: false, newPassword: false, confirmPassword: false });
    setPasswordError("");
  };

  const handleTogglePasswordForm = () => {
    setPasswordSuccess("");
    if (showPasswordForm) {
      resetPasswordForm();
    }
    setShowPasswordForm((v) => !v);
  };

  const handleCancelPasswordForm = () => {
    resetPasswordForm();
    setShowPasswordForm(false);
  };

  const handlePasswordFieldChange = (key) => (e) => {
    setPasswordFields((prev) => ({ ...prev, [key]: e.target.value }));
    setPasswordError("");
  };

  const handleTogglePasswordVisible = (key) => () => {
    setPasswordVisible((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleChangePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    const { currentPassword, newPassword, confirmPassword } = passwordFields;

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("All three fields are required.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    setPasswordSubmitting(true);
    try {
      const { ok, data } = await authApi.changePassword(token, currentPassword, newPassword, confirmPassword);

      if (!ok || !data.success) {
        setPasswordError(data.message || "Could not update password. Please try again.");
        return;
      }

      resetPasswordForm();
      setShowPasswordForm(false);
      setPasswordSuccess("Password updated successfully.");
    } catch (err) {
      setPasswordError(`Unable to reach the server: ${err.message}`);
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const handleSignOut = () => {
    if (window.confirm("Are you sure you want to sign out?")) {
      logout();
      navigate("/login");
    }
  };

  return (
    <DashboardLayout>
      <div className="breadcrumb">
        Dashboard / <span>Settings</span>
      </div>

      <div className="page-header">
        <h1>System Settings</h1>
        <p>Manage account security and API configurations</p>
      </div>

      <div className="settings-grid">
        
        <div className="settings-left-col">
          
          <div className="dash-card profile-summary">
            <div className="profile-avatar-large">
              {user?.name
                ? user.name.trim().split(/\s+/).filter(Boolean).map((p) => p[0].toUpperCase()).join("")
                : "?"}
            </div>
            <h2 className="profile-name">{formData.fullName}</h2>
            <p className="profile-email">{formData.email}</p>
          </div>

          <div className="dash-card" style={{ padding: "12px" }}>
            <div className="settings-menu">
              <button
                className={`settings-menu-item ${activeSection === "profile" ? "active" : ""}`}
                onClick={() => scrollToSection("profile", profileCardRef)}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                Profile Settings
              </button>
              <button
                className={`settings-menu-item ${activeSection === "security" ? "active" : ""}`}
                onClick={() => scrollToSection("security", securityCardRef)}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                Security & 2FA
              </button>
              <div className="menu-divider"></div>
              <button className="settings-menu-item danger" onClick={handleSignOut}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                Sign Out
              </button>
            </div>
          </div>
        </div>

       
        <div className="settings-right-col">
          
        
          <div className="dash-card" ref={profileCardRef}>
            <div className="section-header">
              <span className="section-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
              </span>
              Personal Information
            </div>

            <form onSubmit={handleSaveProfile}>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Full Name</label>
                  <input type="text" name="fullName" className="form-input" value={formData.fullName} onChange={handleInputChange} required />
                </div>
                <div className="form-group">
                  <label>Email Address</label>
                  <input type="email" name="email" className="form-input" value={formData.email} onChange={handleInputChange} required />
                </div>
              </div>
              <div className="form-group" style={{ maxWidth: "48%" }}>
                <label>Phone Number</label>
                <input type="tel" name="phone" className="form-input" value={formData.phone} onChange={handleInputChange} />
              </div>

              <div className="save-action-row">
                <button type="submit" className="btn-primary" style={{ width: "auto" }}>
                  Save Changes
                </button>
              </div>
            </form>
          </div>

         <div className="dash-card" ref={securityCardRef}>
            <div className="section-header">
              <span className="section-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
              </span>
              Security & Authentication
            </div>

            <div className="setting-row">
              <div className="setting-content">
                <div className="setting-icon">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                </div>
                <div className="setting-info">
                  <h4>Change Password</h4>
                  <p>Update the password used to sign in</p>
                </div>
              </div>
              <button type="button" className="btn-update-link" onClick={handleTogglePasswordForm}>
                {showPasswordForm ? "Cancel" : "Change Password"}
              </button>
            </div>

            {passwordSuccess && !showPasswordForm && (
              <p className="field-success-text" role="status">{passwordSuccess}</p>
            )}

            {showPasswordForm && (
              <form className="password-change-form" onSubmit={handleChangePasswordSubmit}>
                {passwordError && <p className="field-error-text" role="alert">{passwordError}</p>}

                {PASSWORD_FIELDS.map((field) => (
                  <PasswordField
                    key={field.key}
                    field={field}
                    value={passwordFields[field.key]}
                    visible={passwordVisible[field.key]}
                    onChange={handlePasswordFieldChange(field.key)}
                    onToggleVisible={handleTogglePasswordVisible(field.key)}
                  />
                ))}

                <div className="form-actions-row">
                  <button type="button" className="btn-cancel" onClick={handleCancelPasswordForm} disabled={passwordSubmitting}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" style={{ width: "auto" }} disabled={passwordSubmitting}>
                    {passwordSubmitting ? "Updating..." : "Update Password"}
                  </button>
                </div>
              </form>
            )}

            <div className="setting-row">
              <div className="setting-content">
                <div className="setting-icon">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
                </div>
                <div className="setting-info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h4>Two-Factor Authentication</h4>
                    <span className={`setting-badge ${twoFactor ? 'enabled' : 'disabled'}`}>
                      {twoFactor ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <p>{twoFactor ? "A code is emailed to you on every login." : "Enhanced security for login"}</p>
                </div>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  className="toggle-input"
                  checked={twoFactor}
                  disabled={twoFactorSaving}
                  onChange={handleToggleTwoFactor}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
            {twoFactorError && <p className="field-error-text" role="alert">{twoFactorError}</p>}
          </div>

       
          <div className="dash-card">
            <div className="section-header">
              <span className="section-icon">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              </span>
              Notifications
            </div>

            <div className="setting-row">
              <div className="setting-content">
                 <div className="setting-icon">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                </div>
                <div className="setting-info">
                  <h4>Email Alerts for High Risk Fraud</h4>
                  <p>Get immediate emails if a fake document is detected</p>
                </div>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" className="toggle-input" checked={emailAlerts} onChange={() => setEmailAlerts(!emailAlerts)} />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div className="setting-row">
               <div className="setting-content">
                 <div className="setting-icon">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                </div>
                <div className="setting-info">
                  <h4>Push Notifications for New Verifications</h4>
                  <p>App alerts when a new user submits KYC</p>
                </div>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" className="toggle-input" checked={pushAlerts} onChange={() => setPushAlerts(!pushAlerts)} />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
};

export default Account;