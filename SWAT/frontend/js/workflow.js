(function () {
  const addBtn = document.getElementById("addLevelBtn");
  const levelsWrap = document.getElementById("approvalLevels");
  const workflowForm = document.getElementById("workflowForm");
  const workflowMessage = document.getElementById("workflowMessage");
  const workflowList = document.getElementById("workflowList");

  const approverRoleSelect = document.getElementById("approverRole");
  const approverRoleLabel = document.getElementById("approverRoleLabel");
  const refreshApprovalsBtn = document.getElementById("refreshApprovalsBtn");
  const pendingApprovalsList = document.getElementById("pendingApprovalsList");
  const mailList = document.getElementById("mailList");

  const currentStatusPill = document.getElementById("currentStatusPill");
  const approvalActionMessage = document.getElementById("approvalActionMessage");
  const detailRequestTitle = document.getElementById("approvalRequestTitle");
  const detailUserName = document.getElementById("detailUserName");
  const detailUserEmail = document.getElementById("detailUserEmail");
  const detailUserDept = document.getElementById("detailUserDept");
  const detailUserEmployeeId = document.getElementById("detailUserEmployeeId");
  const detailRequestType = document.getElementById("detailRequestType");
  const detailTitle = document.getElementById("detailTitle");
  const detailAmount = document.getElementById("detailAmount");
  const detailSubmitted = document.getElementById("detailSubmitted");
  const detailReason = document.getElementById("detailReason");
  const detailCurrentRole = document.getElementById("detailCurrentRole");
  const detailRejectCount = document.getElementById("detailRejectCount");
  const detailApprovalSteps = document.getElementById("detailApprovalSteps");
  const approvalComment = document.getElementById("approvalComment");
  const forwardToEmail = document.getElementById("forwardToEmail");

  function getApiBase() {
    return window.__SMARTFLOW_API_BASE__ || "http://localhost:4000/api";
  }

  function getAdminRole() {
    const saved = localStorage.getItem("smartflow-admin-role");
    if (saved) return saved;
    try {
      const user = JSON.parse(localStorage.getItem("smartflow-user") || "{}");
      return user.orgRole || user.approverRole || "Manager";
    } catch (_) {
      return "Manager";
    }
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

  function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
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

  function statusClass(status) {
    const map = {
      approved: "status-approved",
      rejected: "status-rejected",
      waiting: "status-waiting",
      pending: "status-pending",
    };
    return map[status] || "status-waiting";
  }

  function formatInr(value) {
    if (value === null || value === undefined || value === "") return "-";
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "-";
    return `INR ${amount.toLocaleString("en-IN")}`;
  }

  function updateStatusPill(status) {
    if (!currentStatusPill) return;
    const normalized = String(status || "").toLowerCase();
    currentStatusPill.className = `status-pill ${statusClass(normalized)}`;
    currentStatusPill.textContent = normalized ? normalized[0].toUpperCase() + normalized.slice(1) : "-";
  }

  function createLevel(index) {
    const item = document.createElement("div");
    item.className = "glass p-3 rounded-xl";
    item.innerHTML = `
      <label class="text-sm font-medium">Level ${index} Role</label>
      <div class="flex gap-2 mt-1">
        <input class="input role-input" placeholder="Role name (e.g., CFO)" required />
        <button type="button" class="btn-secondary remove-level">Remove</button>
      </div>
    `;
    return item;
  }

  function refreshLabels() {
    if (!levelsWrap) return;
    levelsWrap.querySelectorAll(".glass").forEach((entry, idx) => {
      const label = entry.querySelector("label");
      if (label) label.textContent = `Level ${idx + 1} Role`;
    });
  }

  async function loadWorkflows() {
    if (!workflowList) return;
    try {
      const data = await apiRequest("/workflows", { method: "GET" });
      workflowList.innerHTML = "";
      const workflows = data.workflows || [];
      if (!workflows.length) {
        workflowList.innerHTML = `<p>No workflow rules configured.</p>`;
        return;
      }

      workflows.forEach((workflow) => {
        const item = document.createElement("article");
        item.className = "glass rounded-xl p-3";
        const maxAmount = workflow.maxAmount === null ? "No Upper Limit" : workflow.maxAmount;
        item.innerHTML = `
          <p><strong>${workflow.name}</strong></p>
          <p>Range: ${workflow.minAmount} to ${maxAmount}</p>
          <p>Levels: ${(workflow.levels || []).join(" -> ")}</p>
        `;
        workflowList.appendChild(item);
      });
    } catch (error) {
      workflowList.innerHTML = `<p class="text-rose-600">${error.message || "Failed to load workflows"}</p>`;
    }
  }

  if (addBtn && levelsWrap) {
    addBtn.addEventListener("click", () => {
      const count = levelsWrap.querySelectorAll(".glass").length;
      if (count >= 4) return;
      levelsWrap.appendChild(createLevel(count + 1));
    });

    levelsWrap.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.classList.contains("remove-level")) {
        target.closest(".glass")?.remove();
        refreshLabels();
      }
    });
  }

  if (workflowForm && workflowMessage) {
    workflowForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const roles = Array.from(document.querySelectorAll(".role-input"))
        .map((el) => el.value.trim())
        .filter(Boolean);
      const payload = {
        name: document.getElementById("workflowName")?.value || "",
        description: document.getElementById("workflowDescription")?.value || "",
        minAmount: document.getElementById("workflowMinAmount")?.value || "0",
        maxAmount: document.getElementById("workflowMaxAmount")?.value || "",
        levels: roles,
      };

      try {
        const data = await apiRequest("/workflows", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        workflowMessage.textContent = `Workflow created: ${data.workflow?.id || "N/A"}`;
        workflowMessage.className = "text-sm text-emerald-600 mt-2";
        workflowForm.reset();
        levelsWrap.innerHTML = `
          <div class="glass p-3 rounded-xl">
            <label class="text-sm font-medium">Level 1 Role</label>
            <input class="input mt-1 role-input" placeholder="Manager" required />
          </div>
        `;
        loadWorkflows();
      } catch (error) {
        workflowMessage.textContent = error.message || "Failed to create workflow";
        workflowMessage.className = "text-sm text-rose-600 mt-2";
      }
    });
  }

  async function loadApprovalInbox() {
    if (!pendingApprovalsList || !mailList) return;
    const role = getAdminRole();
    const user = getLoggedInUser();
    const viewerId = user.id || user.email || "";
    if (approverRoleLabel) approverRoleLabel.textContent = role || "-";

    try {
      const [approvalData, mailData] = await Promise.all([
        apiRequest(`/approvals/pending?role=${encodeURIComponent(role)}&viewerId=${encodeURIComponent(viewerId)}`, {
          method: "GET",
        }),
        apiRequest(`/mailbox?role=${encodeURIComponent(role)}&viewerId=${encodeURIComponent(viewerId)}`, { method: "GET" }),
      ]);

      const approvals = approvalData.approvals || [];
      const mails = mailData.mails || [];

      pendingApprovalsList.innerHTML = "";
      if (!approvals.length) {
        pendingApprovalsList.innerHTML = `<p class="text-sm text-slate-600 dark:text-slate-300">No pending approvals for ${role}.</p>`;
      } else {
        approvals.forEach((item) => {
          const article = document.createElement("article");
          article.className = "glass rounded-xl p-4";
          article.innerHTML = `
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p class="font-semibold">${item.id}</p>
                <p class="text-sm">Requester: ${item.requesterName} (${item.requesterEmail})</p>
                <p class="text-sm">Type: ${(item.requestType || "general").toUpperCase()} | ${item.title || "-"}</p>
                <p class="text-sm">Amount: ${formatInr(item.amount)}</p>
                <p class="text-sm">Reason: ${item.reason}</p>
              </div>
              <a class="btn-primary" href="./approval-details.html?requestId=${encodeURIComponent(item.id)}">Open</a>
            </div>
          `;
          pendingApprovalsList.appendChild(article);
        });
      }

      mailList.innerHTML = "";
      if (!mails.length) {
        mailList.innerHTML = `<p class="text-sm text-slate-600 dark:text-slate-300">No mail notifications for ${role}.</p>`;
      } else {
        mails
          .slice()
          .reverse()
          .forEach((mail) => {
            const line = document.createElement("article");
            line.className = "glass rounded-xl p-3";
            line.innerHTML = `
              <p class="font-semibold">${mail.subject}</p>
              <p class="text-xs">${mail.body}</p>
              <a class="text-sky-600 font-semibold text-sm" href="./approval-details.html?requestId=${encodeURIComponent(mail.requestId)}">
                Open from mail
              </a>
            `;
            mailList.appendChild(line);
          });
      }
    } catch (error) {
      pendingApprovalsList.innerHTML = `<p class="text-sm text-rose-600">${error.message || "Failed to load approvals"}</p>`;
      mailList.innerHTML = "";
    }
  }

  async function loadApprovalDetail() {
    if (!detailRequestTitle) return;
    const requestId = getQueryParam("requestId");
    if (!requestId) {
      detailRequestTitle.textContent = "Request Details (Missing requestId)";
      return;
    }

    try {
      const viewer = getLoggedInUser();
      const viewerId = viewer.id || viewer.email || "";
      const data = await apiRequest(`/requests/${encodeURIComponent(requestId)}?viewerId=${encodeURIComponent(viewerId)}`, { method: "GET" });
      const item = data.request;

      detailRequestTitle.textContent = `Request #${item.id}`;
      detailUserName.textContent = item.requester?.name || "-";
      detailUserEmail.textContent = item.requester?.email || "-";
      detailUserDept.textContent = item.requester?.department || "-";
      detailUserEmployeeId.textContent = item.requester?.employeeId || "-";
      if (detailRequestType) detailRequestType.textContent = (item.requestType || "general").toUpperCase();
      if (detailTitle) detailTitle.textContent = item.title || "-";
      detailAmount.textContent = formatInr(item.amount);
      detailReason.textContent = item.reason || "-";
      detailSubmitted.textContent = new Date(item.createdAt).toLocaleString();

      const pendingStep = (item.steps || []).find((step) => step.status === "pending");
      detailCurrentRole.textContent = pendingStep ? pendingStep.role : "-";
      if (detailRejectCount) {
        detailRejectCount.textContent = String((item.steps || []).filter((step) => step.status === "rejected").length);
      }
      updateStatusPill(item.status);

      if (detailApprovalSteps) {
        detailApprovalSteps.innerHTML = "";
        (item.steps || []).forEach((step) => {
          const row = document.createElement("div");
          row.className = "flex items-center justify-between gap-2";
          row.innerHTML = `
            <span>Level ${step.level}: ${step.role}</span>
            <span class="status-pill ${statusClass(step.status)}">${step.status}</span>
          `;
          detailApprovalSteps.appendChild(row);
        });
      }
    } catch (error) {
      if (approvalActionMessage) {
        approvalActionMessage.textContent = error.message || "Failed to load request details";
        approvalActionMessage.className = "text-sm mt-4 text-rose-600";
      }
    }
  }

  const deleteRequestBtn = document.getElementById("deleteRequestBtn");
  if (deleteRequestBtn) {
    deleteRequestBtn.addEventListener("click", async () => {
      const requestId = getQueryParam("requestId");
      if (!requestId) return;
      const viewer = getLoggedInUser();
      const viewerId = viewer.id || viewer.email || "";
      if (!viewerId) return;

      const ok = window.confirm(`Delete request ${requestId}?`);
      if (!ok) return;

      try {
        await apiRequest(`/requests/${encodeURIComponent(requestId)}?viewerId=${encodeURIComponent(viewerId)}`, { method: "DELETE" });
        window.location.href = "./approvals.html";
      } catch (error) {
        if (approvalActionMessage) {
          approvalActionMessage.textContent = error.message || "Failed to delete request";
          approvalActionMessage.className = "text-sm mt-4 text-rose-600";
        }
      }
    });
  }

  document.querySelectorAll("[data-approval-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const requestId = getQueryParam("requestId");
      const role = getAdminRole();
      const user = getLoggedInUser();
      const action = btn.getAttribute("data-approval-action");
      const comment = approvalComment?.value || "";
      const forwardEmail = String(forwardToEmail?.value || "").trim();
      if (!requestId || !action) return;

      try {
        const payload = {
          role,
          action,
          comment,
          actorId: user.id || user.email || "",
          actedBy: role,
        };
        if (action === "forward" && forwardEmail) payload.forwardToEmail = forwardEmail;
        const data = await apiRequest(`/requests/${encodeURIComponent(requestId)}/decision`, {
          method: "PATCH",
          body: JSON.stringify({
            ...payload,
          }),
        });
        updateStatusPill(data.request?.status || "pending");
        if (approvalActionMessage) {
          approvalActionMessage.textContent = `Request ${data.request?.id} updated to ${data.request?.status}.`;
          approvalActionMessage.className = "text-sm mt-4 text-emerald-600";
        }
        if (forwardToEmail) forwardToEmail.value = "";
        loadApprovalDetail();
      } catch (error) {
        if (approvalActionMessage) {
          approvalActionMessage.textContent = error.message || "Failed to apply action";
          approvalActionMessage.className = "text-sm mt-4 text-rose-600";
        }
      }
    });
  });

  if (approverRoleSelect) approverRoleSelect.style.display = "none";
  if (refreshApprovalsBtn) refreshApprovalsBtn.addEventListener("click", loadApprovalInbox);
  window.addEventListener("smartflow:realtime", (event) => {
    const eventType = event.detail?.type;
    if (eventType === "request_created" || eventType === "request_updated" || eventType === "request_deleted") {
      loadApprovalInbox();
      loadApprovalDetail();
    }
    if (eventType === "workflow_created") {
      loadWorkflows();
    }
  });

  loadWorkflows();
  loadApprovalInbox();
  loadApprovalDetail();
})();
