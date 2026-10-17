import Alpine from "alpinejs";
import collapse from "@alpinejs/collapse";
import "htmx.org";
import "htmx.org/dist/ext/hx-alpine-compat.js";
import "htmx.org/dist/ext/hx-head.js";
import "htmx.org/dist/ext/hx-history-cache.js";

Alpine.plugin(collapse);

Alpine.data("themeToggle", () => ({
  dark: document.documentElement.classList.contains("dark"),

  init() {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
      if (localStorage.getItem("theme") === null) {
        this.apply(event.matches);
      }
    });
  },

  apply(dark) {
    this.dark = dark;
    document.documentElement.classList.toggle("dark", dark);
  },

  toggle() {
    const dark = !this.dark;
    localStorage.setItem("theme", dark ? "dark" : "light");
    this.apply(dark);
  },
}));

window.Alpine = Alpine;

Alpine.start();
