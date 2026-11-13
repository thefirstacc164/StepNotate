const DB_NAME = "stepnotate";
const DB_VERSION = 1;

let connection = null;

function openDatabase() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" });
      if (!db.objectStoreNames.contains("marks")) db.createObjectStore("marks", { keyPath: "id" });
      if (!db.objectStoreNames.contains("pending")) db.createObjectStore("pending", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

async function store(name, mode, run) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(name, mode);
    const target = transaction.objectStore(name);
    let result;
    try {
      result = run(target);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(result?.__request ? result.__request.result : result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function requestOf(request) {
  return { __request: request };
}

export async function saveDocument(meta, bytes) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(["docs", "files"], "readwrite");
    transaction.objectStore("docs").put(meta);
    if (bytes) transaction.objectStore("files").put({ id: meta.id, bytes });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

export function getDocumentMeta(id) {
  return store("docs", "readonly", (target) => requestOf(target.get(id)));
}

export function listDocuments() {
  return store("docs", "readonly", (target) => requestOf(target.getAll())).then((list) =>
    (list || []).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0))
  );
}

export function getDocumentBytes(id) {
  return store("files", "readonly", (target) => requestOf(target.get(id))).then((row) => row?.bytes || null);
}

export async function removeDocument(id) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(["docs", "files", "marks"], "readwrite");
    transaction.objectStore("docs").delete(id);
    transaction.objectStore("files").delete(id);
    transaction.objectStore("marks").delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

export function saveMarks(id, annotations, extra = {}) {
  return store("marks", "readwrite", (target) =>
    requestOf(target.put({ id, annotations, savedAt: Date.now(), ...extra }))
  );
}

export function getMarks(id) {
  return store("marks", "readonly", (target) => requestOf(target.get(id)));
}

export function setPending(record) {
  return store("pending", "readwrite", (target) => requestOf(target.put(record)));
}

export async function takePending() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("pending", "readwrite");
    const target = transaction.objectStore("pending");
    const get = target.get("pending");
    get.onsuccess = () => {
      const value = get.result;
      if (value) target.delete("pending");
      transaction.oncomplete = () => resolve(value || null);
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function saveThumb(id, dataUrl) {
  const meta = await getDocumentMeta(id);
  if (!meta) return;
  meta.thumb = dataUrl;
  return saveDocument(meta, null);
}
