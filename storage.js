// Audio files and playlists stay on this origin, inside the browser's IndexedDB.
const DATABASE_NAME = "onda-player";
let databasePromise;

export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      const tracks = database.createObjectStore("tracks", { keyPath: "id" });
      tracks.createIndex("fingerprint", "fingerprint", { unique: true });
      database.createObjectStore("playlists", { keyPath: "id" });
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

export function readAll(store) {
  return transaction([store], "readonly", (tx, done) => {
    tx.objectStore(store).getAll().onsuccess = (event) =>
      done(event.target.result);
  });
}

export function saveRecord(store, record) {
  return transaction([store], "readwrite", (tx) =>
    tx.objectStore(store).put(record),
  );
}

export function deletePlaylist(id) {
  return transaction(["playlists"], "readwrite", (tx) =>
    tx.objectStore("playlists").delete(id),
  );
}

// Removing a song and its playlist references must either both succeed or both fail.
export function deleteTrack(id, playlists) {
  return transaction(["tracks", "playlists"], "readwrite", (tx) => {
    tx.objectStore("tracks").delete(id);
    for (const playlist of playlists) tx.objectStore("playlists").put(playlist);
  });
}
