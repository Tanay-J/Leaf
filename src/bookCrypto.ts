/**
 * Client-side decryption for the passphrase-protected library.
 *
 * Catalog/URL books are served ONLY as ciphertext produced by
 * scripts/encrypt-books.mjs:
 *   [16-byte salt][12-byte IV][AES-256-GCM ciphertext]
 * The AES key is derived from a passphrase that lives solely in the visitor's
 * sessionStorage — nothing secret ever ships with the app bundle. Keep the
 * crypto parameters in sync with scripts/encrypt-books.mjs.
 *
 * Device-local books (a UserBook with a `blobKey`) are NOT encrypted — their
 * file never leaves the browser, so there is nothing to protect at rest or in
 * transit. Those are handled by bookLoader via IndexedDB, not here.
 */
const SESSION_KEY = "reader-passphrase";
const PERSIST_KEY = "leaf:passphrase";
const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** Thrown when no passphrase has been entered in this session yet. */
export class PassphraseRequiredError extends Error {
  constructor() {
    super("Library passphrase required");
    this.name = "PassphraseRequiredError";
  }
}

/** Thrown when decryption fails — almost always a wrong passphrase. */
export class WrongPassphraseError extends Error {
  constructor() {
    super("Wrong library passphrase");
    this.name = "WrongPassphraseError";
  }
}

export function getStoredPassphrase(): string | null {
  try {
    return (
      sessionStorage.getItem(SESSION_KEY) ??
      localStorage.getItem(PERSIST_KEY)
    );
  } catch {
    return null;
  }
}

export function setStoredPassphrase(pw: string, remember = false): void {
  try {
    sessionStorage.setItem(SESSION_KEY, pw);
    if (remember) {
      localStorage.setItem(PERSIST_KEY, pw);
    } else {
      localStorage.removeItem(PERSIST_KEY);
    }
  } catch {
    // storage unavailable (private mode) — decryption still works
    // for this load; the next one will ask again.
  }
}

function clearStoredPassphrase(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(PERSIST_KEY);
  } catch {
    // ignore
  }
}

/**
 * Fetches `<url>.enc` and decrypts it. Throws PassphraseRequiredError when
 * no passphrase is cached for the session, WrongPassphraseError when the
 * cached one fails authentication (AES-GCM rejects tampered/wrong-key data).
 */
export async function loadDecryptedBook(url: string): Promise<ArrayBuffer> {
  const encPath = `${url}.enc`;
  let res = await fetch(encPath);
  let ct = res.headers.get("content-type") ?? "";
  if (
    (!res.ok || ct.includes("text/html")) &&
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
  ) {
    // In local dev, fall back to the published GitHub Pages vault ciphertext
    // when a vault book isn't stored in local public/books/.
    res = await fetch(`https://tanay-j.github.io/Leaf/${encodeURI(encPath)}`);
    ct = res.headers.get("content-type") ?? "";
  }
  if (!res.ok || ct.includes("text/html")) {
    throw new Error(`HTTP ${res.status} while fetching ${encPath}`);
  }
  const blob = new Uint8Array(await res.arrayBuffer());

  if (blob.length <= SALT_BYTES + IV_BYTES) {
    throw new Error(`Encrypted book at ${url}.enc is truncated`);
  }

  const pw = getStoredPassphrase();
  if (!pw) throw new PassphraseRequiredError();

  return decryptBlob(blob, pw);
}

/**
 * Fetches an arbitrary `.enc` file (like `books/sync.enc`) and decrypts it
 * with the provided passphrase (or stored library passphrase).
 */
export async function fetchAndDecryptAsset(
  encPath: string,
  passphrase?: string
): Promise<string> {
  const pw = passphrase?.trim() || getStoredPassphrase();
  if (!pw) throw new PassphraseRequiredError();

  let res = await fetch(encPath);
  let ct = res.headers.get("content-type") ?? "";
  if (
    (!res.ok || ct.includes("text/html")) &&
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
  ) {
    res = await fetch(`https://tanay-j.github.io/Leaf/${encodeURI(encPath)}`);
    ct = res.headers.get("content-type") ?? "";
  }
  if (!res.ok || ct.includes("text/html")) {
    throw new Error(`HTTP ${res.status} while fetching ${encPath}`);
  }
  const blob = new Uint8Array(await res.arrayBuffer());
  if (blob.length <= SALT_BYTES + IV_BYTES) {
    throw new Error(`Encrypted asset at ${encPath} is truncated`);
  }
  const buf = await decryptBlob(blob, pw, false);
  return new TextDecoder().decode(buf);
}

/** Encrypts a UTF-8 string with AES-256-GCM (PBKDF2) and returns base64. */
export async function encryptTextWithKey(
  plainText: string,
  secret: string
): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const baseKey = await subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const plainBytes = new TextEncoder().encode(plainText);
  const cipher = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv }, key, plainBytes)
  );
  const combined = new Uint8Array(SALT_BYTES + IV_BYTES + cipher.length);
  combined.set(salt, 0);
  combined.set(iv, SALT_BYTES);
  combined.set(cipher, SALT_BYTES + IV_BYTES);

  let binary = "";
  for (let i = 0; i < combined.length; i += 0x8000) {
    binary += String.fromCharCode(...combined.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Decrypts a base64 string produced by encryptTextWithKey. */
export async function decryptTextWithKey(
  b64: string,
  secret: string
): Promise<string> {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length <= SALT_BYTES + IV_BYTES) {
    throw new Error("Encrypted payload is truncated");
  }
  const buf = await decryptBlob(bytes, secret, false);
  return new TextDecoder().decode(buf);
}

/** Deterministic SHA-256 hex digest of a string. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function decryptBlob(
  blob: Uint8Array,
  passphrase: string,
  clearOnFail = true
): Promise<ArrayBuffer> {
  const salt = blob.slice(0, SALT_BYTES);
  const iv = blob.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const data = blob.slice(SALT_BYTES + IV_BYTES);

  const subtle = globalThis.crypto.subtle;
  const baseKey = await subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  try {
    return await subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  } catch {
    if (clearOnFail) clearStoredPassphrase();
    throw new WrongPassphraseError();
  }
}
