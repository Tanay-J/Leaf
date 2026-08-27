/**
 * Device-local book files, stored in IndexedDB ("stay on this device").
 *
 * EPUB/PDF files added from the user's computer are saved as Blobs here —
 * localStorage is far too small for real books. Each blob is keyed by the
 * owning UserBook's blobKey; removing the book removes its blob.
 */

const DB_NAME = "leaf";
const DB_VERSION = 1;
const STORE = "books";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open storage."));
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Storage request failed."));
        tx.oncomplete = () => db.close();
        tx.onabort = () => db.close();
      })
  );
}

/** Saves a device-picked book file under the given key. */
export function saveBookBlob(key: string, blob: Blob): Promise<void> {
  return withStore<void>(
    "readwrite",
    (store) => store.put(blob, key) as unknown as IDBRequest<void>
  );
}

/** Loads a previously saved book file as a Blob. */
export function loadBookBlob(key: string): Promise<Blob> {
  return withStore<Blob>("readonly", (store) => store.get(key) as IDBRequest<Blob>);
}

/** Deletes the file for a removed book. Missing keys resolve quietly. */
export function deleteBookBlob(key: string): Promise<void> {
  return withStore("readwrite", (store) => store.delete(key) as IDBRequest<void>);
}
