(function () {
  const form = document.getElementById("employeeForm");
  const message = document.getElementById("employeeAdminMessage");
  const tableBody = document.getElementById("employeeTableBody");
  const reportsToSelect = document.getElementById("empReportsTo");

  function getApiBase() {
    return window.__SMARTFLOW_API_BASE__ || "http://localhost:4000/api";
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem("smartflow-user") || "{}");
    } catch (_) {
      return {};
    }
  }

  async function apiRequest(path, options) {
    const response = await fetch(`${getApiBase()}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function showMessage(text, ok) {
    if (!message) return;
    message.textContent = text;
    message.className = `text-sm mt-3 ${ok ? "text-emerald-600" : "text-rose-600"}`;
  }

  function renderUsers(users) {
    if (!tableBody || !reportsToSelect) return;
    tableBody.innerHTML = "";
    reportsToSelect.innerHTML = `<option value="">No Manager (Top level)</option>`;

    const byId = new Map(users.map((u) => [u.id, u]));
    users.forEach((user) => {
      const opt = document.createElement("option");
      opt.value = user.id;
      opt.textContent = `${user.name} (${user.orgRole})`;
      reportsToSelect.appendChild(opt);

      const row = document.createElement("tr");
      row.className = "border-b border-slate-300/20";
      const manager = user.reportsTo ? byId.get(user.reportsTo)?.name || user.reportsTo : "-";
      row.innerHTML = `
        <td class="py-2">${user.name}</td>
        <td class="py-2">${user.orgRole || "-"}</td>
        <td class="py-2">${manager}</td>
        <td class="py-2">${user.email || "-"}</td>
        <td class="py-2"><button class="btn-danger text-xs" data-remove-id="${user.id}">Remove</button></td>
      `;
      tableBody.appendChild(row);
    });
  }

  async function loadUsers() {
    const user = getUser();
    if (user.role !== "admin") {
      showMessage("Only admin can open employee admin.", false);
      if (form) form.style.display = "none";
      return;
    }
    const data = await apiRequest(`/admin/users?viewerId=${encodeURIComponent(user.id || user.email || "")}`, { method: "GET" });
    renderUsers(data.users || []);
  }

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const viewer = getUser();
      try {
        await apiRequest("/admin/users", {
          method: "POST",
          body: JSON.stringify({
            viewerId: viewer.id || viewer.email || "",
            name: document.getElementById("empName")?.value || "",
            email: document.getElementById("empEmail")?.value || "",
            password: document.getElementById("empPassword")?.value || "",
            orgRole: document.getElementById("empOrgRole")?.value || "",
            reportsTo: reportsToSelect?.value || "",
          }),
        });
        showMessage("Employee added.", true);
        form.reset();
        loadUsers();
      } catch (error) {
        showMessage(error.message || "Failed to add employee", false);
      }
    });
  }

  if (tableBody) {
    tableBody.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const removeId = target.getAttribute("data-remove-id");
      if (!removeId) return;
      const viewer = getUser();
      try {
        await apiRequest(`/admin/users/${encodeURIComponent(removeId)}?viewerId=${encodeURIComponent(viewer.id || viewer.email || "")}`, {
          method: "DELETE",
        });
        showMessage("Employee removed.", true);
        loadUsers();
      } catch (error) {
        showMessage(error.message || "Failed to remove employee", false);
      }
    });
  }

  window.addEventListener("smartflow:realtime", (event) => {
    const type = event.detail?.type;
    if (type === "org_updated") loadUsers();
  });

  loadUsers().catch((error) => {
    showMessage(error.message || "Failed to load users", false);
  });
})();
