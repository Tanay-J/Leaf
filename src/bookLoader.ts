/**
 * Book loader for the plain (unencrypted) library.
 *
 * Books in src/books.ts are fetched directly as .epub / .pdf bytes. URLs
 * stay relative (books/alice.epub) or point at any CORS-enabled host.
 */
export async function loadBook(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching ${url}`);
  }
  return res.arrayBuffer();
}