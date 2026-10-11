import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const ProtectedRoute = ({ children, adminOnly = false }) => {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          fontFamily: "sans-serif",
          color: "#64748b"
        }}
      >
        Checking session...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // UX convenience only - keeps a Normal User from landing on a page that
  // will just show empty/error states. The real security boundary is the
  // backend's adminOnly middleware, which this redirect does not replace.
  if (adminOnly && user?.role !== "admin") {
    return <Navigate to="/upload" replace />;
  }

  return children;
};

export default ProtectedRoute;
