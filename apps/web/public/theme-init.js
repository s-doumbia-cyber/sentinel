// Applies the last known theme and accent before first paint (no flash).
// The source of truth is the user's server-side preferences; this is a cache.
(function () {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem("sentinel.theme") || "light";
    if (theme === "system") theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    root.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
    var accent = localStorage.getItem("sentinel.accent");
    if (accent === "ocean" || accent === "plum" || accent === "pine") root.setAttribute("data-accent", accent);
    if (localStorage.getItem("sentinel.density") === "compact") root.setAttribute("data-density", "compact");
  } catch (e) {
    root.setAttribute("data-theme", "light");
  }
})();
