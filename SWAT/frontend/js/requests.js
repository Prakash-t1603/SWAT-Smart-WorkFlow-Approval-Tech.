(function () {
  const requestForm = document.getElementById("requestForm");
  const requestMessage = document.getElementById("requestMessage");
  const requestTableBody = document.getElementById("requestTableBody");
  const metricTotal = document.getElementById("metricTotalRequests");
  const metricPending = document.getElementById("metricPendingRequests");
  const metricApproved = document.getElementById("metricApprovedRequests");
  const userIdentity = document.getElementById("userIdentity");
  const orgChartGrid = document.getElementById("orgChartGrid");
  const requestFromEmail = document.getElementById("requestFromEmail");
  const requestToEmail = document.getElementById("requestToEmail");
  const toEmailOptions = document.getElementById("toEmailOptions");
  const requestTypeInput = document.getElementById("requestType");
  const requestAmountInput = document.getElementById("requestAmount");
  const selectedNodeRequestsTitle = document.getElementById("selectedNodeRequestsTitle");
  const selectedNodeRequestTableBody = document.getElementById("selectedNodeRequestTableBody");
  let cachedRequests = [];

  const recentToKey = "smartflow-recent-to-emails";

  const openProfileBtn = document.getElementById("openProfileBtn");
  const profileModal = document.getElementById("profileModal");
  const closeProfileBtn = document.getElementById("closeProfileBtn");
  const saveProfileModalBtn = document.getElementById("saveProfileModalBtn");
  const profileNameModal = document.getElementById("profileNameModal");
  const profileEmailModal = document.getElementById("profileEmailModal");
  const profileDepartmentModal = document.getElementById("profileDepartmentModal");
  const profileEmployeeIdModal = document.getElementById("profileEmployeeIdModal");
  const profilePhoneModal = document.getElementById("profilePhoneModal");
  const profileModalMessage = document.getElementById("profileModalMessage");

  function getApiBase() {
    return window.__SMARTFLOW_API_BASE__ || "http://localhost:4000/api";
  }

  function getLoggedInUser() {
    try {
      return JSON.parse(localStorage.getItem("smartflow-user") || "{}");
    } catch (_) {
      return {};
    }
  }

  function setLoggedInUser(user) {
    localStorage.setItem("smartflow-user", JSON.stringify(user || {}));
  }

  async function apiRequest(path, options) {
    const response = await fetch(`${getApiBase()}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }
    return data;
  }

  function formatInr(value) {
    if (value === null || value === undefined || value === "") return "-";
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "-";
    return `INR ${amount.toLocaleString("en-IN")}`;
  }

  function renderRows(items) {
    if (!requestTableBody) return;
    requestTableBody.innerHTML = "";
    if (!items.length) {
      requestTableBody.innerHTML = `
        <tr>
          <td class="py-3 text-slate-5000 dark:text-slate-3000" colspan="6">No requests found.</td>
        </tr>
      `;
      return;
    }

    items.forEach((item) => {
      const requestType = (item.requestType || "general").toUpperCase();
      const title = item.title || item.reason || "-";
      const row = document.createElement("tr");
      row.className = "border-b border-slate-300/20";
      row.innerHTML = `
        <td class="py-2">${item.id}</td>
        <td class="py-2">${formatInr(item.amount)}</td>
        <td class="py-2">${requestType} - ${title}</td>
        <td class="py-2">${item.status}</td>
        <td class="py-2">${new Date(item.createdAt).toLocaleString()}</td>
        <td class="py-2">
          <button class="btn-secondary theme-icon-btn" type="button" data-delete-request="${item.id}" aria-label="Delete request" title="Delete request">
            &#128465;
          </button>
        </td>
      `;
      requestTableBody.appendChild(row);
    });
  }

  function renderOrgChart(nodes) {
    if (!orgChartGrid) return;
    orgChartGrid.innerHTML = "";
    if (!nodes.length) {
      orgChartGrid.innerHTML = `<p class="text-sm text-slate-600 dark:text-slate-300">No hierarchy data available.</p>`;
      return;
    }

    const uniqueNodes = [];
    const seen = new Set();
    nodes.forEach((node) => {
      const key = String(node?.id || "").trim() || String(node?.email || "").toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      uniqueNodes.push(node);
    });

    uniqueNodes.forEach((node) => {
      const card = document.createElement("article");
      card.className = "glass org-card";
      card.style.cursor = "pointer";
      card.innerHTML = `
        <p class="org-role">${node.role}</p>
        <p class="font-semibold mt-1">${node.name}</p>
        <p class="text-sm text-slate-600 dark:text-slate-300">${node.email || "-"}</p>
        <p class="text-xs mt-2 text-slate-500 dark:text-slate-400">Reports: ${node.directReportCount || 0}</p>
      `;
      card.addEventListener("click", () => renderSelectedNodeRequests(node));
      orgChartGrid.appendChild(card);
    });
  }

  function renderSelectedNodeRequests(node) {
    if (!selectedNodeRequestTableBody) return;
    const byId = cachedRequests.filter((item) => String(item.userId || "") === String(node.id || ""));
    const byEmail = cachedRequests.filter((item) => String(item.requesterEmail || "").toLowerCase() === String(node.email || "").toLowerCase());
    const items = byId.length ? byId : byEmail;

    if (selectedNodeRequestsTitle) {
      selectedNodeRequestsTitle.textContent = `${node.name || node.role} - Request Content`;
    }

    selectedNodeRequestTableBody.innerHTML = "";
    if (!items.length) {
      selectedNodeRequestTableBody.innerHTML = `
        <tr>
          <td class="py-3 text-slate-500 dark:text-slate-300" colspan="5">No requests found for ${node.name || node.role}.</td>
        </tr>
      `;
      return;
    }

    items.forEach((item) => {
      const requestType = (item.requestType || "general").toUpperCase();
      const title = item.title || item.reason || "-";
      const row = document.createElement("tr");
      row.className = "border-b border-slate-300/20";
      row.innerHTML = `
        <td class="py-2">${item.id}</td>
        <td class="py-2">${item.requesterName || node.name || "-"}</td>
        <td class="py-2">${requestType} - ${title}</td>
        <td class="py-2">${item.status}</td>
        <td class="py-2">${new Date(item.createdAt).toLocaleString()}</td>
      `;
      selectedNodeRequestTableBody.appendChild(row);
    });
  }

  function updateMetrics(items) {
    if (metricTotal) metricTotal.textContent = String(items.length);
    if (metricPending) metricPending.textContent = String(items.filter((item) => item.status === "Pending").length);
    if (metricApproved) metricApproved.textContent = String(items.filter((item) => item.status === "Approved").length);
  }

  async function loadMyRequests() {
    if (!requestTableBody) return;
    const user = getLoggedInUser();
    const userId = user.id || user.email;
    if (!userId) {
      renderRows([]);
      updateMetrics([]);
      if (userIdentity) userIdentity.textContent = "Login required to create and track requests.";
      return;
    }

    if (userIdentity) {
      const roleTag = user.orgRole || user.approverRole || user.role || "User";
      userIdentity.textContent = `Logged in as ${user.name || "User"} (${roleTag})`;
    }

    try {
      const data = await apiRequest(`/requests?viewerId=${encodeURIComponent(userId)}`, { method: "GET" });
      const requests = data.requests || [];
      cachedRequests = requests;
      renderRows(requests);
      updateMetrics(requests);
    } catch (error) {
      if (requestMessage) {
        requestMessage.textContent = error.message || "Failed to load request status";
        requestMessage.className = "text-sm mt-3 text-rose-600";
      }
    }
  }

  async function loadOrgChart() {
    const user = getLoggedInUser();
    const userId = user.id || user.email;
    if (!userId || !orgChartGrid) return;
    try {
      const data = await apiRequest(`/org-chart?viewerId=${encodeURIComponent(userId)}`, { method: "GET" });
      renderOrgChart(data.nodes || []);
    } catch (_) {
      renderOrgChart([]);
    }
  }

  function setProfileModalMessage(text, isError) {
    if (!profileModalMessage) return;
    profileModalMessage.textContent = text || "";
    profileModalMessage.className = `text-sm ${isError ? "text-rose-600" : "text-emerald-600"}`;
  }

  function openProfileModal() {
    if (!profileModal) return;
    profileModal.classList.remove("hidden");
    profileModal.setAttribute("aria-hidden", "false");
    const user = getLoggedInUser();
    if (profileEmailModal) profileEmailModal.value = user.email || "";
    setProfileModalMessage("", false);
  }

  function closeProfileModal() {
    if (!profileModal) return;
    profileModal.classList.add("hidden");
    profileModal.setAttribute("aria-hidden", "true");
  }

  async function loadProfile() {
    const user = getLoggedInUser();
    const userId = user.id || user.email;
    if (!userId) return;
    try {
      const data = await apiRequest(`/profile?viewerId=${encodeURIComponent(userId)}`, { method: "GET" });
      const profile = data.profile || {};
      if (requestFromEmail) requestFromEmail.value = profile.email || user.email || "";
      if (profileEmailModal) profileEmailModal.value = profile.email || user.email || "";
      if (profileNameModal) profileNameModal.value = profile.name || user.name || "";
      if (profileDepartmentModal) profileDepartmentModal.value = profile.department || "";
      if (profileEmployeeIdModal) profileEmployeeIdModal.value = profile.employeeId || "";
      if (profilePhoneModal) profilePhoneModal.value = profile.phone || "";
      setProfileModalMessage("", false);
    } catch (_) {
      if (requestFromEmail) requestFromEmail.value = user.email || "";
      setProfileModalMessage("Profile API not available. Restart backend and refresh.", true);
    }
    renderRecentToEmails();
  }

  async function saveProfile() {
    const user = getLoggedInUser();
    const userId = user.id || user.email;
    if (!userId) throw new Error("Login required");

    const nameValue = String(profileNameModal?.value || "").trim();
    const departmentValue = String(profileDepartmentModal?.value || "").trim();
    const employeeIdValue = String(profileEmployeeIdModal?.value || "").trim();
    const phoneValue = String(profilePhoneModal?.value || "").trim();

    const payload = {
      name: nameValue,
      department: departmentValue,
      employeeId: employeeIdValue,
      phone: phoneValue,
    };
    const data = await apiRequest(`/profile?viewerId=${encodeURIComponent(userId)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    const profile = data.profile || payload;
    if (requestFromEmail) requestFromEmail.value = profile.email || user.email || "";
    if (profileEmailModal) profileEmailModal.value = profile.email || user.email || "";
    setProfileModalMessage("Profile saved.", false);
  }

  function getRecentToEmails() {
    try {
      const raw = JSON.parse(localStorage.getItem(recentToKey) || "[]");
      return Array.isArray(raw) ? raw.filter((x) => typeof x === "string" && x.includes("@")) : [];
    } catch (_) {
      return [];
    }
  }

  function addRecentToEmail(email) {
    const cleaned = String(email || "").trim().toLowerCase();
    if (!cleaned || !cleaned.includes("@")) return;
    const items = getRecentToEmails().filter((x) => x.toLowerCase() !== cleaned);
    items.unshift(cleaned);
    localStorage.setItem(recentToKey, JSON.stringify(items.slice(0, 8)));
    renderRecentToEmails();
  }

  function renderRecentToEmails() {
    if (!toEmailOptions) return;
    toEmailOptions.innerHTML = "";
    getRecentToEmails().forEach((email) => {
      const option = document.createElement("option");
      option.value = email;
      toEmailOptions.appendChild(option);
    });
  }

  function updateAmountFieldBehavior() {
    if (!requestTypeInput || !requestAmountInput) return;
    const isExpense = requestTypeInput.value === "expense";
    requestAmountInput.required = isExpense;
    requestAmountInput.placeholder = isExpense ? "Amount required for expense request" : "Amount (optional)";
  }

  if (requestForm) {
    requestForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const user = getLoggedInUser();
      const userId = user.id || user.email;
      if (!userId) {
        if (requestMessage) {
          requestMessage.textContent = "Please login as user first.";
          requestMessage.className = "text-sm mt-3 text-rose-600";
        }
        return;
      }

      const toEmail = String(requestToEmail?.value || "").trim();
      if (!toEmail) {
        if (requestMessage) {
          requestMessage.textContent = "Enter approver email in To.";
          requestMessage.className = "text-sm mt-3 text-rose-600";
        }
        return;
      }

      const payload = {
        userId,
        toEmail,
        requestType: document.getElementById("requestType")?.value || "general",
        title: document.getElementById("requestTitle")?.value || "",
        amount: document.getElementById("requestAmount")?.value || "",
        reason: document.getElementById("requestReason")?.value || "",
        requester: {
          name: user.name || "User",
          email: user.email || "",
        },
      };

      try {
        const data = await apiRequest("/requests", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (requestMessage) {
          requestMessage.textContent = `Request submitted: ${data.request?.id}`;
          requestMessage.className = "text-sm mt-3 text-emerald-600";
        }
        requestForm.reset();
        updateAmountFieldBehavior();
        addRecentToEmail(toEmail);
        loadProfile();
        loadMyRequests();
        loadOrgChart();
      } catch (error) {
        if (requestMessage) {
          requestMessage.textContent = error.message || "Failed to submit request";
          requestMessage.className = "text-sm mt-3 text-rose-600";
        }
      }
    });
  }

  if (requestTypeInput) {
    requestTypeInput.addEventListener("change", updateAmountFieldBehavior);
    updateAmountFieldBehavior();
  }

  window.addEventListener("smartflow:realtime", (event) => {
    const eventType = event.detail?.type;
    if (eventType === "request_created" || eventType === "request_updated" || eventType === "request_escalated" || eventType === "request_deleted") {
      loadMyRequests();
      loadOrgChart();
    }
    if (eventType === "org_updated") {
      loadOrgChart();
    }
  });

  loadMyRequests();
  loadOrgChart();
  loadProfile();

  if (requestTableBody) {
    requestTableBody.addEventListener("click", async (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const btn = target?.closest("[data-delete-request]");
      if (!(btn instanceof HTMLElement)) return;
      const requestId = btn.getAttribute("data-delete-request") || "";
      if (!requestId) return;

      const user = getLoggedInUser();
      const viewerId = user.id || user.email || "";
      if (!viewerId) return;

      const ok = window.confirm(`Delete request ${requestId}?`);
      if (!ok) return;

      try {
        await apiRequest(`/requests/${encodeURIComponent(requestId)}?viewerId=${encodeURIComponent(viewerId)}`, { method: "DELETE" });
        cachedRequests = cachedRequests.filter((r) => r.id !== requestId);
        renderRows(cachedRequests);
        updateMetrics(cachedRequests);
        loadOrgChart();
      } catch (error) {
        if (requestMessage) {
          requestMessage.textContent = error.message || "Failed to delete request";
          requestMessage.className = "text-sm mt-3 text-rose-600";
        }
      }
    });
  }

  if (openProfileBtn) openProfileBtn.addEventListener("click", openProfileModal);
  if (closeProfileBtn) closeProfileBtn.addEventListener("click", closeProfileModal);
  if (profileModal) {
    profileModal.addEventListener("click", (event) => {
      if (event.target === profileModal) closeProfileModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeProfileModal();
    });
  }
  if (saveProfileModalBtn) {
    saveProfileModalBtn.addEventListener("click", async () => {
      try {
        await saveProfile();
        closeProfileModal();
      } catch (error) {
        setProfileModalMessage(error.message || "Failed to save profile", true);
      }
    });
  }
})();
