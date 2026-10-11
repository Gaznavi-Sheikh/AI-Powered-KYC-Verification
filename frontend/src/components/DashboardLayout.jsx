import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "../styles/dashboard.css";

const PAGE_TITLES = {
  "/upload": "New Verification",
  "/chat-history": "Verification History",
  "/account": "Settings",
  "/admin/users": "User Management"
};

const DashboardLayout = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const initials = user?.name
    ? user.name.trim().split(/\s+/).filter(Boolean).map((p) => p[0].toUpperCase()).join("")
    : "?";

  const pageTitle = PAGE_TITLES[location.pathname] || "VerifyAI";

  const handleLogout = () => {
    if (window.confirm("Are you sure you want to logout?")) {
      logout();
      navigate("/login");
    }
  };

  const closeMobileNav = () => setMobileNavOpen(false);

  return (
    <div className={`dashboard-layout ${isCollapsed ? "sidebar-collapsed" : ""}`}>
      {mobileNavOpen && <div className="sidebar-backdrop" onClick={closeMobileNav} />}

      <aside
        className={`sidebar ${mobileNavOpen ? "mobile-open" : ""}`}
        style={{ width: isCollapsed ? "80px" : "260px" }}
      >
        <div className="sidebar-brand" onClick={() => navigate("/")}>
          <svg className="sidebar-brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5l-8-3z" />
            <polyline points="9 12 11 14 15 10" />
          </svg>
          {!isCollapsed && <span>VerifyAI</span>}
        </div>

        <nav className="sidebar-nav">
          <Link to="/upload" className={`nav-item ${location.pathname === "/upload" ? "active" : ""}`} onClick={closeMobileNav}>
            <span className="nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 12h8"/></svg>
            </span>
            {!isCollapsed && "New Verification"}
          </Link>

          <Link to="/chat-history" className={`nav-item ${location.pathname === "/chat-history" ? "active" : ""}`} onClick={closeMobileNav}>
            <span className="nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2"/></svg>
            </span>
            {!isCollapsed && "Verification History"}
          </Link>

          <Link to="/account" className={`nav-item ${location.pathname === "/account" ? "active" : ""}`} onClick={closeMobileNav}>
            <span className="nav-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </span>
            {!isCollapsed && "Settings"}
          </Link>

          {user?.role === "admin" && (
            <Link to="/admin/users" className={`nav-item ${location.pathname === "/admin/users" ? "active" : ""}`} onClick={closeMobileNav}>
              <span className="nav-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </span>
              {!isCollapsed && "User Management"}
            </Link>
          )}
        </nav>

        <div className="sidebar-user">
          <div className="sidebar-user-avatar">{initials}</div>
          {!isCollapsed && (
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{user?.name || "Unknown User"}</span>
              <span className="sidebar-user-email">{user?.email || ""}</span>
            </div>
          )}
          {!isCollapsed && (
            <button type="button" className="sidebar-logout-btn" onClick={handleLogout} aria-label="Logout">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          )}
        </div>

        <div className="collapse-btn" onClick={() => setIsCollapsed(!isCollapsed)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isCollapsed ? 'rotate(180deg)' : 'none' }}>
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          {!isCollapsed && "Collapse"}
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="mobile-menu-btn"
              aria-label="Open navigation menu"
              onClick={() => setMobileNavOpen(true)}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <div className="topbar-title">{pageTitle}</div>
          </div>

          <div className="topbar-right">
            <span className="topbar-icon-btn" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
            </span>

            <div className="user-profile-container">
              <div
                className="user-profile"
                onClick={() => setShowUserMenu(!showUserMenu)}
                style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: '8px', background: showUserMenu ? 'var(--bg-main)' : 'transparent' }}
              >
                <div className="user-avatar">{initials}</div>
                <div className="user-details">
                  <span className="user-name">{user?.name || "Unknown User"}</span>
                  <span className="user-role">{user?.email || ""}</span>
                </div>
              </div>

              {showUserMenu && (
                <div className="user-dropdown">
                  <div
                    onClick={() => { navigate("/account"); setShowUserMenu(false); }}
                    className="dropdown-item"
                  >
                    ⚙️ Profile Settings
                  </div>
                  <div
                    onClick={handleLogout}
                    className="dropdown-item"
                    style={{ color: 'var(--danger)' }}
                  >
                    Log Out
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="page-content">{children}</div>
      </main>
    </div>
  );
};

export default DashboardLayout;
