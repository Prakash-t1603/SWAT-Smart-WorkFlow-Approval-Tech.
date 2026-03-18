(function () {
  const canvas = document.getElementById("workflow-canvas");
  const container = document.getElementById("canvas-container");
  const connectionsLayer = document.getElementById("connections-layer");
  const propertiesPanel = document.getElementById("properties-panel");
  const propertyForm = document.getElementById("property-form-container");
  const deleteBtn = document.getElementById("delete-node-btn");
  const closePanelBtn = document.getElementById("close-panel");
  const executeBtn = document.getElementById("execute-btn");
  const executionOverlay = document.getElementById("execution-overlay");
  const closeExecutionBtn = document.getElementById("close-execution");
  const executionLogs = document.getElementById("execution-logs");
  const saveBtn = document.getElementById("save-btn");
  const workflowTitle = document.getElementById("workflow-title");

  const urlParams = new URLSearchParams(window.location.search);
  let currentWorkflowId = urlParams.get("id");

  let state = {
    nodes: [],
    connections: [],
    selectedNodeId: null,
    isDragging: false,
    draggedNode: null,
    offset: { x: 0, y: 0 },
    activeConnection: null, // { fromId, startPos }
  };

  const nodeTypes = {
    start: { color: "bg-emerald-500", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>` },
    webhook: { color: "bg-blue-500", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>` },
    condition: { color: "bg-amber-500", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-9 9 9 9 9-9-9-9Z"/></svg>` },
    email: { color: "bg-sky-500", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>` },
    approval: { color: "bg-indigo-500", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>` },
    api: { color: "bg-rose-500", icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>` },
  };

  // --- Core Functions ---

  function createNode(type, x, y, name, id = null) {
    const nodeId = id || `node-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const nodeData = {
      id: nodeId,
      type,
      x,
      y,
      name: name || type.charAt(0).toUpperCase() + type.slice(1),
      config: {},
      description: ""
    };

    const nodeEl = document.createElement("div");
    nodeEl.className = "node";
    nodeEl.id = nodeId;
    nodeEl.style.left = `${x}px`;
    nodeEl.style.top = `${y}px`;

    const config = nodeTypes[type] || nodeTypes.email;

    nodeEl.innerHTML = `
      <div class="node-header pointer-events-none">
        <div class="node-icon ${config.color}">
          ${config.icon}
        </div>
        <span>${nodeData.name}</span>
      </div>
      <div class="node-content text-slate-400 pointer-events-none">
        ${type === 'start' ? 'Workflow trigger' : 'No config set'}
      </div>
      ${type !== 'start' ? '<div class="port port-input" data-port="input"></div>' : ''}
      <div class="port port-output" data-port="output"></div>
    `;

    canvas.appendChild(nodeEl);
    state.nodes.push(nodeData);

    // Events
    nodeEl.addEventListener("mousedown", (e) => onNodeMouseDown(e, nodeId));
    nodeEl.querySelectorAll(".port").forEach((p) => {
      p.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        onPortMouseDown(e, nodeId, p.dataset.port);
      });
    });

    return nodeData;
  }

  async function loadWorkflowData(id) {
    try {
      const apiBase = window.__SMARTFLOW_API_BASE__ || "http://localhost:4000/api";
      const response = await fetch(`${apiBase}/workflows/${id}`);
      if (!response.ok) throw new Error("Workflow not found");
      
      const { workflow } = await response.json();
      
      // Clear
      state.nodes = [];
      state.connections = workflow.connections || [];
      document.querySelectorAll(".node").forEach(n => n.remove());
      workflowTitle.textContent = workflow.name;

      // Restore
      workflow.nodes.forEach(node => {
        const newNode = createNode(node.type, node.x, node.y, node.name, node.id);
        newNode.config = node.config || {};
        newNode.description = node.description || "";
        const nodeEl = document.getElementById(newNode.id);
        const contentEl = nodeEl.querySelector(".node-content");
        if (contentEl && node.description) contentEl.textContent = node.description;
      });

      updateConnections();
      addLog(`Loaded workflow: ${workflow.name}`);
    } catch (error) {
      console.error("Load failed:", error);
      addLog("Failed to load workflow: " + error.message);
      createNode("start", 100, 200);
    }
  }

  function updateConnections() {
    const tempPath = document.getElementById("temp-connection");
    if (tempPath) tempPath.remove();

    const paths = state.connections.map((conn) => {
      const fromNode = state.nodes.find((n) => n.id === conn.fromId);
      const toNode = state.nodes.find((n) => n.id === conn.toId);
      if (!fromNode || !toNode) return "";

      const start = { x: fromNode.x + 180, y: fromNode.y + 36 };
      const end = { x: toNode.x, y: toNode.y + 36 };
      return createBezierPath(start, end);
    });

    connectionsLayer.innerHTML = `
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orientation="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#38bdf8" />
        </marker>
      </defs>
      ${paths.map(d => d ? `<path class="connection-path" d="${d}" marker-end="url(#arrowhead)"/>` : "").join("")}
    `;
  }

  function createBezierPath(start, end) {
    const dx = Math.abs(end.x - start.x) / 2;
    const cp1 = { x: start.x + dx, y: start.y };
    const cp2 = { x: end.x - dx, y: end.y };
    return `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`;
  }

  // --- Handlers ---

  function onNodeMouseDown(e, id) {
    if (e.target.classList.contains("port")) return;
    
    state.isDragging = true;
    state.draggedNode = id;
    const nodeData = state.nodes.find((n) => n.id === id);
    const rect = container.getBoundingClientRect();
    
    state.offset = {
      x: (e.clientX - rect.left) - nodeData.x,
      y: (e.clientY - rect.top) - nodeData.y,
    };

    selectNode(id);
  }

  function onPortMouseDown(e, nodeId, portType) {
    if (portType === "input") return; 

    const nodeData = state.nodes.find((n) => n.id === nodeId);
    const startPos = { x: nodeData.x + 180, y: nodeData.y + 36 };

    state.activeConnection = { fromId: nodeId, startPos };

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.id = "temp-connection";
    path.className = "connection-path active";
    connectionsLayer.appendChild(path);
  }

  function selectNode(id) {
    state.selectedNodeId = id;
    document.querySelectorAll(".node").forEach((n) => n.classList.toggle("selected", n.id === id));
    const node = state.nodes.find((n) => n.id === id);
    renderProperties(node);
    propertiesPanel.classList.remove("translate-x-full");
  }

  function renderProperties(node) {
    if (!node) return;
    propertyForm.innerHTML = `
      <div>
        <label class="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-1">Node Name</label>
        <input class="input" value="${node.name || ""}" id="prop-name" />
      </div>
      <div>
        <label class="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-1">Description</label>
        <textarea class="input" rows="2" id="prop-description" placeholder="What does this node do?">${node.description || ""}</textarea>
      </div>
      ${renderTypeSpecificProps(node)}
    `;

    document.getElementById("prop-name").addEventListener("input", (e) => {
      node.name = e.target.value;
      document.getElementById(node.id).querySelector(".node-header span").textContent = e.target.value;
    });

    document.getElementById("prop-description").addEventListener("input", (e) => {
      node.description = e.target.value;
      const contentEl = document.getElementById(node.id).querySelector(".node-content");
      if (contentEl) contentEl.textContent = e.target.value || (node.type === "start" ? "Workflow trigger" : "No config set");
    });

    ["recipient", "subject", "expression"].forEach(key => {
      const el = document.getElementById(`prop-${key}`);
      if (el) el.addEventListener("input", (e) => node.config[key] = e.target.value);
    });

    const propRole = document.getElementById("prop-role");
    if (propRole) propRole.addEventListener("change", (e) => node.config.role = e.target.value);
  }

  function renderTypeSpecificProps(node) {
    switch (node.type) {
      case "email":
        return `<div><label class="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-1">Recipient</label><input class="input" id="prop-recipient" placeholder="email@example.com" value="${node.config.recipient || ""}" /></div>
                <div><label class="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-1">Subject</label><input class="input" id="prop-subject" placeholder="Workflow Update" value="${node.config.subject || ""}" /></div>`;
      case "condition":
        return `<div><label class="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-1">Expression</label><input class="input" id="prop-expression" placeholder="amount > 5000" value="${node.config.expression || ""}" /></div>`;
      case "approval":
        return `<div><label class="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-1">Approver Role</label>
                <select class="input" id="prop-role">
                  <option value="Manager" ${node.config.role === "Manager" ? "selected" : ""}>Manager</option>
                  <option value="Finance" ${node.config.role === "Finance" ? "selected" : ""}>Finance</option>
                  <option value="CFO" ${node.config.role === "CFO" ? "selected" : ""}>CFO</option>
                </select></div>`;
      default: return "";
    }
  }

  // --- Global Listeners ---

  window.addEventListener("mousemove", (e) => {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (state.isDragging && state.draggedNode) {
      const nodeData = state.nodes.find((n) => n.id === state.draggedNode);
      nodeData.x = x - state.offset.x;
      nodeData.y = y - state.offset.y;
      const nodeEl = document.getElementById(state.draggedNode);
      nodeEl.style.left = `${nodeData.x}px`;
      nodeEl.style.top = `${nodeData.y}px`;
      updateConnections();
    }

    if (state.activeConnection) {
      const tempPath = document.getElementById("temp-connection");
      tempPath.setAttribute("d", createBezierPath(state.activeConnection.startPos, { x, y }));
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (state.activeConnection) {
      if (e.target.classList.contains("port-input")) {
        const toNodeId = e.target.closest(".node").id;
        const fromId = state.activeConnection.fromId;
        if (fromId !== toNodeId && !state.connections.find(c => c.fromId === fromId && c.toId === toNodeId)) {
          state.connections.push({ fromId, toId: toNodeId });
        }
      }
      state.activeConnection = null;
      updateConnections();
    }
    state.isDragging = false;
    state.draggedNode = null;
  });

  // --- D&D Sidebar ---

  document.querySelectorAll(".sidebar-node-item").forEach((item) => {
    item.addEventListener("dragstart", (e) => e.dataTransfer.setData("nodeType", item.dataset.type));
  });

  container.addEventListener("dragover", (e) => e.preventDefault());
  container.addEventListener("drop", (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("nodeType");
    const rect = container.getBoundingClientRect();
    const newNode = createNode(type, e.clientX - rect.left - 90, e.clientY - rect.top - 30);
    selectNode(newNode.id);
  });

  // --- UI ---

  saveBtn.addEventListener("click", async () => {
    const name = workflowTitle.textContent.trim();
    addLog(`${currentWorkflowId ? 'Updating' : 'Saving'} workflow '${name}'...`);
    const method = currentWorkflowId ? "PUT" : "POST";
    const url = `${window.__SMARTFLOW_API_BASE__ || "http://localhost:4000/api"}/workflows${currentWorkflowId ? '/' + currentWorkflowId : ''}`;

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, nodes: state.nodes, connections: state.connections })
      });
      const data = await response.json();
      if (response.ok) {
        addLog(`Workflow saved successfully!`);
        saveBtn.textContent = "Saved";
        setTimeout(() => saveBtn.textContent = "Save", 2000);
        if (!currentWorkflowId && data.workflow) {
          currentWorkflowId = data.workflow.id;
          window.history.replaceState(null, "", `?id=${currentWorkflowId}`);
        }
      } else throw new Error(data.error || "Save failed");
    } catch (error) { addLog("Save failed: " + error.message); }
  });

  executeBtn.addEventListener("click", async () => {
    executionOverlay.classList.remove("translate-y-[150%]");
    executionLogs.innerHTML = "";
    addLog("Initializing execution engine...");
    const user = JSON.parse(localStorage.getItem("smartflow-user") || "{}");
    try {
      await fetch(`${window.__SMARTFLOW_API_BASE__ || "http://localhost:4000/api"}/workflows/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: currentWorkflowId || "temp", nodes: state.nodes, viewerId: user.id })
      });
    } catch (error) { addLog("Execution failed: " + error.message); }
  });

  function addLog(message, time = new Date().toLocaleTimeString()) {
    const entry = document.createElement("div");
    entry.className = "flex justify-between py-1 border-b border-slate-200/10 last:border-0";
    entry.innerHTML = `<span class="text-slate-400">${message}</span><span class="font-mono text-[10px] text-sky-500">${time}</span>`;
    executionLogs.prepend(entry);
  }

  deleteBtn.addEventListener("click", () => {
    if (!state.selectedNodeId) return;
    const id = state.selectedNodeId;
    state.nodes = state.nodes.filter(n => n.id !== id);
    state.connections = state.connections.filter(c => c.fromId !== id && c.toId !== id);
    document.getElementById(id).remove();
    updateConnections();
    closePanelBtn.click();
  });

  closePanelBtn.addEventListener("click", () => {
    propertiesPanel.classList.add("translate-x-full");
    state.selectedNodeId = null;
    document.querySelectorAll(".node").forEach(n => n.classList.remove("selected"));
  });

  closeExecutionBtn.addEventListener("click", () => executionOverlay.classList.add("translate-y-[150%]"));

  window.addEventListener("smartflow:realtime", (event) => {
    const packet = event.detail;
    if (!packet) return;
    if (packet.type === "node_executed") {
      const el = document.getElementById(packet.payload.nodeId);
      if (el) {
        el.classList.add("node-executing");
        setTimeout(() => el.classList.remove("node-executing"), 2000);
      }
      addLog(packet.payload.message);
    } else if (packet.type === "workflow_finished") addLog("Workflow execution finished!", "DONE");
  });

  // --- Init ---
  if (currentWorkflowId) loadWorkflowData(currentWorkflowId);
  else createNode("start", 100, 200);
})();
