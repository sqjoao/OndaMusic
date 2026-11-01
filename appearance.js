// Apply the saved theme before the stylesheet and first paint.
// A separate key keeps appearance changes independent from playback data.
(() => {
  const STORAGE_KEY = "onda:appearance:v1";
  const DEFAULTS = { theme: "system", accent: "#52525b" };
  const root = document.documentElement;
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let settings = readSettings();
  let storageAvailable = true;

  function normalizeHex(value) {
    if (typeof value !== "string") return null;
    const hex = value.trim().replace(/^#/, "");
    if (/^[a-f\d]{3}$/i.test(hex)) {
      return `#${[...hex].map((character) => character.repeat(2)).join("")}`.toLowerCase();
    }
    return /^[a-f\d]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
  }

  function readSettings(raw) {
    try {
      const saved = JSON.parse(
        raw === undefined ? localStorage.getItem(STORAGE_KEY) : raw,
      );
      return {
        theme: ["light", "dark", "system"].includes(saved?.theme)
          ? saved.theme
          : DEFAULTS.theme,
        accent: normalizeHex(saved?.accent) || DEFAULTS.accent,
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function rgb(hex) {
    return [1, 3, 5].map((offset) =>
      parseInt(hex.slice(offset, offset + 2), 16),
    );
  }

  function mix(color, target, amount) {
    return color.map((channel, index) =>
      Math.round(channel * (1 - amount) + target[index] * amount),
    );
  }

  function luminance(color) {
    return color.reduce((total, channel, index) => {
      const value = channel / 255;
      const linear =
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      return total + linear * [0.2126, 0.7152, 0.0722][index];
    }, 0);
  }

  function contrast(first, second) {
    const a = luminance(first);
    const b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function css(color) {
    return `rgb(${color.join(", ")})`;
  }

  function applyAppearance() {
    const dark =
      settings.theme === "dark" ||
      (settings.theme === "system" && systemTheme.matches);
    const background = rgb(dark ? "#151517" : "#fafafa");
    const surface = rgb(dark ? "#1c1c1f" : "#ffffff");
    const foreground = rgb(dark ? "#ededf0" : "#242428");
    const accent = rgb(settings.accent);
    const subtle = mix(accent, surface, 0.92);
    const onAccent =
      contrast(accent, [255, 255, 255]) >= contrast(accent, [0, 0, 0])
        ? [255, 255, 255]
        : [0, 0, 0];
    // Keep the selected fill, but ensure text and focus rings stay readable,
    // including when a white, black or yellow accent is chosen.
    let ink = accent;
    for (let step = 0; step <= 20; step++) {
      ink = mix(accent, foreground, step / 20);
      if (
        [background, surface, subtle].every(
          (color) => contrast(ink, color) >= 4.8,
        )
      )
        break;
    }
    root.dataset.theme = dark ? "dark" : "light";
    root.style.setProperty("--accent", settings.accent);
    root.style.setProperty("--accent-on", css(onAccent));
    root.style.setProperty("--accent-ink", css(ink));
    root.style.setProperty("--accent-soft", css(subtle));
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", css(background));
  }

  function renderControls() {
    for (const input of document.querySelectorAll('input[name="theme"]'))
      input.checked = input.value === settings.theme;
    for (const button of document.querySelectorAll("[data-accent]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.accent === settings.accent),
      );
    const picker = document.querySelector("#accent-color");
    const hex = document.querySelector("#accent-hex");
    if (picker) picker.value = settings.accent;
    if (hex) {
      hex.value = settings.accent;
      hex.setAttribute("aria-invalid", "false");
      document.querySelector("#color-error").hidden = true;
    }
    const status = document.querySelector("#appearance-status");
    if (status)
      status.textContent = storageAvailable
        ? "Salvo automaticamente neste navegador."
        : "A aparência foi aplicada, mas o navegador não permitiu salvar a preferência.";
  }

  function updateSettings(changes) {
    settings = { ...settings, ...changes };
    applyAppearance();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      storageAvailable = true;
    } catch {
      storageAvailable = false;
    }
    renderControls();
  }

  function bindControls() {
    const dialog = document.querySelector("#settings-dialog");
    document
      .querySelector("#open-settings")
      .addEventListener("click", () => dialog.showModal());
    for (const input of document.querySelectorAll('input[name="theme"]')) {
      input.addEventListener("change", () => {
        if (input.checked) updateSettings({ theme: input.value });
      });
    }
    for (const button of document.querySelectorAll("[data-accent]")) {
      button.addEventListener("click", () =>
        updateSettings({ accent: button.dataset.accent }),
      );
    }
    document
      .querySelector("#accent-color")
      .addEventListener("input", (event) => {
        const accent = normalizeHex(event.target.value);
        if (accent) updateSettings({ accent });
      });
    const hex = document.querySelector("#accent-hex");
    const commitHex = () => {
      const accent = normalizeHex(hex.value);
      hex.setAttribute("aria-invalid", String(!accent));
      document.querySelector("#color-error").hidden = Boolean(accent);
      if (accent) updateSettings({ accent });
    };
    hex.addEventListener("change", commitHex);
    hex.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitHex();
      }
    });
    hex.addEventListener("input", () => {
      hex.setAttribute("aria-invalid", "false");
      document.querySelector("#color-error").hidden = true;
    });
    document
      .querySelector("#reset-appearance")
      .addEventListener("click", () => updateSettings(DEFAULTS));
    renderControls();
  }

  systemTheme.addEventListener("change", () => {
    if (settings.theme === "system") applyAppearance();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    settings = readSettings(event.newValue);
    applyAppearance();
    renderControls();
  });
  applyAppearance();
  document.addEventListener("DOMContentLoaded", bindControls, { once: true });
})();
