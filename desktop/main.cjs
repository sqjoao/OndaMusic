const {
  app,
  BrowserWindow,
  protocol,
  net,
  session,
  shell,
  dialog,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const {
  readdir,
  stat,
  readFile,
  writeFile,
  mkdir,
} = require("node:fs/promises");
const { createHash } = require("node:crypto");
const { Readable } = require("node:stream");

const audioTypes = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".opus": "audio/ogg",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".webm": "audio/webm",
};
let libraryFiles = new Map();
let catalog = [];
let selectedFolder = null;
let libraryRevision = 0;
let libraryError = null;
let libraryReady = Promise.resolve(true);
let scanNumber = 0;
let folderWatcher;
let refreshTimer;
let choosingFolder = false;

function libraryState() {
  return {
    folder: selectedFolder,
    revision: libraryRevision,
    error: libraryError,
  };
}
function librarySettingsPath() {
  return path.join(app.getPath("userData"), "music-folder.json");
}
async function waitForLibrary() {
  let pending;
  do {
    pending = libraryReady;
    await pending;
  } while (pending !== libraryReady);
}
function refreshLibrary() {
  const number = ++scanNumber;
  libraryReady = scanMusic(selectedFolder).then(
    (result) => {
      if (number !== scanNumber) return false;
      libraryFiles = result.files;
      catalog = result.tracks;
      libraryError = null;
      libraryRevision++;
      return true;
    },
    () => {
      if (number !== scanNumber) return false;
      libraryFiles = new Map();
      catalog = [];
      libraryError =
        "Não foi possível ler a pasta. Verifique se ela está disponível ou escolha outra.";
      libraryRevision++;
      return false;
    },
  );
  return libraryReady;
}
function watchFolder() {
  folderWatcher?.close();
  clearTimeout(refreshTimer);
  if (!selectedFolder) return;
  try {
    const watcher = fs.watch(
      selectedFolder,
      { recursive: true },
      (eventType) => {
        // Add/remove/rename events update the list. Continuous download writes
        // must not repeatedly rescan the entire collection.
        if (eventType !== "rename") return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          void refreshLibrary();
        }, 1000);
      },
    );
    folderWatcher = watcher;
    watcher.on("error", () => watcher.close());
  } catch {
    /* Manual refresh remains available on network drives. */
  }
}
async function initializeLibrary() {
  try {
    const saved = JSON.parse(await readFile(librarySettingsPath(), "utf8"));
    if (typeof saved.folder === "string" && path.isAbsolute(saved.folder))
      selectedFolder = saved.folder;
  } catch {
    /* First launch has no selected folder. */
  }
  await refreshLibrary();
  watchFolder();
}

async function scanMusic(root) {
  const nextCatalog = [];
  const nextFiles = new Map();
  if (!root) return { tracks: nextCatalog, files: nextFiles };
  let visited = 0;
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT" && directory !== root) return;
      throw error;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      // Let window creation and painting proceed while a large library is read.
      if (++visited % 250 === 0) await new Promise(setImmediate);
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(file);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!entry.isFile() || !audioTypes[extension]) continue;
      const relative = path.relative(root, file).split(path.sep).join("/");
      const id = createHash("sha256")
        .update(root + "\0" + relative)
        .digest("hex");
      const urlPath = "/music/" + id;
      const parts = path
        .basename(entry.name, path.extname(entry.name))
        .replace(/_/g, " ")
        .split(/\s+[-–—]\s+/);
      const artist = parts.length > 1 ? parts.shift() : "Arquivo local";
      nextCatalog.push({
        id: "folder:" + id,
        name: entry.name,
        title: parts.join(" - "),
        artist,
        format: extension.slice(1),
        duration: 0,
        external: true,
        url: "onda://app" + urlPath,
        importedAt: 0,
        favorite: false,
      });
      nextFiles.set(urlPath, { file, type: audioTypes[extension] });
    }
  }
  await walk(root);
  return { tracks: nextCatalog, files: nextFiles };
}

async function serveMusic(request, item) {
  const size = (await stat(item.file)).size;
  let start = 0,
    end = size - 1;
  const headers = { "Content-Type": item.type, "Accept-Ranges": "bytes" };
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= size
    )
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(Math.max(0, end - start + 1));
  if (request.method === "HEAD" || !size)
    return new Response(null, { status: range ? 206 : 200, headers });
  return new Response(
    Readable.toWeb(fs.createReadStream(item.file, { start, end }), {
      strategy: { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength },
    }),
    { status: range ? 206 : 200, headers },
  );
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "onda",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
app.setName("Onda");
app.setPath("userData", path.join(app.getPath("appData"), "Onda"));
let window;
const files = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/app.js", "app.js"],
]);

