/**
 * Book loader for the encrypted library.
 *
 * Catalog/URL books are fetched as ciphertext (`<url>.enc`) and decrypted in
 * the browser with a passphrase — see bookCrypto.ts. Device-added books
 * (UserBook with a `blobKey`) are stored as plain Blobs in IndexedDB because
 * their file never leaves the browser, so there is nothing to encrypt.
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
  // Catalog/URL books ship as ciphertext; fetch+decrypt (may throw
  // PassphraseRequiredError / WrongPassphraseError for the reader to surface).
  return loadDecryptedBook(book.url);
}
