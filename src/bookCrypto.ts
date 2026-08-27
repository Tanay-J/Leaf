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
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function setStoredPassphrase(pw: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, pw);
  } catch {
    // sessionStorage unavailable (private mode) — decryption still works
    // for this load; the next one will ask again.
  }
}

function clearStoredPassphrase(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
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
  const res = await fetch(`${url}.enc`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching ${url}.enc`);
  }
  const blob = new Uint8Array(await res.arrayBuffer());

  if (blob.length <= SALT_BYTES + IV_BYTES) {
    throw new Error(`Encrypted book at ${url}.enc is truncated`);
  }

  const pw = getStoredPassphrase();
  if (!pw) throw new PassphraseRequiredError();

  return decryptBlob(blob, pw);
}

async function decryptBlob(
  blob: Uint8Array,
  passphrase: string
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
    clearStoredPassphrase();
    throw new WrongPassphraseError();
  }
}
