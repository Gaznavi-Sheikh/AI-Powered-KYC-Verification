const API_BASE = import.meta.env.VITE_API_BASE;

const request = async (path, { method = "GET", body, token } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

export const authApi = {
  login: (email, password) =>
    request("/auth/login", { method: "POST", body: { email, password } }),
  register: (name, email, password, verificationToken) =>
    request("/auth/register", { method: "POST", body: { name, email, password, verificationToken } }),
  me: (token) => request("/auth/me", { token }),
  sendEmailOtp: (email) =>
    request("/auth/send-email-otp", { method: "POST", body: { email } }),
  verifyEmailOtp: (email, otp) =>
    request("/auth/verify-email-otp", { method: "POST", body: { email, otp } }),
  verifyLoginOtp: (pending2faToken, otp) =>
    request("/auth/verify-login-otp", { method: "POST", body: { pending2faToken, otp } }),
  resendLoginOtp: (pending2faToken) =>
    request("/auth/resend-login-otp", { method: "POST", body: { pending2faToken } }),
  updateTwoFactor: (token, enabled) =>
    request("/auth/two-factor", { method: "PATCH", body: { enabled }, token }),
  changePassword: (token, currentPassword, newPassword, confirmPassword) =>
    request("/auth/change-password", {
      method: "PATCH",
      body: { currentPassword, newPassword, confirmPassword },
      token
    }),
  forgotPassword: (email) =>
    request("/auth/forgot-password", { method: "POST", body: { email } }),
  resetPassword: (resetToken, newPassword, confirmPassword) =>
    request("/auth/reset-password", {
      method: "POST",
      body: { token: resetToken, newPassword, confirmPassword }
    })
};

export const adminApi = {
  listUsers: (token) => request("/admin/users", { token }),
  updateUserRole: (token, userId, role) =>
    request(`/admin/users/${userId}/role`, { method: "PATCH", body: { role }, token })
};

export const kycApi = {
  verify: async (token, identityFile, supportingFiles = []) => {
    const formData = new FormData();
    formData.append("identity", identityFile);
    supportingFiles.forEach((f) => formData.append("supporting", f));

    // No Content-Type header here on purpose - the browser sets
    // multipart/form-data with the correct boundary itself.
    const res = await fetch(`${API_BASE}/kyc/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });

    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  },
  history: (token, nameSearch) => {
    const query = nameSearch ? `?name=${encodeURIComponent(nameSearch)}` : "";
    return request(`/kyc/history${query}`, { token });
  }
};
