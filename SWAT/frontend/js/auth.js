(function () {
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const adminLoginForm = document.getElementById("adminLoginForm");
  const logoutButtons = document.querySelectorAll("[data-logout-all]");
  const message = document.getElementById("authMessage");
  const otpEmail = document.getElementById("otpEmail");
  const requestOtpBtn = document.getElementById("requestOtpBtn");
  const otpCode = document.getElementById("otpCode");
  const otpNewPassword = document.getElementById("otpNewPassword");
  const verifyOtpBtn = document.getElementById("verifyOtpBtn");
  const oldPassword = document.getElementById("oldPassword");
  const changePasswordBtn = document.getElementById("changePasswordBtn");
  const adminKey = "smartflow-admin-auth";
  const adminRoleKey = "smartflow-admin-role";
  const tokenKey = "smartflow-auth-token";
  const userKey = "smartflow-user";
  const adminOnlySelector = "[data-admin-only='true']";

  function getLoggedInUser() {
    try {
      return JSON.parse(localStorage.getItem(userKey) || "{}");
    } catch (_) {
      return {};
    }
  }

  function isTrueAdmin(user) {
    return String(user?.role || "").toLowerCase() === "admin";
  }

  function enforceAdminRequiredRole() {
    const required = String(document.body?.dataset?.adminRequired || "").trim().toLowerCase();
    if (!required) return;

    const user = getLoggedInUser();
    const role = String(user?.role || "").toLowerCase();
    if (!role || role !== required) {
      window.location.href = "./login.html";
    }
  }

  function applyAdminOnlyVisibility() {
    const user = getLoggedInUser();
    const show = isTrueAdmin(user);
    document.querySelectorAll(adminOnlySelector).forEach((el) => {
      el.hidden = !show;
    });
  }

  function getApiBases() {
    const bases = [];
    if (window.__SMARTFLOW_API_BASE__) bases.push(window.__SMARTFLOW_API_BASE__);
    if (window.location && /^https?:$/.test(window.location.protocol)) {
      bases.push(`${window.location.origin}/api`);
    }
    bases.push("http://localhost:4000/api");
    bases.push("http://127.0.0.1:4000/api");
    return Array.from(new Set(bases.map((item) => String(item || "").replace(/\/+$/, ""))).values());
  }

  async function postJson(path, payload) {
    const apiBases = getApiBases();
    let lastError = null;

    for (const base of apiBases) {
      try {
        const response = await fetch(`${base}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Request failed");
        }
        return data;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Failed to connect to backend");
  }

  function setAuthMessage(text, isError) {
    if (!message) return;
    message.textContent = text;
    message.className = `text-sm mt-4 text-center ${isError ? "text-rose-600" : "text-emerald-600"}`;
  }

  function submitAuthForm(form, endpointLabel) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
      const endpoint = endpointLabel === "Signup" ? "/auth/signup" : "/auth/login";

      try {
        const data = await postJson(endpoint, payload);
        localStorage.setItem(tokenKey, data.token || "");
        localStorage.setItem(userKey, JSON.stringify(data.user || {}));
        if (["admin", "approver"].includes(data.user?.role)) {
          localStorage.setItem(adminKey, "true");
          localStorage.setItem(adminRoleKey, data.user?.orgRole || data.user?.approverRole || "Manager");
        } else {
          localStorage.removeItem(adminKey);
          localStorage.removeItem(adminRoleKey);
        }
        setAuthMessage(`${endpointLabel} successful. Redirecting...`, false);
        setTimeout(() => {
          window.location.href = ["admin", "approver"].includes(data.user?.role) ? "./approvals.html" : "./dashboard.html";
        }, 600);
      } catch (error) {
        setAuthMessage(error.message || `${endpointLabel} failed`, true);
      }
    });
  }

  if (loginForm) submitAuthForm(loginForm, "Login");
  if (signupForm) submitAuthForm(signupForm, "Signup");

  function performLogout(redirectUrl) {
    localStorage.removeItem(adminKey);
    localStorage.removeItem(adminRoleKey);
    localStorage.removeItem(userKey);
    localStorage.removeItem(tokenKey);
    window.location.href = redirectUrl || "./login.html";
  }

  if (adminLoginForm) {
    adminLoginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(adminLoginForm).entries());
      try {
        const data = await postJson("/auth/admin/login", payload);
        localStorage.setItem(adminKey, "true");
        localStorage.setItem(adminRoleKey, data.user?.orgRole || data.user?.approverRole || "Manager");
        localStorage.setItem(userKey, JSON.stringify(data.user || {}));
        localStorage.setItem(tokenKey, data.token || "");
        setAuthMessage("Admin login successful. Redirecting...", false);
        setTimeout(() => {
          window.location.href = "./approvals.html";
        }, 700);
      } catch (error) {
        setAuthMessage(error.message || "Admin login failed", true);
      }
    });
  }

  if (requestOtpBtn && otpEmail) {
    requestOtpBtn.addEventListener("click", async () => {
      const email = String(otpEmail.value || "").trim();
      if (!email) {
        setAuthMessage("Enter employee email for OTP", true);
        return;
      }
      try {
        const data = await postJson("/auth/password/otp/request", { email });
        setAuthMessage(`OTP sent. Demo OTP: ${data.otp}`, false);
      } catch (error) {
        setAuthMessage(error.message || "Failed to request OTP", true);
      }
    });
  }

  if (verifyOtpBtn && otpEmail && otpCode && otpNewPassword) {
    verifyOtpBtn.addEventListener("click", async () => {
      const email = String(otpEmail.value || "").trim();
      const otp = String(otpCode.value || "").trim();
      const newPassword = String(otpNewPassword.value || "");
      if (!email || !otp || !newPassword) {
        setAuthMessage("Email, OTP and new password are required", true);
        return;
      }
      try {
        await postJson("/auth/password/otp/verify", { email, otp, newPassword });
        setAuthMessage("Password changed successfully. Login now.", false);
        otpCode.value = "";
        otpNewPassword.value = "";
      } catch (error) {
        setAuthMessage(error.message || "OTP verification failed", true);
      }
    });
  }

  if (changePasswordBtn && otpEmail && oldPassword && otpNewPassword) {
    changePasswordBtn.addEventListener("click", async () => {
      const email = String(otpEmail.value || "").trim();
      const oldPwd = String(oldPassword.value || "");
      const newPassword = String(otpNewPassword.value || "");
      if (!email || !oldPwd || !newPassword) {
        setAuthMessage("Email, old password and new password are required", true);
        return;
      }
      try {
        await postJson("/auth/password/change", { email, oldPassword: oldPwd, newPassword });
        setAuthMessage("Password changed successfully. Login now.", false);
        oldPassword.value = "";
        otpNewPassword.value = "";
      } catch (error) {
        setAuthMessage(error.message || "Password change failed", true);
      }
    });
  }

  if (document.body.dataset.adminProtected === "true") {
    const isAdmin = localStorage.getItem(adminKey) === "true";
    if (!isAdmin) {
      window.location.href = "./login.html";
    }
  }

  enforceAdminRequiredRole();
  applyAdminOnlyVisibility();

  logoutButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const redirect = btn.getAttribute("data-logout-redirect") || "./login.html";
      performLogout(redirect);
    });
  });
})();
