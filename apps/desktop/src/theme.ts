export type ThemeChoice = "system" | "light" | "dark";

const KEY = "qr.theme";

export function loadTheme(): ThemeChoice {
  const v = window.localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

/** "system" menghapus atribut agar tokens.css mengikuti prefers-color-scheme. */
export function applyTheme(t: ThemeChoice): void {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  window.localStorage.setItem(KEY, t);
}