// NSIS can retain shortcuts during an upgrade, including their old description.
// Update only existing Onda links that point to this installed executable.
function refreshOwnShortcuts() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const shortcuts = [
    path.join(app.getPath("desktop"), "Onda.lnk"),
    path.join(
      app.getPath("appData"),
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Onda.lnk",
    ),
  ];
  for (const shortcutPath of shortcuts) {
    try {
      const shortcut = shell.readShortcutLink(shortcutPath);
      if (
        path.resolve(shortcut.target).toLowerCase() !==
        path.resolve(process.execPath).toLowerCase()
      )
        continue;
      shell.writeShortcutLink(shortcutPath, "update", {
        description: app.getName(),
        icon: process.execPath,
        iconIndex: 0,
      });
    } catch {
      // Keep shortcuts the user removed absent, and leave other links untouched.
    }
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(async () => {
    // Folder discovery must not delay the first window.
    libraryReady = initializeLibrary();
    protocol.handle("onda", async (request) => {
      const url = new URL(request.url);
      if (url.hostname !== "app")
        return new Response("Not found", { status: 404 });
      if (request.method === "POST") {
        const origin = request.headers.get("origin");
        // Origin may be omitted for same-origin custom-protocol requests.
        // The non-safelisted header requires CORS preflight from other origins,
        // which this local protocol never approves.
        if (
          request.headers.get("x-onda-library") !== "1" ||
          (origin && origin !== "onda://app")
        )
          return new Response("Forbidden", { status: 403 });
        if (url.pathname === "/choose-library") {
          if (choosingFolder)
            return new Response("Folder dialog already open", { status: 409 });
          choosingFolder = true;
          try {
            const result = await dialog.showOpenDialog(window, {
              title: "Escolher pasta de músicas",
              properties: ["openDirectory"],
            });
            if (result.canceled || !result.filePaths[0])
              return Response.json({ cancelled: true });
            await mkdir(app.getPath("userData"), { recursive: true });
            await writeFile(
              librarySettingsPath(),
              JSON.stringify({ folder: result.filePaths[0] }),
              "utf8",
            );
            folderWatcher?.close();
            clearTimeout(refreshTimer);
            selectedFolder = result.filePaths[0];
            await refreshLibrary();
            await waitForLibrary();
            watchFolder();
          } catch {
            return Response.json(
              { error: "Não foi possível salvar a pasta escolhida." },
              { status: 500 },
            );
          } finally {
            choosingFolder = false;
          }
          return Response.json({ ...libraryState(), tracks: catalog });
        }
        if (url.pathname === "/refresh-library") {
          await refreshLibrary();
          await waitForLibrary();
          watchFolder();
          return Response.json({ ...libraryState(), tracks: catalog });
        }
        return new Response("Not found", { status: 404 });
      }
      if (!["GET", "HEAD"].includes(request.method))
        return new Response("Not found", { status: 404 });
      if (url.pathname === "/library-state.json")
        return Response.json(libraryState());
      if (url.pathname === "/library.json") {
        await waitForLibrary();
        return Response.json({ ...libraryState(), tracks: catalog });
      }
      if (url.pathname.startsWith("/music/")) await waitForLibrary();
      if (libraryFiles.has(url.pathname)) {
        try {
          return await serveMusic(request, libraryFiles.get(url.pathname));
        } catch {
          return new Response("Audio unavailable", { status: 404 });
        }
      }
      const file = files.get(url.pathname);
      if (
        url.hostname !== "app" ||
        !file ||
        !["GET", "HEAD"].includes(request.method)
      )
        return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(path.join(app.getAppPath(), file)).href);
    });
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'",
          ],
        },
      }),
    );
    window = new BrowserWindow({
      icon: path.join(__dirname, "icon.ico"),
      width: 1280,
      height: 850,
      minWidth: 760,
      minHeight: 560,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#19191c",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    window.removeMenu();
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.once("ready-to-show", () => {
      window.show();
      setImmediate(refreshOwnShortcuts);
    });
    window.loadURL("onda://app/index.html");
    app.on("activate", () => {
      if (window && !window.isDestroyed()) window.show();
    });
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    clearTimeout(refreshTimer);
    folderWatcher?.close();
  });
}
