// Audio files and playlists stay on this origin, inside the browser's IndexedDB.
const DATABASE_NAME = "onda-player";
let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("tracks")) {
        const tracks = database.createObjectStore("tracks", { keyPath: "id" });
        tracks.createIndex("fingerprint", "fingerprint", { unique: true });
      }
      if (!database.objectStoreNames.contains("playlists"))
        database.createObjectStore("playlists", { keyPath: "id" });
      if (!database.objectStoreNames.contains("settings"))
        database.createObjectStore("settings", { keyPath: "id" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Feche outras abas do onda e tente novamente."));
  });
  return databasePromise;
}

async function transaction(stores, mode, action) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () =>
      reject(tx.error || new Error("Falha no armazenamento local."));
    tx.onabort = () =>
      reject(tx.error || new Error("Operação de armazenamento cancelada."));
    try {
      action(tx, (value) => {
        result = value;
      });
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}

function readAll(store) {
  return transaction([store], "readonly", (tx, done) => {
    tx.objectStore(store).getAll().onsuccess = (event) =>
      done(event.target.result);
  });
}

function saveRecord(store, record) {
  return transaction([store], "readwrite", (tx) =>
    tx.objectStore(store).put(record),
  );
}

function deletePlaylist(id) {
  return transaction(["playlists"], "readwrite", (tx) =>
    tx.objectStore("playlists").delete(id),
  );
}

// Removing a song and its playlist references must either both succeed or both fail.
function deleteTrack(id, playlists) {
  return transaction(["tracks", "playlists"], "readwrite", (tx) => {
    tx.objectStore("tracks").delete(id);
    for (const playlist of playlists) tx.objectStore("playlists").put(playlist);
  });
}

