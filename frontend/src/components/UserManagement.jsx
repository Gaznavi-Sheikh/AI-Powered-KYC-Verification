import React, { useState, useEffect } from "react";
import DashboardLayout from "./DashboardLayout";
import { adminApi } from "../services/api";
import { useAuth } from "../context/AuthContext";

const UserManagement = () => {
  const { token, user: currentUser } = useAuth();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [savingId, setSavingId] = useState(null);

  const loadUsers = () => {
    setLoading(true);
    setError("");
    adminApi
      .listUsers(token)
      .then(({ ok, data }) => {
        if (ok && data.success) {
          setUsers(data.data);
        } else {
          setError(data.message || "Could not load users.");
        }
      })
      .catch((err) => setError(`Unable to reach the server: ${err.message}`))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleRoleChange = async (targetUser, nextRole) => {
    const verb = nextRole === "admin" ? "promote" : "demote";
    const confirmed = window.confirm(
      `Are you sure you want to ${verb} ${targetUser.name} (${targetUser.email}) to ${nextRole === "admin" ? "Admin" : "Normal User"}?`
    );
    if (!confirmed) return;

    setActionError("");
    setSavingId(targetUser.id);
    try {
      const { ok, data } = await adminApi.updateUserRole(token, targetUser.id, nextRole);
      if (!ok || !data.success) {
        setActionError(data.message || `Could not ${verb} this user.`);
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === targetUser.id ? { ...u, role: nextRole } : u)));
    } catch (err) {
      setActionError(`Unable to reach the server: ${err.message}`);
    } finally {
      setSavingId(null);
    }
  };

  const getInitials = (name) =>
    name ? name.trim().split(/\s+/).filter(Boolean).map((p) => p[0].toUpperCase()).join("") : "?";

  return (
    <DashboardLayout>
      <div className="page-header" style={{ marginBottom: "24px" }}>
        <h1>User Management</h1>
        <p>Promote or demote users between Admin and Normal User roles.</p>
      </div>

      {actionError && <p className="field-error-text" role="alert">{actionError}</p>}

      <div className="dash-card" style={{ padding: "0", overflow: "hidden" }}>
        <div className="table-container" style={{ margin: 0, padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Joined</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="4" style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>Loading...</td></tr>
              ) : error ? (
                <tr><td colSpan="4" style={{ textAlign: "center", padding: "48px 0", color: "var(--danger)" }}>{error}</td></tr>
              ) : users.length > 0 ? (
                users.map((u) => {
                  const isSelf = currentUser && String(currentUser.id) === String(u.id);
                  const nextRole = u.role === "admin" ? "user" : "admin";
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="user-cell">
                          <div className="user-initials">{getInitials(u.name)}</div>
                          <div className="user-cell-info">
                            <h5>{u.name}{isSelf ? " (You)" : ""}</h5>
                            <span>{u.email}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`status-pill ${u.role === "admin" ? "role-admin" : "role-user"}`}>
                          {u.role === "admin" ? "Admin" : "Normal User"}
                        </span>
                      </td>
                      <td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td>
                      <td>
                        {isSelf ? (
                          <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>Not editable</span>
                        ) : (
                          <button
                            type="button"
                            className="btn-update-link"
                            disabled={savingId === u.id}
                            onClick={() => handleRoleChange(u, nextRole)}
                          >
                            {savingId === u.id ? "Saving..." : nextRole === "admin" ? "Promote to Admin" : "Demote to User"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan="4" style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default UserManagement;
