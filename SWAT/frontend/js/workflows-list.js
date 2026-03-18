(function () {
  const listBody = document.getElementById("workflow-list-body");
  const statActive = document.getElementById("stat-active");
  const searchInput = document.getElementById("search-input");

  let workflows = [];

  async function loadWorkflows() {
    try {
      const apiBase = window.__SMARTFLOW_API_BASE__ || "http://localhost:4000/api";
      const response = await fetch(`${apiBase}/workflows`);
      const data = await response.json();
      
      workflows = data.workflows || [];
      renderWorkflows(workflows);
      statActive.textContent = workflows.length;
    } catch (error) {
      console.error("Failed to load workflows:", error);
      listBody.innerHTML = `<tr><td colspan="6" class="px-6 py-12 text-center text-rose-500">Failed to load workflows. Make sure the backend is running.</td></tr>`;
    }
  }

  function renderWorkflows(list) {
    if (list.length === 0) {
      listBody.innerHTML = `<tr><td colspan="6" class="px-6 py-12 text-center text-slate-400 italic">No workflows found. Create your first one in the Visual Builder!</td></tr>`;
      return;
    }

    listBody.innerHTML = list.map(wf => `
      <tr class="group hover:bg-slate-100/50 dark:hover:bg-slate-800/30 transition-colors">
        <td class="px-6 py-4">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-500 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11v8a2 2 0 0 1-2 2H3"/><path d="M19 11v8a2 2 0 0 0 2 2h2"/><rect x="8" y="2" width="8" height="8" rx="2"/><path d="M12 10v4"/><path d="m9 14 3 3 3-3"/></svg>
            </div>
            <div>
              <p class="font-bold text-sm">${wf.name}</p>
              <p class="text-xs text-slate-500 truncate max-w-[200px]">${wf.description || 'No description'}</p>
            </div>
          </div>
        </td>
        <td class="px-6 py-4 text-xs font-mono text-slate-400">${wf.id}</td>
        <td class="px-6 py-4 text-sm">${(wf.nodes || []).length} Nodes</td>
        <td class="px-6 py-4 text-sm text-slate-500">${new Date(wf.createdAt).toLocaleDateString()}</td>
        <td class="px-6 py-4">
          <span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Active</span>
        </td>
        <td class="px-6 py-4 text-right">
          <div class="flex items-center justify-end gap-2">
            <button onclick="editWorkflow('${wf.id}')" class="p-2 hover:bg-sky-500/10 text-slate-400 hover:text-sky-500 rounded-lg transition-colors" title="Edit">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
            </button>
            <button onclick="deleteWorkflow('${wf.id}')" class="p-2 hover:bg-rose-500/10 text-slate-400 hover:text-rose-500 rounded-lg transition-colors" title="Delete">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join("");
  }

  window.editWorkflow = function(id) {
    // For now we just redirect to the builder. 
    // Real implementation would load the workflow in the builder.
    window.location.href = `workflow-builder.html?id=${id}`;
  };

  window.deleteWorkflow = async function(id) {
    if (!confirm("Are you sure you want to delete this workflow?")) return;
    
    try {
      const apiBase = window.__SMARTFLOW_API_BASE__ || "http://localhost:4000/api";
      const response = await fetch(`${apiBase}/workflows/${id}`, {
        method: "DELETE"
      });
      
      if (response.ok) {
        // Remove from local array and re-render
        workflows = workflows.filter(wf => wf.id !== id);
        renderWorkflows(workflows);
        statActive.textContent = workflows.length;
      } else {
        const data = await response.json();
        alert("Delete failed: " + (data.error || "Unknown error"));
      }
    } catch (error) {
      console.error("Delete failed:", error);
      alert("Delete failed: " + error.message);
    }
  };

  searchInput.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = workflows.filter(wf => 
      wf.name.toLowerCase().includes(term) || 
      wf.id.toLowerCase().includes(term)
    );
    renderWorkflows(filtered);
  });

  loadWorkflows();
})();
