import {
  openDatabase,
  readAll,
  saveRecord,
  deletePlaylist,
  deleteTrack,
} from "./storage.js";

const $ = (selector) => document.querySelector(selector);
const audio = $("#audio");
const collator = new Intl.Collator("pt-BR", {
  sensitivity: "base",
  numeric: true,
});
const PREFERENCES_KEY = "onda:preferences:v1";
const AUDIO_EXTENSION = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|aif|aiff|webm)$/i;
const covers = [
  ["#e9bd9c", "#82523e"],
  ["#bfcdb2", "#516447"],
  ["#c9c8dc", "#696382"],
  ["#dcbdad", "#8b5d4f"],
  ["#b6cecc", "#4c7371"],
  ["#e0d29f", "#81733e"],
];
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
  importing: false,
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
let dragDepth = 0;
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

function coverStyle(seed) {
  let hash = 0;
  for (const char of seed) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  const [background, foreground] = covers[Math.abs(hash) % covers.length];
  return `--cover-bg:${background};--cover-ink:${foreground}`;
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
      ? "O armazenamento está cheio. Libere espaço no navegador antes de importar mais músicas."
      : "Não foi possível salvar. Verifique se o navegador permite armazenamento local.",
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
  // "Adicionadas agora" is the full collection ordered by import date.
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
  $("#playlist-nav").innerHTML = state.playlists
    .map(
      (playlist) => `
    <button class="nav-item${state.view === playlist.id ? " active" : ""}" data-playlist-view="${playlist.id}"${state.view === playlist.id ? ' aria-current="page"' : ""} title="${escapeHTML(playlist.name)}">
      <span class="playlist-color" style="${coverStyle(playlist.id)}">${icon("music")}</span>
      <span>${escapeHTML(playlist.name)}</span>
    </button>`,
    )
    .join("");
}

