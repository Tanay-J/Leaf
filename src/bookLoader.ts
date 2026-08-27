/**
 * Book loader for the plain (unencrypted) library.
 *
 * Catalog/URL books are fetched directly as .epub / .pdf bytes (relative URLs
 * like books/alice.epub or any CORS-enabled host). Device-added books
 * (UserBook with a `blobKey`) are read from IndexedDB instead — the file
 * never leaves the browser.
 */
import type { Book } from "./books";
import { loadBookBlob } from "./localBooks";

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
  const res = await fetch(book.url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching ${book.url}`);
  }
  return res.arrayBuffer();
}