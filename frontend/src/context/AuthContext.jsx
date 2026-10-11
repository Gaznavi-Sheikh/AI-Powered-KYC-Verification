import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { authApi } from "../services/api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("kyc_token"));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("kyc_token");

    if (!token) {
      setLoading(false);
      return;
    }

    authApi
      .me(token)
      .then(({ ok, status, data }) => {
        if (ok && data.success) {
          setUser(data.data.user);
          return;
        }

        // Token is invalid/expired, or the user behind it no longer exists.
        // The backend says so with a 401 - that's the only case where we
        // actually clear the session. See report: a network/server error
        // (status 0 or 5xx) is NOT treated as "logged out" so a transient
        // backend restart doesn't silently kick an otherwise-valid session.
        if (status === 401) {
          localStorage.removeItem("kyc_token");
          setToken(null);
        }
      })
      .catch(() => {
        // Network failure reaching the backend - leave the token alone,
        // just don't grant access this time.
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback((newToken, userData) => {
    localStorage.setItem("kyc_token", newToken);
    setToken(newToken);
    setUser(userData);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("kyc_token");
    setToken(null);
    setUser(null);
  }, []);

  // Merges a partial update (e.g. { twoFactorEnabled }) into the cached
  // user object after a settings change succeeds server-side - no token
  // change, nothing touches localStorage.
  const updateUser = useCallback((partial) => {
    setUser((prev) => (prev ? { ...prev, ...partial } : prev));
  }, []);

  const value = {
    user,
    token,
    isAuthenticated: !!user,
    loading,
    login,
    logout,
    updateUser
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
};
