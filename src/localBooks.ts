/**
 * Device-local book files, stored in IndexedDB ("stay on this device").
 *
 * EPUB/PDF files added from the user's computer are saved as Blobs here —
 * localStorage is far too small for real books. Each blob is keyed by the
 * owning UserBook's blobKey; removing the book removes its blob.
 *
 * Two auxiliary stores live in the same DB:
 *   - "covers" — extracted epub cover images, keyed by book id
 *   - "meta"   — per-blob SHA-256 + size, for duplicate detection
 */

const DB_NAME = "leaf";
const DB_VERSION = 3;
const STORE = "books";
const COVER_STORE = "covers";
const META_STORE = "meta";
const ARTICLE_STORE = "article-content";

export interface BookMeta {
  sha256: string;
  size: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(COVER_STORE)) {
        db.createObjectStore(COVER_STORE);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
      if (!db.objectStoreNames.contains(ARTICLE_STORE)) {
        db.createObjectStore(ARTICLE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open storage."));
  });
}

function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const req = run(tx.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Storage request failed."));
        tx.oncomplete = () => db.close();
        tx.onabort = () => db.close();
      })
  );
}

/** Saves a device-picked book file, its size, and (when known) its hash. */
export function saveBookBlob(
  key: string,
  blob: Blob,
  sha256?: string
): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE, META_STORE], "readwrite");
        tx.objectStore(STORE).put(blob, key);
        if (sha256) {
          tx.objectStore(META_STORE).put({ sha256, size: blob.size }, key);
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("Storage request failed."));
        };
      })
  );
}

/** Loads a previously saved book file as a Blob. */
export function loadBookBlob(key: string): Promise<Blob> {
  return withStore<Blob>(STORE, "readonly", (store) =>
    store.get(key) as IDBRequest<Blob>
  );
}

/** Deletes the file (and its hash meta) for a removed book. */
export function deleteBookBlob(key: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE, META_STORE], "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.objectStore(META_STORE).delete(key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("Storage request failed."));
        };
      })
  );
}

/* ---------- covers ---------- */

/** Saves an extracted cover image, keyed by book id. */
export function saveCover(id: string, blob: Blob): Promise<void> {
  return withStore<void>(COVER_STORE, "readwrite", (store) =>
    store.put(blob, id) as unknown as IDBRequest<void>
  );
}

/** Loads a stored cover image; null when there isn't one. */
export function loadCover(id: string): Promise<Blob | null> {
  return withStore<Blob | undefined>(COVER_STORE, "readonly", (store) =>
    store.get(id) as IDBRequest<Blob | undefined>
  ).then((blob) => blob ?? null);
}

export function deleteCover(id: string): Promise<void> {
  return withStore<void>(COVER_STORE, "readwrite", (store) =>
    store.delete(id) as unknown as IDBRequest<void>
  );
}

/* ---------- article content cache ---------- */

/** Persists a fetched article's markdown so re-reads work offline. */
export function saveArticleContent(id: string, markdown: string): Promise<void> {
  return withStore<void>(ARTICLE_STORE, "readwrite", (store) =>
    store.put(markdown, id) as unknown as IDBRequest<void>
  );
}

/** Loads the cached markdown for an article; null when never cached. */
export function loadArticleContent(id: string): Promise<string | null> {
  return withStore<string | undefined>(ARTICLE_STORE, "readonly", (store) =>
    store.get(id) as IDBRequest<string | undefined>
  ).then((md) => (typeof md === "string" ? md : null));
}

export function deleteArticleContent(id: string): Promise<void> {
  return withStore<void>(ARTICLE_STORE, "readwrite", (store) =>
    store.delete(id) as unknown as IDBRequest<void>
  );
}

/* ---------- duplicate detection ---------- */

/** SHA-256 hex digest of a blob; null when crypto.subtle is unavailable. */
export async function hashBlob(blob: Blob): Promise<string | null> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/** Finds the blobKey whose stored hash matches; null when unique. */
export async function findKeyBySha(sha256: string): Promise<string | null> {
  const db = await openDB();
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(null);
          return;
        }
        const meta = cursor.value as BookMeta | undefined;
        if (meta?.sha256 === sha256) {
          resolve(String(cursor.key));
          return;
        }
        cursor.continue();
      };
      req.onerror = () =>
        reject(req.error ?? new Error("Storage request failed."));
      tx.oncomplete = () => db.close();
      tx.onabort = () => db.close();
    });
  } catch (err) {
    db.close();
    throw err;
  }
}
