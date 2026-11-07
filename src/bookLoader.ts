/**
 * Book loader for the library.
 *
 * Catalog books (`books/...`) are fetched as ciphertext (`<url>.enc`) and
 * decrypted in the browser with a passphrase — see bookCrypto.ts. External
 * `http(s)://` URL books added by the user are fetched directly, unless the
 * URL itself ends in `.enc`. Device-added books (UserBook with a `blobKey`)
 * are stored as plain Blobs in IndexedDB because their file never leaves the
 * browser, so there is nothing to encrypt.
 */
import type { Book } from "./books";
import { loadBookBlob, loadCover, saveCover } from "./localBooks";
import { loadDecryptedBook } from "./bookCrypto";
import { readEpubMeta } from "./epubMeta";

type LoadableBook = Book & { blobKey?: string };

function maybeCacheEpubCover(book: LoadableBook, buf: ArrayBuffer): void {
  if (book.type !== "epub" || book.cover) return;
  void (async () => {
    const existing = await loadCover(book.id).catch(() => null);
    if (existing) return;
    const meta = await readEpubMeta(
      new File([buf], `${book.id}.epub`, { type: "application/epub+zip" })
    ).catch(() => null);
    if (meta?.cover) {
      await saveCover(book.id, meta.cover).catch(() => {});
    }
  })();
}

export async function loadBook(book: LoadableBook): Promise<ArrayBuffer> {
  if (book.blobKey) {
    const blob = await loadBookBlob(book.blobKey);
    if (!blob) throw new Error("The stored file for this book is missing.");
    const buf = await blob.arrayBuffer();
    maybeCacheEpubCover(book, buf);
    return buf;
  }
  if (!book.url) {
    throw new Error("This book has no file to open.");
  }
  if (/^https?:\/\//i.test(book.url) && !/\.enc($|\?)/i.test(book.url)) {
    const res = await fetch(book.url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} loading ${book.url}`);
    }
    const buf = await res.arrayBuffer();
    maybeCacheEpubCover(book, buf);
    return buf;
  }
  // Catalog books ship as ciphertext; fetch+decrypt (may throw
  // PassphraseRequiredError / WrongPassphraseError for the reader to surface).
  try {
    const buf = await loadDecryptedBook(book.url);
    maybeCacheEpubCover(book, buf);
    return buf;
  } catch (err) {
    // In local dev before encrypt-books is run, fall back to plain file if present.
    if (
      err instanceof Error &&
      err.message.includes("while fetching") &&
      !/\.enc($|\?)/i.test(book.url)
    ) {
      const plainRes = await fetch(book.url);
      const ct = plainRes.headers.get("content-type") ?? "";
      if (plainRes.ok && !ct.includes("text/html")) {
        const buf = await plainRes.arrayBuffer();
        maybeCacheEpubCover(book, buf);
        return buf;
      }
    }
    throw err;
  }
}
