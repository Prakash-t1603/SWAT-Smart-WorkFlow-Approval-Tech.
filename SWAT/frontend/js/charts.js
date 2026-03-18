(function () {
  if (typeof Chart === "undefined") return;

  const trendEl = document.getElementById("approvalTrendChart");
  if (trendEl) {
    new Chart(trendEl, {
      type: "line",
      data: {
        labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        datasets: [
          {
            label: "Approved",
            data: [82, 96, 90, 110, 124, 99, 135],
            borderColor: "#0ea5e9",
            backgroundColor: "rgba(14, 165, 233, 0.18)",
            tension: 0.35,
            fill: true,
          },
          {
            label: "Pending",
            data: [25, 28, 21, 30, 33, 27, 24],
            borderColor: "#f59e0b",
            backgroundColor: "rgba(245, 158, 11, 0.12)",
            tension: 0.35,
            fill: true,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
      },
    });
  }

  const statusEl = document.getElementById("requestStatusChart");
  if (statusEl) {
    new Chart(statusEl, {
      type: "doughnut",
      data: {
        labels: ["Approved", "Pending", "Rejected", "Draft"],
        datasets: [
          {
            data: [1211, 134, 86, 51],
            backgroundColor: ["#16a34a", "#eab308", "#ef4444", "#64748b"],
            borderWidth: 0,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
      },
    });
  }
})();
