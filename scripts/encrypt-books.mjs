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
 * Also writes catalog.json next to the .enc files — the manifest the site
 * fetches to build the Browse shelf, so new vault books appear without
 * touching src/books.ts. Optional per-file metadata (title/author/id) is
 * read from books.json in the input directory.
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
  entries = (await readdir(inDir))
    .filter((f) => /\.(epub|pdf)$/i.test(f))
    .sort((a, b) => a.localeCompare(b));
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

/* ---- catalog manifest --------------------------------------------------
 * The site has no way of knowing what the vault contains, so this step also
 * emits a manifest next to the ciphertext. Each entry mirrors the Book shape
 * in src/books.ts: { id, title, author?, type, url }. Display metadata comes
 * from books.json (filename → { title, author, id }) when present; otherwise
 * the title is derived from the filename. */
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on",
  "or", "so", "the", "to", "up", "yet",
]);

function prettify(base) {
  const words = base
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return null;
  return words
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i !== 0 && i !== words.length - 1 && SMALL_WORDS.has(lower)) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

let metadata = {};
try {
  const raw = JSON.parse(
    await readFile(path.join(inDir, "books.json"), "utf8")
  );
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    metadata = raw;
  }
} catch {
  metadata = {}; // books.json is optional
}

const usedIds = new Set();
const catalog = entries.map((file) => {
  const ext = path.extname(file).toLowerCase();
  const base = file.slice(0, file.length - ext.length);
  const meta = metadata[file] ?? {};
  let id =
    typeof meta.id === "string" && meta.id.trim()
      ? meta.id.trim()
      : base
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
  if (!id) id = "book";
  while (usedIds.has(id)) id = `${id}-2`;
  usedIds.add(id);

  const entry = {
    id,
    title:
      typeof meta.title === "string" && meta.title.trim()
        ? meta.title.trim()
        : (prettify(base) ?? base),
    type: ext === ".pdf" ? "pdf" : "epub",
    url: `books/${file}`,
  };
  if (typeof meta.author === "string" && meta.author.trim()) {
    entry.author = meta.author.trim();
  }
  return entry;
});

await writeFile(
  path.join(outDir, "catalog.json"),
  `${JSON.stringify(catalog, null, 2)}\n`
);

console.log(`\nEncrypted ${entries.length} book(s) into ${outDir}`);
console.log(
  `✔ catalog.json (${catalog.length} entries) → ${path.join(outDir, "catalog.json")}`
);