// Applies the last known theme and accent before first paint (no flash).
// The source of truth is the user's server-side preferences; this is a cache.
(function () {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem("sentinel.theme") || "dark";
    if (theme === "system") theme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    root.setAttribute("data-theme", theme === "light" ? "light" : "dark");
    var accent = localStorage.getItem("sentinel.accent");
    if (accent === "cyan" || accent === "emerald" || accent === "violet") root.setAttribute("data-accent", accent);
    if (localStorage.getItem("sentinel.density") === "compact") root.setAttribute("data-density", "compact");
  } catch (e) {
    root.setAttribute("data-theme", "dark");
  }
})();
