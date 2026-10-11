import { Routes, Route } from "react-router-dom";

import LandingPage from "./components/Landingpage";
import Login from "./components/Login";
import Register from "./components/Register";
import ForgotPassword from "./components/ForgotPassword";
import ResetPassword from "./components/ResetPassword";
import Upload from "./components/Upload";
import ChatHistory from "./components/ChatHistory";
import Account from "./components/Account";
import UserManagement from "./components/UserManagement";
import LearnMore from "./components/Learnmore";   // ADD THIS
import ProtectedRoute from "./components/ProtectedRoute";

import "./styles/dashboard.css";

function App() {
  return (
    <Routes>

      {/* Landing Page */}
      <Route path="/" element={<LandingPage />} />

      {/* Learn More Page */}
      <Route path="/learn-more" element={<LearnMore />} />

      {/* Authentication */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Dashboard Pages (require authentication) */}
      <Route path="/upload" element={<ProtectedRoute><Upload /></ProtectedRoute>} />
      <Route path="/chat-history" element={<ProtectedRoute><ChatHistory /></ProtectedRoute>} />
      <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
      <Route path="/admin/users" element={<ProtectedRoute adminOnly><UserManagement /></ProtectedRoute>} />

    </Routes>
  );
}

export default App;