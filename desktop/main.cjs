const { app, BrowserWindow, protocol, net, session } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

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
  app.whenReady().then(() => {
    protocol.handle("onda", (request) => {
      const url = new URL(request.url);
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
