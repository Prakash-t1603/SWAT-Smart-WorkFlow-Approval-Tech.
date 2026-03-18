(function () {
  const storageKey = "smartflow-theme";
  const root = document.documentElement;
  const sidebar = document.getElementById("sidebar");

  function applyTheme(theme) {
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }

  function currentTheme() {
    return root.classList.contains("dark") ? "dark" : "light";
  }

  function syncThemeSymbols() {
    const icon = currentTheme() === "dark" ? "\u2600" : "\u263D";
    document.querySelectorAll("[data-theme-symbol='true']").forEach((btn) => {
      btn.textContent = icon;
    });
  }

  const saved = localStorage.getItem(storageKey);
  if (saved) {
    applyTheme(saved);
  } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    applyTheme("dark");
  }
  syncThemeSymbols();

  document.querySelectorAll("[data-dark-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyTheme(currentTheme() === "dark" ? "light" : "dark");
      localStorage.setItem(storageKey, currentTheme());
      syncThemeSymbols();
    });
  });

  document.querySelectorAll("[data-sidebar-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (sidebar) sidebar.classList.toggle("open");
    });
  });
})();