// Apply the saved theme before the stylesheet and first paint.
// A separate key keeps appearance changes independent from playback data.
(() => {
  const STORAGE_KEY = "onda:appearance:v1";
  const DEFAULTS = {
    theme: "system",
    accent: "#52525b",
    font: "system",
    customFont: "",
    scale: "1",
    density: "comfortable",
    radius: "8",
    dim: "0.6",
    opacity: "90",
    blur: "10",
  };
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
        ...Object.fromEntries(
          Object.entries(DEFAULTS)
            .filter(([key]) => !["theme", "accent"].includes(key))
            .map(([key, value]) => [
              key,
              typeof saved?.[key] === "string" ? saved[key] : value,
            ]),
        ),
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
    const bounded = (value, min, max, fallback) =>
      Number.isFinite(Number(value))
        ? Math.max(min, Math.min(max, Number(value)))
        : fallback;
    root.style.fontFamily = settings.customFont.trim()
      ? JSON.stringify(settings.customFont.trim().slice(0, 60)) + ", sans-serif"
      : settings.font === "system"
        ? '"Segoe UI", sans-serif'
        : JSON.stringify(settings.font) + ", sans-serif";
    root.style.zoom = bounded(settings.scale, 0.9, 1.2, 1);
    root.style.setProperty(
      "--row-height",
      settings.density === "compact" ? "48px" : "65px",
    );
    root.style.setProperty(
      "--row-padding",
      settings.density === "compact" ? "7px" : "14px",
    );
    root.style.setProperty(
      "--corner-radius",
      bounded(settings.radius, 0, 20, 8) + "px",
    );
    root.style.setProperty(
      "--wallpaper-dim",
      bounded(settings.dim, 0.15, 0.95, 0.6),
    );
    root.style.setProperty(
      "--panel-opacity",
      bounded(settings.opacity, 50, 100, 90) + "%",
    );
    root.style.setProperty(
      "--panel-blur",
      bounded(settings.blur, 0, 24, 10) + "px",
    );
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
    for (const [id, key] of Object.entries({
      "ui-font": "font",
      "custom-font": "customFont",
      "ui-scale": "scale",
      "ui-density": "density",
      "ui-radius": "radius",
      "wallpaper-dim": "dim",
      "panel-opacity": "opacity",
      "panel-blur": "blur",
    })) {
      const input = document.getElementById(id);
      if (input && document.activeElement !== input)
        input.value = settings[key];
    }
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
        ? "Salvo automaticamente neste computador."
        : "A aparência foi aplicada, mas o aplicativo não permitiu salvar a preferência.";
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
    for (const [id, key] of Object.entries({
      "ui-font": "font",
      "custom-font": "customFont",
      "ui-scale": "scale",
      "ui-density": "density",
      "ui-radius": "radius",
      "wallpaper-dim": "dim",
      "panel-opacity": "opacity",
      "panel-blur": "blur",
    }))
      document
        .getElementById(id)
        .addEventListener("input", (event) =>
          updateSettings({ [key]: event.target.value }),
        );
    let wallpaperURL;
    function showWallpaper(file) {
      if (wallpaperURL) URL.revokeObjectURL(wallpaperURL);
      wallpaperURL = file ? URL.createObjectURL(file) : null;
      document.body.classList.toggle("has-wallpaper", Boolean(file));
      root.style.setProperty(
        "--wallpaper",
        wallpaperURL ? `url("${wallpaperURL}")` : "none",
      );
    }
    document
      .querySelector("#choose-wallpaper")
      .addEventListener("click", () =>
        document.querySelector("#wallpaper-file").click(),
      );
    document
      .querySelector("#wallpaper-file")
      .addEventListener("change", async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        try {
          if (
            !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
            file.size > 20 * 1024 * 1024
          )
            throw Error("Use PNG, JPEG ou WebP de até 20 MB.");
          const probe = await createImageBitmap(file);
          probe.close();
          await saveRecord("settings", { id: "wallpaper", file });
          showWallpaper(file);
          document.querySelector("#wallpaper-status").textContent =
            "Wallpaper salvo.";
        } catch (error) {
          document.querySelector("#wallpaper-status").textContent =
            error.message || "Não foi possível salvar a imagem.";
        } finally {
          event.target.value = "";
        }
      });
    document
      .querySelector("#remove-wallpaper")
      .addEventListener("click", async () => {
        try {
          await saveRecord("settings", { id: "wallpaper", file: null });
          showWallpaper(null);
          document.querySelector("#wallpaper-status").textContent =
            "Wallpaper removido.";
        } catch {
          document.querySelector("#wallpaper-status").textContent =
            "Não foi possível remover o wallpaper.";
        }
      });
    readAll("settings")
      .then((records) =>
        showWallpaper(
          records.find((record) => record.id === "wallpaper")?.file,
        ),
      )
      .catch(() => {});
    document
      .querySelector("#reset-appearance")
      .addEventListener("click", () =>
        document.querySelector("#remove-wallpaper").click(),
      );
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

const $ = (selector) => document.querySelector(selector);
const audio = $("#audio");
const collator = new Intl.Collator("pt-BR", {
  sensitivity: "base",
  numeric: true,
});
const PREFERENCES_KEY = "onda:preferences:v1";
const state = {
  tracks: [],
  playlists: [],
  view: "library",
  search: "",
  sort: "recent",
  currentId: null,
  queue: [],
  queueSource: [],
  shuffle: false,
  repeat: "off",
  volume: 0.7,
  muted: false,

  databaseReady: false,
};
let currentURL;
let loadVersion = 0;
let toastTimeout;
let editingPlaylistId = null;
let pendingPlaylistTrackId = null;
let organizingTrackId = null;
let confirmationAction = null;
let lastSavedTime = 0;
let pendingSeek = null;

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function escapeHTML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

function time(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  return hours
    ? `${hours}:${String(Math.floor(whole / 60) % 60).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`
    : `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function countLabel(count) {
  return `${count} ${count === 1 ? "música" : "músicas"}`;
}

function totalTime(tracks) {
  const minutes = Math.round(
    tracks.reduce((total, track) => total + track.duration, 0) / 60,
  );
  if (minutes < 1) return "menos de 1 min";
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function getTrack(id = state.currentId) {
  return state.tracks.find((track) => track.id === id);
}

function currentPlaylist() {
  return state.playlists.find((playlist) => playlist.id === state.view);
}

function toast(message, error = false) {
  clearTimeout(toastTimeout);
  $("#toast-region").innerHTML =
    `<div class="toast${error ? " error" : ""}">${icon(error ? "music" : "check")}<span>${escapeHTML(message)}</span></div>`;
  toastTimeout = setTimeout(
    () => {
      $("#toast-region").replaceChildren();
    },
    error ? 6500 : 4200,
  );
}

function storageError(error) {
  console.error(
    "Onda: operação de armazenamento não concluída.",
    error?.name || "StorageError",
  );
  toast(
    error?.name === "QuotaExceededError"
      ? "O armazenamento está cheio. Libere espaço no aplicativo antes de importar mais músicas."
      : "Não foi possível salvar. Verifique se o aplicativo permite armazenamento local.",
    true,
  );
}

function savePreferences() {
  try {
    localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({
        volume: state.volume,
        muted: state.muted,
        shuffle: state.shuffle,
        repeat: state.repeat,
        currentId: state.currentId,
        currentTime: audio.currentTime || 0,
        queue: state.queue,
        queueSource: state.queueSource,
      }),
    );
  } catch {
    /* Playback still works if only localStorage is unavailable. */
  }
}

function readPreferences() {
  try {
    const data = JSON.parse(localStorage.getItem(PREFERENCES_KEY)) || {};
    if (typeof data.volume === "number" && Number.isFinite(data.volume))
      state.volume = Math.min(1, Math.max(0, data.volume));
    state.muted = data.muted === true;
    state.shuffle = data.shuffle === true;
    if (["off", "all", "one"].includes(data.repeat)) state.repeat = data.repeat;
    return data;
  } catch {
    return {};
  }
}

function rangeFill(input) {
  const minimum = Number(input.min) || 0;
  const maximum = Number(input.max) || 1;
  const percent = Math.min(
    100,
    Math.max(0, ((Number(input.value) - minimum) / (maximum - minimum)) * 100),
  );
  input.style.setProperty("--range-progress", `${percent}%`);
}

function viewTracks(includeSearch = true) {
  const playlist = currentPlaylist();
  let tracks = playlist
    ? playlist.trackIds.map((id) => getTrack(id)).filter(Boolean)
    : [...state.tracks];
  if (state.view === "favorites")
    tracks = tracks.filter((track) => track.favorite);
  // "Recentes" lists the collection in import order by default.
  if (state.sort === "title")
    tracks.sort((a, b) => collator.compare(a.title, b.title));
  else if (state.sort === "artist")
    tracks.sort(
      (a, b) =>
        collator.compare(a.artist, b.artist) ||
        collator.compare(a.title, b.title),
    );
  else tracks.sort((a, b) => b.importedAt - a.importedAt);
  if (includeSearch && state.search.trim()) {
    const normalize = (text) =>
      text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR");
    const query = normalize(state.search.trim());
    tracks = tracks.filter((track) =>
      normalize(`${track.title} ${track.artist} ${track.name}`).includes(query),
    );
  }
  return tracks;
}

function renderNavigation() {
  $("#library-count").textContent = state.tracks.length;
  for (const button of document.querySelectorAll("[data-view]")) {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  $("#playlist-nav").innerHTML =
    state.playlists
      .map(
        (playlist) => `
    <button class="nav-item${state.view === playlist.id ? " active" : ""}" data-playlist-view="${playlist.id}"${state.view === playlist.id ? ' aria-current="page"' : ""} title="${escapeHTML(playlist.name)}">
      <span class="playlist-icon">${icon("music")}</span>
      <span>${escapeHTML(playlist.name)}</span>
    </button>`,
      )
      .join("") || '<p class="playlist-empty">Nenhuma playlist</p>';
}

function renderLibrary() {
  const playlist = currentPlaylist();
  const titles = {
    library: "Biblioteca",
    favorites: "Favoritas",
    recent: "Recentes",
  };
  const title = playlist?.name || titles[state.view] || "Biblioteca";
  const tracks = viewTracks();
  const allViewTracks = viewTracks(false);
  $("#view-title").textContent = title;
  $("#collection-summary").textContent =
    allViewTracks.length && allViewTracks.every((track) => track.duration > 0)
      ? `${countLabel(allViewTracks.length)} · ${totalTime(allViewTracks)}`
      : countLabel(allViewTracks.length);
  $("#edit-playlist").hidden = !playlist;
  $("#play-all").disabled = !tracks.length;
  $("#shuffle-all").disabled = !tracks.length;

  $("#track-list").innerHTML = tracks
    .map((track, index) => {
      const isCurrent = track.id === state.currentId;
      const isPlaying = isCurrent && !audio.paused;
      return `<div class="track-row${isCurrent ? " is-current" : ""}" data-track="${track.id}">
      <div class="row-number"><span>${String(index + 1).padStart(2, "0")}</span><button class="icon-button" data-action="play" aria-label="${isPlaying ? "Pausar" : "Reproduzir"} ${escapeHTML(track.title)}">${icon(isPlaying ? "pause" : "play")}</button></div>
      <button class="track-details" data-action="play" aria-label="${isPlaying ? "Pausar" : "Reproduzir"} ${escapeHTML(track.title)} de ${escapeHTML(track.artist)}">
        <span class="track-copy"><strong title="${escapeHTML(track.title)}">${escapeHTML(track.title)}</strong><span>${escapeHTML(track.artist)}</span></span>
      </button><span class="track-format">${escapeHTML(track.format)}</span><span class="track-duration">${track.duration ? time(track.duration) : "—"}</span>
      <div class="track-actions"><button class="icon-button favorite-button${track.favorite ? " is-favorite" : ""}" data-action="favorite" aria-label="${track.favorite ? "Remover" : "Adicionar"} ${escapeHTML(track.title)} ${track.favorite ? "das" : "às"} favoritas" aria-pressed="${track.favorite}" title="${track.favorite ? "Remover das favoritas" : "Adicionar às favoritas"}">${icon("heart")}</button><button class="icon-button" data-action="organize" aria-label="Organizar ${escapeHTML(track.title)}" title="Organizar música">${icon("more")}</button></div>
    </div>`;
    })
    .join("");

  $("#empty-state").hidden = tracks.length > 0;
  const filtered = Boolean(state.search.trim()) && !tracks.length;
  $("#empty-title").textContent = filtered
    ? "Nenhum resultado"
    : playlist
      ? "Playlist vazia"
      : state.view === "favorites"
        ? "Nenhuma favorita"
        : "Escolha sua pasta de músicas";
  $("#empty-description").textContent = filtered
    ? "Tente outro nome de música ou artista."
    : playlist
      ? "Adicione músicas pelo menu de uma faixa ou importe novos arquivos."
      : state.view === "favorites"
        ? "Marque o coração ao lado de uma música para adicioná-la aqui."
        : "Escolha uma pasta para ouvir diretamente, sem copiar os arquivos para o app.";
  $("#empty-library").hidden = filtered || state.view === "favorites";
  renderNavigation();
}

function renderPlayer() {
  const track = getTrack();
  $("#now-title").textContent = track?.title || "Nenhuma música selecionada";
  $("#now-title").title = track?.title || "";
  $("#now-artist").textContent = track?.artist || "—";
  $("#play-pause").disabled = !track;
  $("#previous").disabled = !track;
  $("#next").disabled = !track;
  $("#player-favorite").disabled = !track;
  $("#seek").disabled = !track || !Number.isFinite(audio.duration);
  const playing = Boolean(track) && !audio.paused;
  $("#play-pause").innerHTML = icon(playing ? "pause" : "play");
  $("#play-pause").setAttribute(
    "aria-label",
    playing ? "Pausar" : "Reproduzir",
  );
  $("#play-pause").title = playing ? "Pausar" : "Reproduzir";
  $("#player-favorite").classList.toggle(
    "is-favorite",
    Boolean(track?.favorite),
  );
  $("#player-favorite").setAttribute(
    "aria-pressed",
    String(Boolean(track?.favorite)),
  );
  $("#player-favorite").setAttribute(
    "aria-label",
    track?.favorite ? "Remover das favoritas" : "Adicionar às favoritas",
  );
  $("#player-favorite").title = track?.favorite
    ? "Remover das favoritas"
    : "Adicionar às favoritas";
  $("#shuffle").classList.toggle("is-active", state.shuffle);
  $("#shuffle").setAttribute("aria-pressed", String(state.shuffle));
  $("#shuffle").title = state.shuffle
    ? "Desativar ordem aleatória"
    : "Ativar ordem aleatória";
  $("#shuffle").setAttribute("aria-label", $("#shuffle").title);
  const repeatLabel = {
    off: "Repetição desativada",
    all: "Repetir fila",
    one: "Repetir esta música",
  }[state.repeat];
  $("#repeat").classList.toggle("is-active", state.repeat !== "off");
  $("#repeat").setAttribute("aria-pressed", String(state.repeat !== "off"));
  $("#repeat").setAttribute("aria-label", repeatLabel);
  $("#repeat").title = repeatLabel;
  $("#repeat-one").hidden = state.repeat !== "one";
  $("#mute").innerHTML = icon(
    state.muted || state.volume === 0 ? "muted" : "volume",
  );
  $("#mute").title = state.muted ? "Ativar som" : "Silenciar";
  $("#mute").setAttribute("aria-label", $("#mute").title);
  $("#volume").value = state.muted ? 0 : state.volume;
  $("#volume").setAttribute(
    "aria-valuetext",
    `${Math.round((state.muted ? 0 : state.volume) * 100)}%`,
  );
  rangeFill($("#volume"));
  updateTimeline();
  if ("mediaSession" in navigator)
    navigator.mediaSession.playbackState = track
      ? playing
        ? "playing"
        : "paused"
      : "none";
}

function updateTimeline() {
  const track = getTrack();
  const duration = Number.isFinite(audio.duration)
    ? audio.duration
    : track?.duration || 0;
  const position = audio.currentTime || 0;
  $("#elapsed").textContent = time(position);
  $("#duration").textContent = time(duration);
  $("#seek").max = duration || 100;
  $("#seek").value = position;
  $("#seek").setAttribute(
    "aria-valuetext",
    `${time(position)} de ${time(duration)}`,
  );
  rangeFill($("#seek"));
}

function renderQueue() {
  $("#queue-summary").textContent = state.queue.length
    ? countLabel(state.queue.length)
    : "Fila vazia";
  $("#queue-list").innerHTML = state.queue.length
    ? state.queue
        .map((id, index) => {
          const track = getTrack(id);
          if (!track) return "";
          return `<button class="queue-row${id === state.currentId ? " is-current" : ""}" data-queue-id="${id}" aria-label="Reproduzir ${escapeHTML(track.title)}"${id === state.currentId ? ' aria-current="true"' : ""}><span class="queue-index">${id === state.currentId ? icon("wave") : index + 1}</span><span class="track-copy"><strong>${escapeHTML(track.title)}</strong><span>${escapeHTML(track.artist)}</span></span><span class="track-duration">${track.duration ? time(track.duration) : "—"}</span></button>`;
        })
        .join("")
    : '<p class="queue-empty">Reproduza uma música para criar a fila.</p>';
}

function setView(view) {
  state.view = view;
  state.search = "";
  $("#search").value = "";
  if (view === "recent") {
    state.sort = "recent";
    $("#sort").value = "recent";
  }
  renderLibrary();
}

function shuffled(ids) {
  const result = [...ids];
  for (let index = result.length - 1; index > 0; index--) {
    const random = Math.floor(Math.random() * (index + 1));
    [result[index], result[random]] = [result[random], result[index]];
  }
  return result;
}

function makeQueue(ids, firstId) {
  state.queueSource = [...ids];
  state.queue = state.shuffle
    ? [firstId, ...shuffled(ids.filter((id) => id !== firstId))]
    : [...ids];
}

async function loadTrack(id, autoplay = false, resumeAt = 0) {
  const track = getTrack(id);
  if (!track) return;
  const version = ++loadVersion;
  audio.pause();
  if (currentURL?.startsWith("blob:")) URL.revokeObjectURL(currentURL);
  state.currentId = id;
  currentURL = track.url ? track.url : URL.createObjectURL(track.file);
  pendingSeek = { version, time: Math.max(0, resumeAt) };
  audio.src = currentURL;
  audio.load();
  if ("mediaSession" in navigator && "MediaMetadata" in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: "Minha coleção · onda",
    });
  }
  renderPlayer();
  renderLibrary();
  renderQueue();
  savePreferences();
  if (autoplay) await play(version);
}

async function play(version = loadVersion) {
  try {
    await audio.play();
  } catch (error) {
    if (version !== loadVersion || error.name === "AbortError") return;
    toast(
      error.name === "NotAllowedError"
        ? "Clique em reproduzir para permitir o áudio."
        : "Não foi possível tocar este arquivo. Tente outra música ou outro formato.",
      true,
    );
  }
}

async function togglePlay() {
  if (!getTrack()) {
    const tracks = viewTracks();
    if (!tracks.length) return;
    makeQueue(
      tracks.map((track) => track.id),
      tracks[0].id,
    );
    await loadTrack(tracks[0].id, true);
  } else if (audio.paused) {
    if (audio.ended) audio.currentTime = 0;
    await play();
  } else audio.pause();
}

async function playFromLibrary(id) {
  if (id === state.currentId) return togglePlay();
  makeQueue(
    viewTracks().map((track) => track.id),
    id,
  );
  await loadTrack(id, true);
}

async function stepTrack(direction, automatic = false) {
  if (!getTrack()) return;
  if (direction < 0 && audio.currentTime > 3) {
    audio.currentTime = 0;
    updateTimeline();
    return;
  }
  if (automatic && state.repeat === "one") {
    audio.currentTime = 0;
    await play();
    return;
  }
  const index = state.queue.indexOf(state.currentId);
  let nextIndex = index + direction;
  if (nextIndex >= state.queue.length) {
    if (state.repeat === "all") nextIndex = 0;
    else {
      if (!automatic)
        toast("Você chegou ao fim da fila. Ative a repetição para continuar.");
      return;
    }
  }
  if (nextIndex < 0)
    nextIndex = state.repeat === "all" ? state.queue.length - 1 : 0;
  const nextId = state.queue[nextIndex];
  if (nextId) await loadTrack(nextId, true);
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  if (state.currentId) {
    state.queue = state.shuffle
      ? [
          state.currentId,
          ...shuffled(state.queueSource.filter((id) => id !== state.currentId)),
        ]
      : [...state.queueSource];
  }
  renderPlayer();
  renderQueue();
  savePreferences();
}

async function toggleFavorite(id) {
  const track = getTrack(id);
  if (!track) return;
  const updated = { ...track, favorite: !track.favorite };
  try {
    await saveRecord("tracks", updated);
    Object.assign(track, updated);
    renderLibrary();
    renderPlayer();
  } catch (error) {
    storageError(error);
  }
}

function showDialog(id) {
  const dialog = $(id);
  if (!dialog.open) dialog.showModal();
}

function openPlaylistDialog(id = null, trackId = null) {
  editingPlaylistId = id;
  pendingPlaylistTrackId = trackId;
  const playlist = state.playlists.find((item) => item.id === id);
  $("#playlist-dialog-title").textContent = playlist
    ? "Editar playlist"
    : "Nova playlist";
  $("#playlist-name").value = playlist?.name || "";
  $("#playlist-name").setCustomValidity("");
  $("#delete-playlist").hidden = !playlist;
  $("#save-playlist").textContent = playlist ? "Salvar nome" : "Criar playlist";
  showDialog("#playlist-dialog");
  $("#playlist-name").focus();
}

async function submitPlaylist(event) {
  event.preventDefault();
  const name = $("#playlist-name").value.trim();
  if (!name) {
    $("#playlist-name").setCustomValidity("Dê um nome para a playlist.");
    $("#playlist-name").reportValidity();
    return;
  }
  const existing = state.playlists.find(
    (item) => item.id === editingPlaylistId,
  );
  const playlist = existing
    ? { ...existing, name }
    : {
        id: crypto.randomUUID(),
        name,
        trackIds: pendingPlaylistTrackId ? [pendingPlaylistTrackId] : [],
        createdAt: Date.now(),
      };
  $("#save-playlist").disabled = true;
  try {
    await saveRecord("playlists", playlist);
    if (existing) Object.assign(existing, playlist);
    else state.playlists.push(playlist);
    $("#playlist-dialog").close();
    setView(playlist.id);
    toast(existing ? "Playlist atualizada." : "Playlist criada.");
  } catch (error) {
    storageError(error);
  } finally {
    $("#save-playlist").disabled = false;
  }
}

function organizeTrack(id) {
  const track = getTrack(id);
  if (!track) return;
  organizingTrackId = id;
  $("#remove-track").hidden = Boolean(track.url);
  $("#file-note").hidden = !track.url;
  $("#track-dialog-title").textContent = track.title;
  $("#track-dialog-artist").textContent = track.artist;
  const available = state.playlists.filter(
    (playlist) => !playlist.trackIds.includes(id),
  );
  $("#add-to-playlist-controls").hidden = !available.length;
  $("#playlist-select").innerHTML = available
    .map(
      (playlist) =>
        `<option value="${playlist.id}">${escapeHTML(playlist.name)}</option>`,
    )
    .join("");
  $("#remove-from-playlist").hidden = !currentPlaylist();
  showDialog("#track-dialog");
}

async function addToPlaylist() {
  const playlist = state.playlists.find(
    (item) => item.id === $("#playlist-select").value,
  );
  const track = getTrack(organizingTrackId);
  if (!playlist || !track || playlist.trackIds.includes(track.id)) return;
  const updated = { ...playlist, trackIds: [...playlist.trackIds, track.id] };
  try {
    await saveRecord("playlists", updated);
    Object.assign(playlist, updated);
    $("#track-dialog").close();
    renderLibrary();
    toast(`Adicionada a “${playlist.name}”.`);
  } catch (error) {
    storageError(error);
  }
}

async function removeFromPlaylist() {
  const playlist = currentPlaylist();
  if (!playlist) return;
  const updated = {
    ...playlist,
    trackIds: playlist.trackIds.filter((id) => id !== organizingTrackId),
  };
  try {
    await saveRecord("playlists", updated);
    Object.assign(playlist, updated);
    $("#track-dialog").close();
    renderLibrary();
    toast("Música removida da playlist. Ela continua na sua biblioteca.");
  } catch (error) {
    storageError(error);
  }
}

function confirmAction(title, description, callback) {
  $("#confirm-title").textContent = title;
  $("#confirm-description").textContent = description;
  confirmationAction = callback;
  showDialog("#confirm-dialog");
}

function requestDeletePlaylist() {
  const playlist = state.playlists.find(
    (item) => item.id === editingPlaylistId,
  );
  if (!playlist) return;
  $("#playlist-dialog").close();
  confirmAction(
    "Excluir esta playlist?",
    `“${playlist.name}” será excluída. As músicas continuam na sua biblioteca.`,
    async () => {
      await deletePlaylist(playlist.id);
      state.playlists = state.playlists.filter(
        (item) => item.id !== playlist.id,
      );
      if (state.view === playlist.id) setView("library");
      else renderNavigation();
      toast("Playlist excluída.");
    },
  );
}

function requestRemoveTrack() {
  const track = getTrack(organizingTrackId);
  if (!track) return;
  $("#track-dialog").close();
  confirmAction(
    "Remover esta música?",
    `“${track.title}” será removida da biblioteca e das playlists. O arquivo original do computador não será alterado.`,
    async () => {
      const playlists = state.playlists.map((playlist) => ({
        ...playlist,
        trackIds: playlist.trackIds.filter((id) => id !== track.id),
      }));
      await deleteTrack(track.id, playlists);
      const oldIndex = state.queue.indexOf(track.id);
      const wasPlaying = !audio.paused;
      state.tracks = state.tracks.filter((item) => item.id !== track.id);
      state.playlists = playlists;
      state.queue = state.queue.filter((id) => id !== track.id);
      state.queueSource = state.queueSource.filter((id) => id !== track.id);
      if (state.currentId === track.id) {
        if (state.queue.length)
          await loadTrack(
            state.queue[
              Math.min(Math.max(oldIndex, 0), state.queue.length - 1)
            ],
            wasPlaying,
          );
        else {
          ++loadVersion;
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
          URL.revokeObjectURL(currentURL);
          currentURL = null;
          state.currentId = null;
          pendingSeek = null;
          if ("mediaSession" in navigator)
            navigator.mediaSession.metadata = null;
        }
      }
      renderLibrary();
      renderPlayer();
      renderQueue();
      savePreferences();
      toast("Música removida da biblioteca.");
    },
  );
}

function bindEvents() {
  for (const button of document.querySelectorAll("[data-view]"))
    button.addEventListener("click", () => setView(button.dataset.view));
  $(".brand").addEventListener("click", (event) => {
    event.preventDefault();
    setView("library");
  });
  $("#playlist-nav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-playlist-view]");
    if (button) setView(button.dataset.playlistView);
  });
  $("#new-playlist").addEventListener("click", () => openPlaylistDialog());
  $("#edit-playlist").addEventListener("click", () =>
    openPlaylistDialog(currentPlaylist()?.id),
  );
  $("#playlist-form").addEventListener("submit", submitPlaylist);
  $("#playlist-name").addEventListener("input", () =>
    $("#playlist-name").setCustomValidity(""),
  );
  $("#delete-playlist").addEventListener("click", requestDeletePlaylist);
  $("#search").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderLibrary();
  });
  $("#sort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderLibrary();
  });
  $("#track-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    const id = button?.closest("[data-track]")?.dataset.track;
    if (!id) return;
    if (button.dataset.action === "play") void playFromLibrary(id);
    else if (button.dataset.action === "favorite") void toggleFavorite(id);
    else organizeTrack(id);
  });
  $("#play-all").addEventListener("click", async () => {
    const ids = viewTracks().map((track) => track.id);
    if (!ids.length) return;
    const firstId = state.shuffle
      ? ids[Math.floor(Math.random() * ids.length)]
      : ids[0];
    makeQueue(ids, firstId);
    await loadTrack(firstId, true);
  });
  $("#shuffle-all").addEventListener("click", async () => {
    const ids = viewTracks().map((track) => track.id);
    if (!ids.length) return;
    state.shuffle = true;
    const firstId = ids[Math.floor(Math.random() * ids.length)];
    makeQueue(ids, firstId);
    await loadTrack(firstId, true);
  });
  $("#play-pause").addEventListener("click", togglePlay);
  $("#next").addEventListener("click", () => void stepTrack(1));
  $("#previous").addEventListener("click", () => void stepTrack(-1));
  $("#shuffle").addEventListener("click", toggleShuffle);
  $("#repeat").addEventListener("click", () => {
    state.repeat = { off: "all", all: "one", one: "off" }[state.repeat];
    renderPlayer();
    savePreferences();
  });
  $("#player-favorite").addEventListener(
    "click",
    () => void toggleFavorite(state.currentId),
  );
  $("#seek").addEventListener("input", (event) => {
    if (Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(audio.duration, Number(event.target.value));
      updateTimeline();
    }
  });
  $("#seek").addEventListener("change", savePreferences);
  $("#volume").addEventListener("input", (event) => {
    state.volume = Number(event.target.value);
    state.muted = false;
    audio.volume = state.volume;
    audio.muted = false;
    renderPlayer();
    savePreferences();
  });
  $("#mute").addEventListener("click", () => {
    state.muted = !state.muted;
    if (!state.muted && !state.volume) state.volume = 0.7;
    audio.muted = state.muted;
    audio.volume = state.volume;
    renderPlayer();
    savePreferences();
  });
  $("#open-queue").addEventListener("click", () => {
    renderQueue();
    showDialog("#queue-dialog");
  });
  $("#queue-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-queue-id]");
    if (button) void loadTrack(button.dataset.queueId, true);
  });
  $("#add-to-playlist").addEventListener("click", addToPlaylist);
  $("#remove-from-playlist").addEventListener("click", removeFromPlaylist);
  $("#remove-track").addEventListener("click", requestRemoveTrack);
  $("#create-playlist-for-track").addEventListener("click", () => {
    $("#track-dialog").close();
    openPlaylistDialog(null, organizingTrackId);
  });
  $("#cancel-confirm").addEventListener("click", () =>
    $("#confirm-dialog").close(),
  );
  $("#accept-confirm").addEventListener("click", async () => {
    const action = confirmationAction;
    if (!action) return;
    $("#accept-confirm").disabled = true;
    try {
      await action();
      $("#confirm-dialog").close();
    } catch (error) {
      storageError(error);
    } finally {
      $("#accept-confirm").disabled = false;
    }
  });
  $("#confirm-dialog").addEventListener("close", () => {
    confirmationAction = null;
  });
  for (const button of document.querySelectorAll("[data-close]"))
    button.addEventListener("click", () => button.closest("dialog").close());
  for (const dialog of document.querySelectorAll("dialog")) {
    // A backdrop click closes the modal; clicks in its padding stay inside.
    dialog.addEventListener("click", (event) => {
      const bounds = dialog.getBoundingClientRect();
      if (
        event.target === dialog &&
        (event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom)
      )
        dialog.close();
    });
  }
  document.addEventListener("dragover", (event) => {
    if (Array.from(event.dataTransfer?.types || []).includes("Files"))
      event.preventDefault();
  });
  document.addEventListener("drop", (event) => {
    if (Array.from(event.dataTransfer?.types || []).includes("Files")) {
      event.preventDefault();
      toast("Coloque os arquivos na pasta de músicas e atualize a biblioteca.");
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.target.closest('input,select,textarea,[contenteditable="true"]') ||
      document.querySelector("dialog[open]")
    )
      return;
    if (event.code === "Space" && !event.target.closest("button,a")) {
      event.preventDefault();
      void togglePlay();
    } else if (event.key === "/") {
      event.preventDefault();
      $("#search").focus();
    } else if (event.key.toLowerCase() === "m" && !event.altKey) {
      event.preventDefault();
      $("#mute").click();
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const direction = event.key === "ArrowRight" ? 1 : -1;
      if (event.altKey) {
        event.preventDefault();
        void stepTrack(direction);
      } else if (getTrack() && Number.isFinite(audio.duration)) {
        event.preventDefault();
        audio.currentTime = Math.min(
          audio.duration,
          Math.max(0, audio.currentTime + direction * 5),
        );
        updateTimeline();
      }
    }
  });
  audio.addEventListener("loadedmetadata", () => {
    const track = getTrack();
    if (track?.url && Number.isFinite(audio.duration)) {
      track.duration = audio.duration;
      void saveRecord("tracks", track).catch(storageError);
      renderLibrary();
    }
    if (pendingSeek?.version === loadVersion) {
      audio.currentTime = Math.min(
        pendingSeek.time,
        Math.max(0, audio.duration - 0.1),
      );
      pendingSeek = null;
    }
    renderPlayer();
  });
  audio.addEventListener("timeupdate", () => {
    updateTimeline();
    if (Date.now() - lastSavedTime > 5000) {
      savePreferences();
      lastSavedTime = Date.now();
    }
  });
  for (const event of ["play", "pause"])
    audio.addEventListener(event, () => {
      renderPlayer();
      renderLibrary();
      savePreferences();
    });
  audio.addEventListener("ended", () => void stepTrack(1, true));
  audio.addEventListener("error", () => {
    if (audio.getAttribute("src") && getTrack())
      toast(
        "Este arquivo não pôde ser reproduzido. Tente outro formato.",
        true,
      );
  });
  window.addEventListener("pagehide", savePreferences);
  if ("mediaSession" in navigator) {
    const handlers = {
      play: () => void play(),
      pause: () => audio.pause(),
      previoustrack: () => void stepTrack(-1),
      nexttrack: () => void stepTrack(1),
      seekto: (details) => {
        if (Number.isFinite(audio.duration))
          audio.currentTime = Math.min(
            audio.duration,
            Math.max(0, details.seekTime),
          );
      },
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* Media Session action support varies by browser. */
      }
    }
  }
}

async function initialize() {
  $("#collection-summary").textContent = "Carregando biblioteca…";
  $("#empty-state").hidden = true;
  $("#choose-library").disabled = true;
  const preferences = readPreferences();
  audio.volume = state.volume;
  audio.muted = state.muted;
  bindEvents();
  bindFolderLibrary();
  renderPlayer();
  try {
    await openDatabase();
    [state.tracks, state.playlists] = await Promise.all([
      readAll("tracks"),
      readAll("playlists"),
    ]);
    if (location.protocol === "onda:") await synchronizeLibrary();
    state.databaseReady = true;
    state.queueSource = Array.isArray(preferences.queueSource)
      ? [...new Set(preferences.queueSource.filter((id) => getTrack(id)))]
      : [];
    state.queue = Array.isArray(preferences.queue)
      ? [...new Set(preferences.queue.filter((id) => getTrack(id)))]
      : [];
    if (getTrack(preferences.currentId)) {
      if (!state.queue.includes(preferences.currentId))
        state.queue.push(preferences.currentId);
      if (!state.queueSource.includes(preferences.currentId))
        state.queueSource.push(preferences.currentId);
      await loadTrack(
        preferences.currentId,
        false,
        Number(preferences.currentTime) || 0,
      );
    }
  } catch (error) {
    $("#storage-error").hidden = false;
    storageError(error);
  }
  renderLibrary();
  renderPlayer();
  $("#choose-library").disabled = false;
  if (location.protocol === "onda:") {
    const timer = setInterval(async () => {
      if (libraryBusy) return;
      try {
        const result = await fetch("onda://app/library-state.json", {
          cache: "no-store",
        });
        const value = await result.json();
        if (value.revision !== knownLibraryRevision) await synchronizeLibrary();
      } catch {
        /* A manual refresh can retry. */
      }
    }, 4000);
    window.addEventListener("pagehide", () => clearInterval(timer), {
      once: true,
    });
  }
}

let libraryBusy = false;
let knownLibraryRevision = -1;
let currentLibraryFolder = null;
async function synchronizeLibrary(data) {
  if (!data) {
    const response = await fetch("onda://app/library.json", {
      cache: "no-store",
    });
    if (!response.ok) throw Error("Não foi possível carregar a biblioteca.");
    data = await response.json();
  }
  const stored = await readAll("tracks");
  const saved = new Map(stored.map((track) => [track.id, track]));
  state.tracks = [
    ...stored.filter((track) => !track.embedded && !track.external),
    ...data.tracks.map((track) => ({
      ...track,
      favorite: Boolean(saved.get(track.id)?.favorite),
      duration: saved.get(track.id)?.duration || 0,
    })),
  ];
  knownLibraryRevision = data.revision;
  if (currentLibraryFolder !== data.folder) {
    currentLibraryFolder = data.folder;
    state.view = "library";
    state.search = "";
    $("#search").value = "";
  }
  $("#library-folder").textContent = data.folder || "Nenhuma pasta escolhida.";
  if (data.error) toast(data.error, true);
  state.queue = state.queue.filter((id) => getTrack(id));
  state.queueSource = state.queueSource.filter((id) => getTrack(id));
  if (state.currentId && !getTrack()) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (currentURL?.startsWith("blob:")) URL.revokeObjectURL(currentURL);
    currentURL = null;
    state.currentId = null;
    pendingSeek = null;
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
    savePreferences();
  }
  renderLibrary();
  renderPlayer();
  renderQueue();
}
async function changeFolderLibrary(action) {
  if (location.protocol !== "onda:")
    return toast("Escolha a pasta usando o aplicativo desktop.", true);
  if (libraryBusy) return;
  libraryBusy = true;
  $("#collection-summary").textContent = "Carregando biblioteca…";
  const buttons = [
    "#choose-library",
    "#empty-library",
    "#choose-library-settings",
    "#refresh-library",
  ];
  buttons.forEach((id) => ($(id).disabled = true));
  try {
    const response = await fetch("onda://app/" + action, {
      method: "POST",
      headers: { "X-Onda-Library": "1" },
    });
    if (!response.ok) {
      const error = response.headers
        .get("content-type")
        ?.includes("application/json")
        ? await response.json()
        : {};
      throw Error(error.error || "Não foi possível atualizar a pasta.");
    }
    const data = await response.json();
    if (!data.cancelled) await synchronizeLibrary(data);
  } catch (error) {
    toast(error.message, true);
  } finally {
    libraryBusy = false;
    buttons.forEach((id) => ($(id).disabled = false));
    renderLibrary();
  }
}
function bindFolderLibrary() {
  for (const id of [
    "#choose-library",
    "#empty-library",
    "#choose-library-settings",
  ])
    $(id).addEventListener(
      "click",
      () => void changeFolderLibrary("choose-library"),
    );
  $("#refresh-library").addEventListener(
    "click",
    () => void changeFolderLibrary("refresh-library"),
  );
}

void initialize();