function renderLibrary() {
  const playlist = currentPlaylist();
  const titles = {
    library: "Biblioteca",
    favorites: "Favoritas",
    recent: "Adicionadas agora",
  };
  const title = playlist?.name || titles[state.view] || "Biblioteca";
  const tracks = viewTracks();
  const allViewTracks = viewTracks(false);
  $("#view-title").innerHTML =
    `${escapeHTML(title)} <span class="count-pill">${tracks.length}</span>`;
  $("#breadcrumb-view").textContent = playlist ? "Playlists" : title;
  $("#view-eyebrow").textContent = playlist
    ? "UMA TRILHA SONORA SÓ SUA"
    : state.view === "favorites"
      ? "PARA OUVIR DE NOVO. E DE NOVO."
      : state.view === "recent"
        ? "OS ÚLTIMOS SONS QUE CHEGARAM"
        : "SEUS SONS, TODOS AQUI";
  $("#collection-summary").textContent = allViewTracks.length
    ? `${countLabel(allViewTracks.length)} · ${totalTime(allViewTracks)} de boa companhia`
    : playlist
      ? "Toda boa playlist começa com uma escolha."
      : state.view === "favorites"
        ? "Guarde aqui as músicas que ficam com você."
        : "O próximo play começa com você.";
  $("#edit-playlist").hidden = !playlist;
  $("#play-all").disabled = !tracks.length;
  $("#shuffle-all").disabled = !tracks.length;
  $("#library-total").textContent = state.tracks.length
    ? `${countLabel(state.tracks.length)} na sua coleção`
    : "Sua trilha sonora começa aqui.";

  $("#track-list").innerHTML = tracks
    .map((track, index) => {
      const isCurrent = track.id === state.currentId;
      const isPlaying = isCurrent && !audio.paused;
      return `<div class="track-row${isCurrent ? " is-current" : ""}" data-track="${track.id}">
      <div class="row-number"><span>${String(index + 1).padStart(2, "0")}</span><button class="icon-button" data-action="play" aria-label="${isPlaying ? "Pausar" : "Reproduzir"} ${escapeHTML(track.title)}">${icon(isPlaying ? "pause" : "play")}</button></div>
      <button class="track-details" data-action="play" aria-label="${isPlaying ? "Pausar" : "Reproduzir"} ${escapeHTML(track.title)} de ${escapeHTML(track.artist)}">
        <span class="track-art" style="${coverStyle(track.title)}">${icon("music")}</span><span class="track-copy"><strong title="${escapeHTML(track.title)}">${escapeHTML(track.title)}</strong><span>${escapeHTML(track.artist)}</span></span>
      </button><span class="track-format">${escapeHTML(track.format)}</span><span class="track-duration">${time(track.duration)}</span>
      <div class="track-actions"><button class="icon-button favorite-button${track.favorite ? " is-favorite" : ""}" data-action="favorite" aria-label="${track.favorite ? "Remover" : "Adicionar"} ${escapeHTML(track.title)} ${track.favorite ? "das" : "às"} favoritas" aria-pressed="${track.favorite}" title="${track.favorite ? "Remover das favoritas" : "Adicionar às favoritas"}">${icon("heart")}</button><button class="icon-button" data-action="organize" aria-label="Organizar ${escapeHTML(track.title)}" title="Organizar música">${icon("more")}</button></div>
    </div>`;
    })
    .join("");

  $("#empty-state").hidden = tracks.length > 0;
  const filtered = Boolean(state.search.trim()) && !tracks.length;
  $("#empty-title").textContent = filtered
    ? "Esse som ainda não está por aqui."
    : playlist
      ? "Um novo momento. Uma nova playlist."
      : state.view === "favorites"
        ? "Tem música que merece um coração."
        : "Toda coleção tem uma primeira música.";
  $("#empty-description").textContent = filtered
    ? "Tente outro nome de música ou artista."
    : playlist
      ? "Importe suas músicas ou use o menu de uma faixa da biblioteca para adicionar a esta playlist."
      : state.view === "favorites"
        ? "Toque no coração ao lado de uma faixa para guardar suas favoritas aqui."
        : "Arraste seus arquivos para cá e deixe o resto com a gente. Suas músicas ficam salvas só neste navegador.";
  $("#empty-import").hidden = filtered || state.view === "favorites";
  $("#empty-formats").hidden = filtered || state.view === "favorites";
  renderNavigation();
}

