const $ = (selector) => document.querySelector(selector);
const installButton = $("#install-app");
const installStatus = $("#install-status");
const offlineStatus = $("#offline-status");
const installHelp = $("#install-help");
const updateButton = $("#update-app");
const standalone = window.matchMedia("(display-mode: standalone)");
let installPrompt = null;
let registration = null;
let reloadRequested = false;
let installing = false;

function installed() {
  return standalone.matches || window.navigator.standalone === true;
}

function renderInstall() {
  installButton.hidden = installed();
  installHelp.hidden = installed();
  if (installed())
    installStatus.textContent = "Você está usando o app instalado.";
  else if (!window.isSecureContext)
    installStatus.textContent =
      "Abra o endereço HTTPS do app no Chrome ou Edge para instalar.";
  else
    installStatus.textContent = installPrompt
      ? "Pronto para instalar neste computador."
      : "Instale pelo menu do Chrome ou Edge ou veja as instruções abaixo.";
}

async function requestPersistentStorage() {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* Denial does not prevent installation or playback. */
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  renderInstall();
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installButton.hidden = true;
  installHelp.hidden = true;
  installStatus.textContent =
    "App instalado. Abra pelo menu de aplicativos do computador.";
  void requestPersistentStorage();
});
standalone.addEventListener("change", renderInstall);

installButton.addEventListener("click", async () => {
  if (!installPrompt) {
    installHelp.open = !installHelp.open;
    return;
  }
  if (installing) return;
  installing = true;
  installButton.disabled = true;
  const prompt = installPrompt;
  installPrompt = null;
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    renderInstall();
    if (choice.outcome === "accepted") {
      installButton.hidden = true;
      installStatus.textContent =
        "Instalação solicitada. Conclua as instruções do navegador.";
      void requestPersistentStorage();
    }
  } catch {
    renderInstall();
    installHelp.open = true;
    installStatus.textContent = "Use o menu do navegador para instalar o app.";
  } finally {
    installing = false;
    installButton.disabled = false;
  }
});

function showUpdate() {
  $("#app-update").hidden = !registration?.waiting;
}

updateButton.addEventListener("click", () => {
  if (!registration?.waiting) return;
  reloadRequested = true;
  updateButton.disabled = true;
  $("#update-status").textContent = "Aplicando atualização…";
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
});

async function prepareOffline() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    offlineStatus.textContent =
      "Instalação e acesso offline exigem HTTPS e um navegador compatível (ou localhost durante o desenvolvimento).";
    return;
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadRequested) window.location.reload();
  });
  try {
    registration = await navigator.serviceWorker.register(
      new URL("./sw.js", import.meta.url),
      { updateViaCache: "none" },
    );
    showUpdate();
    const watchWorker = (worker) => {
      if (!worker) return;
      const checkState = () => {
        if (worker.state === "installed") showUpdate();
        if (worker.state === "redundant" && !registration.active)
          offlineStatus.textContent =
            "Não foi possível preparar o acesso offline. Conecte-se e reabra o app para tentar novamente.";
      };
      worker.addEventListener("statechange", checkState);
      checkState();
    };
    watchWorker(registration.installing);
    registration.addEventListener("updatefound", () =>
      watchWorker(registration.installing),
    );
    await navigator.serviceWorker.ready;
    offlineStatus.textContent = "Disponível offline neste dispositivo.";
    if (installed()) void requestPersistentStorage();
    // Browsers check at launch; also check when returning to an online app.
    window.addEventListener(
      "online",
      () => void registration.update().catch(() => {}),
    );
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void registration.update().catch(() => {});
    });
  } catch {
    offlineStatus.textContent =
      "Não foi possível preparar o acesso offline. Conecte-se e reabra o app para tentar novamente.";
  }
}

renderInstall();
void prepareOffline();
