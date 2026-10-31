function currentTheme(theme) {
  if (theme !== "auto") {
    return theme;
  } else {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
}

function reverseTheme(theme) {
  return theme === "light" ? "dark" : "light";
}

function applyThemeClass(theme) {
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
}

function init() {
  const maybeTheme = localStorage.getItem("theme");
  let theme = maybeTheme !== null ? maybeTheme : "auto";
  applyThemeClass(currentTheme(theme));

  document.getElementById("mobile-menu-button").addEventListener("click", () => {
    theme = reverseTheme(currentTheme(theme));
    localStorage.setItem("theme", theme);
    applyThemeClass(theme);
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (_event) => {
    applyThemeClass(currentTheme(theme));
  });
}

init();
