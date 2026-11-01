const { app, BrowserWindow, protocol, net, session } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const { readdir, stat } = require("node:fs/promises");
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
const bundledFiles = new Map();
const catalog = [];

async function scanMusic() {
  let visited = 0;
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "musicas")
    : path.join(app.getAppPath(), "musicas");
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
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
      const id = createHash("sha256").update(relative).digest("hex");
      const urlPath = "/music/" + id;
      const parts = path
        .basename(entry.name, path.extname(entry.name))
        .replace(/_/g, " ")
        .split(/\s+[-–—]\s+/);
      const artist = parts.length > 1 ? parts.shift() : "Música incluída";
      catalog.push({
        id: "bundle:" + id,
        name: entry.name,
        title: parts.join(" - "),
        artist,
        format: extension.slice(1),
        duration: 0,
        embedded: true,
        url: "onda://app" + urlPath,
        importedAt: 0,
        favorite: false,
      });
      bundledFiles.set(urlPath, { file, type: audioTypes[extension] });
    }
  }
  await walk(root);
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
    Readable.toWeb(fs.createReadStream(item.file, { start, end })),
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

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(async () => {
    // Opening the window must not wait for every music directory to be scanned.
    const libraryReady = scanMusic().then(
      () => true,
      (error) => {
        console.error(
          "Falha ao ler músicas incluídas:",
          error.code || error.name,
        );
        return false;
      },
    );
    protocol.handle("onda", async (request) => {
      const url = new URL(request.url);
      if (url.hostname !== "app" || !["GET", "HEAD"].includes(request.method))
        return new Response("Not found", { status: 404 });
      if (url.pathname === "/library.json") {
        if (!(await libraryReady))
          return new Response("Library unavailable", { status: 503 });
        return new Response(
          request.method === "HEAD" ? null : JSON.stringify(catalog),
          { headers: { "Content-Type": "application/json; charset=utf-8" } },
        );
      }
      if (url.pathname.startsWith("/music/")) await libraryReady;
      if (bundledFiles.has(url.pathname)) {
        try {
          return await serveMusic(request, bundledFiles.get(url.pathname));
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
    window.once("ready-to-show", () => window.show());
    window.loadURL("onda://app/index.html");
    app.on("activate", () => {
      if (window && !window.isDestroyed()) window.show();
    });
  });
  app.on("window-all-closed", () => app.quit());
}
