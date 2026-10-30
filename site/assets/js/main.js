import Alpine from "alpinejs";
import collapse from "@alpinejs/collapse";

Alpine.plugin(collapse);

Alpine.data("themeToggle", () => ({
  theme: "auto",

  init() {
    const maybeTheme = localStorage.getItem("theme");
    this.theme = maybeTheme !== null ? maybeTheme : "auto";
    this.apply(this.currentTheme());

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (_event) => {
      this.apply(this.currentTheme());
    });
  },

  apply(theme) {
    switch (theme) {
      case "light":
        document.documentElement.classList.toggle("light", true);
        document.documentElement.classList.toggle("dark", false);
        break;
      case "dark":
        document.documentElement.classList.toggle("light", false);
        document.documentElement.classList.toggle("dark", true);
        break;
      default:
        document.documentElement.classList.toggle("light", false);
        document.documentElement.classList.toggle("dark", false);
        break;
    }
  },

  toggle() {
    this.theme = this.reverseTheme(this.currentTheme());
    localStorage.setItem("theme", this.theme);
    this.apply(this.theme);
  },

  currentTheme() {
    if (this.theme !== "auto") {
      return this.theme;
    } else {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
  },

  reverseTheme(theme) {
    return theme === "light" ? "dark" : "light";
  },
}));

window.Alpine = Alpine;

Alpine.start();
