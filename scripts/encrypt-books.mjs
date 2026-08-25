#!/usr/bin/env node
/**
 * Encrypts book files so hosting never serves readable content.
 *
 * Output format (<name>.enc):
 *   [16-byte salt][12-byte IV][AES-256-GCM ciphertext]
 * Key = PBKDF2(SHA-256, passphrase, salt, 310000 iterations), AES-256-GCM.
 * The browser-side counterpart lives in src/bookCrypto.ts — keep them in sync.
 *
 * Usage:
 *   node scripts/encrypt-books.mjs [--in <dir>] [--out <dir>]
 * Defaults: --in content-source --out dist/books (the CI layout).
 * Locally: npm run encrypt-books wraps `--in public/books --out public/books`.
 *
 * Passphrase source: BOOKS_PASSPHRASE env var, else an interactive prompt.
 * In CI there is no TTY — a missing env var fails the build ON PURPOSE so
 * plaintext books can never reach GitHub Pages.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const inDir = path.resolve(argValue("--in", "content-source"));
const outDir = path.resolve(argValue("--out", "dist/books"));

let passphrase = process.env.BOOKS_PASSPHRASE;
if (!passphrase && process.stdin.isTTY) {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  passphrase = await rl.question("Library passphrase: ");
  rl.close();
}
if (!passphrase) {
  fail(
    "BOOKS_PASSPHRASE is not set and no TTY is available. Refusing to build — plaintext books must never be deployed."
  );
}

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();

async function deriveKey(salt) {
  const baseKey = await subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
}

let entries;
try {
  entries = (await readdir(inDir)).filter((f) => /\.(epub|pdf)$/i.test(f));
} catch {
  fail(`Input directory not found: ${inDir}`);
}
if (entries.length === 0) fail(`No .epub/.pdf files found in ${inDir}`);

await mkdir(outDir, { recursive: true });

for (const file of entries) {
  const plain = await readFile(path.join(inDir, file));
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(salt);
  const cipher = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv }, key, plain)
  );

  const blob = new Uint8Array(SALT_BYTES + IV_BYTES + cipher.length);
  blob.set(salt, 0);
  blob.set(iv, SALT_BYTES);
  blob.set(cipher, SALT_BYTES + IV_BYTES);

  const outName = `${file}.enc`;
  await writeFile(path.join(outDir, outName), blob);
  console.log(
    `✔ ${file} → ${outName} (${(plain.length / 1048576).toFixed(1)} MB)`
  );
}

console.log(`\nEncrypted ${entries.length} book(s) into ${outDir}`);
