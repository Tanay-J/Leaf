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
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

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

/* Fresh covers dir per run so renamed/removed books leave nothing behind. */
const coversDir = path.join(outDir, "covers");
await mkdir(coversDir, { recursive: true });
for (const stale of await readdir(coversDir)) {
  await unlink(path.join(coversDir, stale)).catch(() => {});
}

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

/* ---- EPUB cover extraction (deploy-time, zero-dependency) ----
 * EPUBs are zips: parse the central directory, read container.xml to find
 * the OPF, then take the manifest item flagged as cover-image (or the
 * <meta name="cover"> fallback). Best-effort — failures just skip covers. */

function findEocd(buf) {
  const min = Math.max(0, buf.length - 66);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function listZipEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    entries.set(name, { method, csize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries.size > 0 ? entries : null;
}

function readZipEntry(buf, entry) {
  const { method, csize, localOff } = entry;
  const nameLen = buf.readUInt16LE(localOff + 26);
  const extraLen = buf.readUInt16LE(localOff + 28);
  const start = localOff + 30 + nameLen + extraLen;
  if (start + csize > buf.length) return null;
  const data = buf.subarray(start, start + csize);
  if (method === 0) return data;
  if (method === 8) {
    try {
      return inflateRawSync(data);
    } catch {
      return null;
    }
  }
  return null;
}

function resolveZipPath(base, href) {
  const parts = [];
  for (const seg of (base + href.replace(/^\.\//, "")).split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function extractEpubCover(buf) {
  try {
    const zip = listZipEntries(buf);
    if (!zip) return null;
    const containerEntry = zip.get("META-INF/container.xml");
    if (!containerEntry) return null;
    const container = readZipEntry(buf, containerEntry)?.toString("utf8") ?? "";
    const rootfile = /full-path="([^"]+)"/.exec(container)?.[1];
    if (!rootfile) return null;
    const opfEntry = zip.get(rootfile);
    if (!opfEntry) return null;
    const opf = readZipEntry(buf, opfEntry)?.toString("utf8") ?? "";
    const opfDir = rootfile.includes("/")
      ? rootfile.slice(0, rootfile.lastIndexOf("/") + 1)
      : "";

    const items = new Map();
    for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
      const tag = m[0];
      const id = /\bid="([^"]+)"/.exec(tag)?.[1];
      const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
      if (id && href) {
        items.set(id, {
          href: href.replace(/&amp;/g, "&"),
          mediaType: /\bmedia-type="([^"]+)"/.exec(tag)?.[1] ?? "",
          props: /\bproperties="([^"]*)"/.exec(tag)?.[1] ?? "",
        });
      }
    }

    let item = null;
    for (const it of items.values()) {
      if (/\bcover-image\b/.test(it.props)) {
        item = it;
        break;
      }
    }
    if (!item) {
      const metaCover =
        /<meta\b[^>]*name="cover"[^>]*content="([^"]+)"/.exec(opf)?.[1] ??
        /<meta\b[^>]*content="([^"]+)"[^>]*name="cover"/.exec(opf)?.[1];
      if (metaCover) item = items.get(metaCover) ?? null;
    }
    if (!item) return null;

    const entry = zip.get(resolveZipPath(opfDir, item.href));
    if (!entry) return null;
    const data = readZipEntry(buf, entry);
    if (!data || data.length === 0) return null;
    const ext = /png/i.test(item.mediaType) || /\.png$/i.test(item.href)
      ? "png"
      : "jpg";
    return { ext, data };
  } catch {
    return null;
  }
}

const catalog = [];
for (const file of entries) {
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

  // Cover: extracted from the plaintext epub before it's turned away,
  // written unencrypted under covers/ (covers are as public as the
  // title/author metadata already published in catalog.json).
  if (ext === ".epub") {
    const found = extractEpubCover(await readFile(path.join(inDir, file)));
    if (found) {
      const name = `${id}.${found.ext}`;
      await writeFile(path.join(coversDir, name), found.data);
      entry.cover = `books/covers/${name}`;
    }
  }

  catalog.push(entry);
}

await writeFile(
  path.join(outDir, "catalog.json"),
  `${JSON.stringify(catalog, null, 2)}\n`
);

console.log(`\nEncrypted ${entries.length} book(s) into ${outDir}`);
console.log(
  `✔ catalog.json (${catalog.length} entries) → ${path.join(outDir, "catalog.json")}`
);