function renderPlayer() {
  const track = getTrack();
  $("#now-title").textContent =
    track?.title || "Pronto para o seu primeiro play?";
  $("#now-title").title = track?.title || "";
  $("#now-artist").textContent =
    track?.artist || "Adicione uma música para começar";
  $("#player-art").style.cssText = track ? coverStyle(track.title) : "";
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
    ? `${countLabel(state.queue.length)} para acompanhar seu momento.`
    : "Escolha uma música para começar.";
  $("#queue-list").innerHTML = state.queue.length
    ? state.queue
        .map((id, index) => {
          const track = getTrack(id);
          if (!track) return "";
          return `<button class="queue-row${id === state.currentId ? " is-current" : ""}" data-queue-id="${id}" aria-label="Reproduzir ${escapeHTML(track.title)}"${id === state.currentId ? ' aria-current="true"' : ""}><span class="queue-index">${id === state.currentId ? icon("wave") : index + 1}</span><span class="track-art" style="${coverStyle(track.title)}">${icon("music")}</span><span class="track-copy"><strong>${escapeHTML(track.title)}</strong><span>${escapeHTML(track.artist)}</span></span><span class="track-duration">${time(track.duration)}</span></button>`;
        })
        .join("")
    : '<p class="queue-empty">A fila ainda está em silêncio. Dê play em uma música da sua biblioteca.</p>';
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
  if (currentURL) URL.revokeObjectURL(currentURL);
  state.currentId = id;
  currentURL = URL.createObjectURL(track.file);
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
    ? "Um novo nome, o mesmo ritmo."
    : "Uma playlist, um momento.";
  $("#playlist-dialog-description").textContent = playlist
    ? "Deixe esta playlist com a sua cara."
    : "Dê um nome para a sua próxima trilha sonora.";
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
    toast(
      existing
        ? "Playlist atualizada."
        : "Playlist criada. Seu novo momento já tem nome.",
    );
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

// Native metadata loading also verifies that this browser can open the file.
// Keep the URL short-lived; only the actively selected song has a retained URL.
function inspectAudio(file) {
  return new Promise((resolve, reject) => {
    const probe = document.createElement("audio");
    const url = URL.createObjectURL(file);
    let timer;
    const finish = (error) => {
      clearTimeout(timer);
      const duration = probe.duration;
      probe.onloadedmetadata = null;
      probe.onerror = null;
      probe.removeAttribute("src");
      probe.load();
      URL.revokeObjectURL(url);
      if (error || !Number.isFinite(duration) || duration <= 0)
        reject(error || new Error("Áudio inválido."));
      else resolve(duration);
    };
    probe.preload = "metadata";
    probe.onloadedmetadata = () => finish();
    probe.onerror = () =>
      finish(new Error("Formato não suportado ou arquivo corrompido."));
    timer = setTimeout(
      () => finish(new Error("Não foi possível ler o áudio.")),
      12000,
    );
    probe.src = url;
  });
}

function filenameMetadata(file) {
  const basename = file.name
    .replace(/\.[^.]+$/, "")
    .replace(/_/g, " ")
    .trim();
  const parts = basename.split(/\s+[-–—]\s+/);
  return parts.length > 1
    ? {
        artist: parts.shift().trim() || "Artista desconhecido",
        title: parts.join(" - ").trim() || basename,
      }
    : { title: basename || file.name, artist: "Arquivo local" };
}

async function importFiles(fileList) {
  if (state.importing)
    return toast("Uma importação já está em andamento. Aguarde um instante.");
  if (!state.databaseReady)
    return toast(
      "O armazenamento local não está disponível para importar músicas.",
      true,
    );
  const files = Array.from(fileList);
  if (!files.length) return;
  const destinationId = currentPlaylist()?.id;
  state.importing = true;
  showDialog("#import-dialog");
  $("#import-progress").hidden = false;
  $("#choose-files").disabled = true;
  $("#choose-folder").disabled = true;
  const known = new Map(
    state.tracks.map((track) => [track.fingerprint, track.id]),
  );
  const acceptedIds = new Set();
  let imported = 0;
  let duplicates = 0;
  let unsupported = 0;
  let failedToSave = false;
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      $("#import-progress").textContent =
        `Importando ${index + 1} de ${files.length}: ${file.name}`;
      if (!file.type.startsWith("audio/") && !AUDIO_EXTENSION.test(file.name)) {
        unsupported++;
        continue;
      }
      const fingerprint = JSON.stringify([
        file.name,
        file.size,
        file.lastModified,
      ]);
      if (known.has(fingerprint)) {
        duplicates++;
        acceptedIds.add(known.get(fingerprint));
        continue;
      }
      let duration;
      try {
        duration = await inspectAudio(file);
      } catch {
        unsupported++;
        continue;
      }
      const track = {
        id: crypto.randomUUID(),
        ...filenameMetadata(file),
        name: file.name,
        fingerprint,
        file,
        duration,
        format: file.name.split(".").pop().toLowerCase(),
        favorite: false,
        importedAt: Date.now(),
      };
      try {
        await saveRecord("tracks", track);
      } catch (error) {
        storageError(error);
        failedToSave = true;
        break;
      }
      state.tracks.push(track);
      known.set(fingerprint, track.id);
      acceptedIds.add(track.id);
      imported++;
    }
    const destination = state.playlists.find(
      (playlist) => playlist.id === destinationId,
    );
    if (destination && acceptedIds.size) {
      const updated = {
        ...destination,
        trackIds: [...new Set([...destination.trackIds, ...acceptedIds])],
      };
      try {
        await saveRecord("playlists", updated);
        Object.assign(destination, updated);
      } catch (error) {
        storageError(error);
        failedToSave = true;
      }
    }
    renderLibrary();
    if (!state.currentId && state.tracks.length) {
      const ids = viewTracks(false).map((track) => track.id);
      const firstId = ids[0] || state.tracks[0].id;
      makeQueue(
        ids.length ? ids : state.tracks.map((track) => track.id),
        firstId,
      );
      await loadTrack(firstId);
    }
    const summary = [
      imported
        ? `${countLabel(imported)} ${imported === 1 ? "adicionada" : "adicionadas"}`
        : "",
      duplicates
        ? `${duplicates} ${duplicates === 1 ? "arquivo já estava" : "arquivos já estavam"} na coleção`
        : "",
      unsupported
        ? `${unsupported} ${unsupported === 1 ? "arquivo incompatível" : "arquivos incompatíveis"}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    $("#import-progress").textContent = summary || "Nenhuma música adicionada.";
    if (!failedToSave) {
      toast(summary || "Nenhuma música adicionada.", !imported && !duplicates);
      if (imported || (destination && acceptedIds.size))
        $("#import-dialog").close();
    }
  } finally {
    state.importing = false;
    $("#choose-files").disabled = false;
    $("#choose-folder").disabled = false;
    $("#file-input").value = "";
    $("#folder-input").value = "";
  }
}

async function readDroppedEntry(entry) {
  if (entry.isFile)
    return new Promise((resolve, reject) =>
      entry.file((file) => resolve([file]), reject),
    );
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const result = [];
  // Chromium returns directory entries in batches, often of 100 files.
  while (true) {
    const batch = await new Promise((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (!batch.length) break;
    for (const child of batch) result.push(...(await readDroppedEntry(child)));
  }
  return result;
}

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
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
  for (const id of ["#hero-import", "#open-import", "#empty-import"])
    $(id).addEventListener("click", () => showDialog("#import-dialog"));
  $("#choose-files").addEventListener("click", () => $("#file-input").click());
  $("#choose-folder").addEventListener("click", () =>
    $("#folder-input").click(),
  );
  $("#file-input").addEventListener(
    "change",
    (event) => void importFiles(event.target.files),
  );
  $("#folder-input").addEventListener(
    "change",
    (event) => void importFiles(event.target.files),
  );
  for (const id of ["#new-playlist", "#create-playlist"])
    $(id).addEventListener("click", () => openPlaylistDialog());
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
  $("#keyboard-help").addEventListener("click", () =>
    showDialog("#help-dialog"),
  );
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
  document.addEventListener("dragenter", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth++;
    $("#drop-overlay").hidden = false;
  });
  document.addEventListener("dragover", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  document.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $("#drop-overlay").hidden = true;
  });
  window.addEventListener("blur", () => {
    dragDepth = 0;
    $("#drop-overlay").hidden = true;
  });
  document.addEventListener("drop", async (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth = 0;
    $("#drop-overlay").hidden = true;
    // Capture entries synchronously; DataTransfer is protected after this event.
    const items = Array.from(event.dataTransfer.items || []);
    const entries = items
      .filter((item) => item.kind === "file")
      .map((item) => item.webkitGetAsEntry?.())
      .filter(Boolean);
    const fallbackFiles = Array.from(event.dataTransfer.files);
    try {
      const files = entries.length
        ? (await Promise.all(entries.map(readDroppedEntry))).flat()
        : fallbackFiles;
      await importFiles(files);
    } catch {
      toast(
        "Não foi possível ler a pasta. Tente usar “Importar uma pasta inteira”.",
        true,
      );
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
  const preferences = readPreferences();
  audio.volume = state.volume;
  audio.muted = state.muted;
  bindEvents();
  renderPlayer();
  try {
    await openDatabase();
    [state.tracks, state.playlists] = await Promise.all([
      readAll("tracks"),
      readAll("playlists"),
    ]);
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
}

void initialize();
