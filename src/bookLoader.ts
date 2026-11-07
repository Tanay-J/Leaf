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
import { loadBookBlob } from "./localBooks";
import { loadDecryptedBook } from "./bookCrypto";

type LoadableBook = Book & { blobKey?: string };

export async function loadBook(book: LoadableBook): Promise<ArrayBuffer> {
  if (book.blobKey) {
    const blob = await loadBookBlob(book.blobKey);
    if (!blob) throw new Error("The stored file for this book is missing.");
    return blob.arrayBuffer();
  }
  if (!book.url) {
    throw new Error("This book has no file to open.");
  }
  if (/^https?:\/\//i.test(book.url) && !/\.enc($|\?)/i.test(book.url)) {
    const res = await fetch(book.url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} loading ${book.url}`);
    }
    return res.arrayBuffer();
  }
  // Catalog books ship as ciphertext; fetch+decrypt (may throw
  // PassphraseRequiredError / WrongPassphraseError for the reader to surface).
  return loadDecryptedBook(book.url);
}
