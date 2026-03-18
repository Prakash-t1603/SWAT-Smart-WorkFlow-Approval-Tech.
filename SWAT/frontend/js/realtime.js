(function () {
  function getApiBase() {
    return window.__SMARTFLOW_API_BASE__ || "http://localhost:4000/api";
  }

  function getWebSocketUrl() {
    const apiBase = getApiBase().replace(/\/+$/, "");
    const httpBase = apiBase.replace(/\/api$/, "");
    const wsBase = httpBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    return `${wsBase}/ws/events`;
  }

  let socket = null;
  let reconnectTimer = null;

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 2000);
  }

  function connect() {
    try {
      socket = new WebSocket(getWebSocketUrl());
    } catch (_) {
      scheduleReconnect();
      return;
    }

    socket.addEventListener("message", (event) => {
      try {
        const packet = JSON.parse(event.data || "{}");
        window.dispatchEvent(new CustomEvent("smartflow:realtime", { detail: packet }));
      } catch (_) {
        // ignore malformed frames
      }
    });

    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", () => {
      try {
        socket.close();
      } catch (_) {
        // noop
      }
    });
  }

  connect();
})();
