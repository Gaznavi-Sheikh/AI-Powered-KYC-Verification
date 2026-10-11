import React, { useState, useEffect } from "react";
import DashboardLayout from "./DashboardLayout";
import { kycApi } from "../services/api";
import { useAuth } from "../context/AuthContext";

const ChatHistory = () => {
  const { token, user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [dateFilter, setDateFilter] = useState("Last 30 Days");
  const [docFilter, setDocFilter] = useState("All Documents");

  // Debounce the admin-only name search ~300ms so typing doesn't fire a
  // request per keystroke. Non-admins never see this field, so
  // debouncedSearch stays "" for them and the effect below sends no
  // name param at all.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    let active = true;
    setLoading(true);

    kycApi
      .history(token, isAdmin ? debouncedSearch : undefined)
      .then(({ ok, data }) => {
        if (!active) return;
        if (ok && data.success) {
          setRecords(data.data);
          setError("");
        } else {
          setError(data.message || "Could not load verification history.");
        }
      })
      .catch(() => {
        if (active) setError("Unable to reach the server.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, isAdmin, debouncedSearch]);

  const getConfidenceColor = (score) => {
    if (score === null || score === undefined) return "var(--text-muted)";
    if (score >= 80) return "var(--success)";
    if (score >= 60) return "var(--warning)";
    return "var(--danger)";
  };

  // Name search is already applied server-side (see the fetch effect
  // above) - this client-side pass only handles the status/date/document
  // filters, which operate on the (already name-filtered, for admins)
  // result set already in hand.
  const filteredData = records.filter((row) => {
    const matchesStatus =
      statusFilter === "All Status" || row.status.toLowerCase() === statusFilter.toLowerCase();
    const matchesDoc = docFilter === "All Documents" || row.docType === docFilter;

    const rowDate = new Date(row.submittedAt);
    const today = new Date();
    const diffDays = Math.ceil(Math.abs(today - rowDate) / (1000 * 60 * 60 * 24));

    let matchesDate = true;
    if (dateFilter === "Last 7 Days") matchesDate = diffDays <= 7;
    if (dateFilter === "Last 30 Days") matchesDate = diffDays <= 30;
    if (dateFilter === "This Year") matchesDate = rowDate.getFullYear() === today.getFullYear();

    return matchesStatus && matchesDoc && matchesDate;
  });

  const filtersActive =
    (isAdmin && searchTerm.trim() !== "") ||
    statusFilter !== "All Status" ||
    dateFilter !== "Last 30 Days" ||
    docFilter !== "All Documents";

  const handleClearFilters = () => {
    setSearchTerm("");
    setStatusFilter("All Status");
    setDateFilter("Last 30 Days");
    setDocFilter("All Documents");
  };

  const totalCount = records.length;
  const approvedCount = records.filter((r) => r.status.toLowerCase() === "approved").length;
  const pendingCount = records.filter((r) => r.status.toLowerCase() === "pending").length;
  const suspiciousCount = records.filter((r) => r.status.toLowerCase() === "suspicious").length;
  const rejectedCount = records.filter((r) => r.status.toLowerCase() === "rejected").length;

  return (
    <DashboardLayout>

      <div className="page-header" style={{ marginBottom: "24px" }}>
        <h1>Verification History</h1>
      </div>

      <div className="metric-grid">
        <div className="metric-card">
          <div className="metric-icon blue"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg></div>
          <div className="metric-info">
            <h4>Total</h4>
            <div className="metric-value">{totalCount}</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon green"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></div>
          <div className="metric-info">
            <h4>Approved</h4>
            <div className="metric-value">{approvedCount}</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon yellow"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div>
          <div className="metric-info">
            <h4>Pending</h4>
            <div className="metric-value">{pendingCount}</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon blue"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></div>
          <div className="metric-info">
            <h4>Suspicious</h4>
            <div className="metric-value">{suspiciousCount}</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon red"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg></div>
          <div className="metric-info">
            <h4>Rejected</h4>
            <div className="metric-value">{rejectedCount}</div>
          </div>
        </div>
      </div>

      <div className="filter-bar">
        {isAdmin && (
          <div className="search-input-wrapper">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input
              type="text"
              className="search-input"
              aria-label="Search by User"
              placeholder="Enter user name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        )}
        <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option>All Status</option><option>Approved</option><option>Pending</option><option>Suspicious</option><option>Rejected</option>
        </select>
        <select className="filter-select" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
          <option>Last 30 Days</option><option>Last 7 Days</option><option>This Year</option>
        </select>
        <select className="filter-select" value={docFilter} onChange={(e) => setDocFilter(e.target.value)}>
          <option value="All Documents">All Documents</option>
          <option value="aadhaar">Aadhaar Card</option>
          <option value="pan">PAN Card</option>
          <option value="passport">Passport</option>
        </select>
        {filtersActive && (
          <button type="button" className="btn-ghost" onClick={handleClearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <div className="dash-card" style={{ padding: "0", overflow: "hidden" }}>
        <div className="table-container" style={{ margin: 0, padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr><th>User Name</th><th>Document Type</th><th>Submitted Date</th><th>AI Score</th><th>Status</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>Loading...</td></tr>
              ) : error ? (
                <tr><td colSpan="5" style={{ textAlign: "center", padding: "48px 0", color: "var(--danger)" }}>{error}</td></tr>
              ) : filteredData.length > 0 ? (
                filteredData.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="user-cell">
                        <span className={`status-dot ${row.status.toLowerCase()}`}></span>
                        <div className="user-initials">{row.initials}</div>
                        <div className="user-cell-info"><h5>{row.name}</h5><span>{row.filename}</span></div>
                      </div>
                    </td>
                    <td style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                      {row.docType}
                    </td>
                    <td>{new Date(row.submittedAt).toLocaleDateString()}</td>
                    <td>
                      {row.confidence === null || row.confidence === undefined ? (
                        <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>Not yet available</span>
                      ) : (
                        <div className="confidence-wrapper">
                          <div className="confidence-bar-bg"><div className="confidence-bar-fill" style={{ width: `${row.confidence}%`, backgroundColor: getConfidenceColor(row.confidence) }}></div></div>
                          <span style={{ fontWeight: "600", fontSize: "13px" }}>{row.confidence}%</span>
                        </div>
                      )}
                    </td>
                    <td><span className={`status-pill ${row.status.toLowerCase()}`}>{row.status}</span></td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
                    {records.length === 0 && isAdmin && debouncedSearch ? (
                      <>
                        No users match "{debouncedSearch}".{" "}
                        <button type="button" className="btn-update-link" onClick={handleClearFilters}>
                          Clear filters
                        </button>
                      </>
                    ) : records.length === 0 ? (
                      "No verification records yet."
                    ) : (
                      <>
                        No records match the selected filters.{" "}
                        <button type="button" className="btn-update-link" onClick={handleClearFilters}>
                          Clear filters
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ChatHistory;
