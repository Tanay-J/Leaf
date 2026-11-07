// Your books live here. Each entry needs:
//   id:    unique short slug (used in the URL and to remember your place)
//   title: shown on the library card and reader header
//   author:(optional) shown under the title
//   type:  "epub" or "pdf"
//   url:   relative path to the book file under /books (no scheme/host).
//          Books are served ONLY as ciphertext: a `books/<id>.epub.enc`
//          produced by CI from the private vault (see scripts/encrypt-books.mjs
//          and .github/workflows/deploy.yml). The reader fetches `<url>.enc`
//          and decrypts in the browser with the library passphrase.

export interface Book {
  id: string;
  title: string;
  author?: string;
  type: "epub" | "pdf";
  url: string;
  /** Cover image path under books/covers/ (extracted at deploy time). */
  cover?: string;
}

export const BOOKS: Book[] = [
  // ---- Local library (public/books/) ----
  {
    id: "how-prime-ministers-decide",
    title: "How Prime Ministers Decide",
    author: "Neerja Chowdhury",
    type: "epub",
    url: "books/how-prime-ministers-decide.epub",
    cover: "books/covers/how-prime-ministers-decide.jpg",
  },
  {
    id: "attached",
    title: "Attached",
    author: "Amir Levine, Rachel Heller",
    type: "epub",
    url: "books/attached.epub",
    cover: "books/covers/attached.jpg",
  },
  {
    id: "bionic",
    title: "Bionic",
    type: "epub",
    url: "books/bionic.epub",
    cover: "books/covers/bionic.jpg",
  },
  {
    id: "black-warrant",
    title: "Black Warrant: Confessions of a Tihar Jailer",
    type: "epub",
    url: "books/black-warrant.epub",
    cover: "books/covers/black-warrant.jpg",
  },
  {
    id: "daughters-of-the-brothel",
    title: "Daughters of the Brothel",
    author: "Deepak Yadav",
    type: "epub",
    url: "books/daughters-of-the-brothel.epub",
    cover: "books/covers/daughters-of-the-brothel.jpg",
  },
  {
    id: "delhi-a-novel",
    title: "Delhi: A Novel",
    author: "Khushwant Singh",
    type: "epub",
    url: "books/delhi-a-novel.epub",
    cover: "books/covers/delhi-a-novel.jpg",
  },
  {
    id: "delhi-darshan",
    title: "Delhi Darshan: The History and Monuments of India's Capital",
    author: "Giles Tillotson",
    type: "epub",
    url: "books/delhi-darshan.epub",
    cover: "books/covers/delhi-darshan.jpg",
  },
  {
    id: "harry-potter-order-of-the-phoenix",
    title: "Harry Potter and the Order of the Phoenix",
    type: "epub",
    url: "books/harry-potter-order-of-the-phoenix.epub",
    cover: "books/covers/harry-potter-order-of-the-phoenix.jpg",
  },
  {
    id: "how-to-win-friends-and-influence-people",
    title: "How to Win Friends and Influence People",
    author: "Dale Carnegie",
    type: "epub",
    url: "books/how-to-win-friends-and-influence-people.epub",
    cover: "books/covers/how-to-win-friends-and-influence-people.jpg",
  },
  {
    id: "how-to-win-friends-digital-age",
    title:
      "How to Win Friends and Influence People in the Digital Age",
    author: "Dale Carnegie and Associates",
    type: "epub",
    url: "books/how-to-win-friends-digital-age.epub",
    cover: "books/covers/how-to-win-friends-digital-age.jpg",
  },
  {
    id: "latitudes-of-longing",
    title: "Latitudes of Longing",
    author: "Shubhangi Swarup",
    type: "epub",
    url: "books/latitudes-of-longing.epub",
    cover: "books/covers/latitudes-of-longing.jpg",
  },
  {
    id: "lonely-planet-rajasthan-delhi-agra",
    title: "Lonely Planet Rajasthan, Delhi & Agra",
    author: "Lonely Planet",
    type: "epub",
    url: "books/lonely-planet-rajasthan-delhi-agra.epub",
    cover: "books/covers/lonely-planet-rajasthan-delhi-agra.jpg",
  },
  {
    id: "dopamine-detox",
    title: "Dopamine Detox",
    author: "Thibaut Meurisse",
    type: "epub",
    url: "books/dopamine-detox.epub",
    cover: "books/covers/dopamine-detox.jpg",
  },
  {
    id: "musafir-cafe",
    title: "Musafir Cafe",
    author: "Divya Prakash Dubey",
    type: "epub",
    url: "books/musafir-cafe.epub",
    cover: "books/covers/musafir-cafe.jpg",
  },
  {
    id: "shahjahanabad",
    title: "Shahjahanabad: The Living City of Old Delhi",
    author: "Rana Safvi",
    type: "epub",
    url: "books/shahjahanabad.epub",
    cover: "books/covers/shahjahanabad.jpg",
  },
  {
    id: "show-your-work",
    title: "Show Your Work!",
    author: "Austin Kleon",
    type: "epub",
    url: "books/show-your-work.epub",
    cover: "books/covers/show-your-work.jpg",
  },
  {
    id: "steal-like-an-artist",
    title: "Steal Like an Artist!",
    author: "Austin Kleon",
    type: "epub",
    url: "books/steal-like-an-artist.epub",
    cover: "books/covers/steal-like-an-artist.png",
  },
  {
    id: "forgotten-cities-of-delhi",
    title: "The Forgotten Cities of Delhi",
    author: "Rana Safvi",
    type: "epub",
    url: "books/forgotten-cities-of-delhi.epub",
    cover: "books/covers/forgotten-cities-of-delhi.jpg",
  },
  {
    id: "dead-men-tell-tales",
    title: "Dead Men Tell Tales",
    author: "B. Umadathan",
    type: "epub",
    url: "books/dead-men-tell-tales.epub",
    cover: "books/covers/dead-men-tell-tales.jpg",
  },
  {
    id: "kaalkut",
    title: "Kaalkut",
    type: "epub",
    url: "books/kaalkut.epub",
    cover: "books/covers/kaalkut.jpg",
  },
  {
    id: "flames-and-arrows",
    title: "Flames and Arrows",
    type: "epub",
    url: "books/flames-and-arrows.epub",
    cover: "books/covers/flames-and-arrows.jpg",
  },
  {
    id: "pinaka",
    title: "Pinaka",
    type: "epub",
    url: "books/pinaka.epub",
    cover: "books/covers/pinaka.jpg",
  },
];

/* ---------- Published catalog (auto-synced from the private vault) ----------
   CI encrypts the vault and writes books/catalog.json next to the .enc files
   (see scripts/encrypt-books.mjs). The Browse shelf renders that manifest so
   new vault books appear without editing this file. The static list above is
   only the offline/dev fallback used until (and if) the manifest loads. */

let catalogCache: Book[] | null = null;

/** Fired whenever books/catalog.json (or the static fallback) has landed in
 *  the session cache — state sync listens so pins for books a fresh device
 *  didn't know yet can materialise on a follow-up pull. */
export const CATALOG_LOADED_EVENT = "leaf:catalog-loaded";

function emitCatalogLoaded(): void {
  try {
    window.dispatchEvent(new CustomEvent(CATALOG_LOADED_EVENT));
  } catch {
    /* SSR / unavailable */
  }
}

/** The catalog to render right now: the published manifest once loaded,
 *  otherwise the static list above. */
export function getCatalog(): Book[] {
  return catalogCache ?? BOOKS;
}

/** Fetches books/catalog.json once per session and caches the result.
 *  Pass force to skip the cache and bust the CDN/browser cache (used right
 *  after a vault deploy so the just-published book actually appears). */
export async function loadCatalog(force = false): Promise<Book[]> {
  if (catalogCache && !force) return catalogCache;
  try {
    const url = force
      ? `books/catalog.json?v=${Date.now()}` // cache-buster for staleness
      : "books/catalog.json";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for books/catalog.json`);
    catalogCache = parseCatalog(await res.json());
  } catch {
    if (!catalogCache) catalogCache = BOOKS;
    // keep the existing cache on a failed force-refresh (transient network)
  }
  emitCatalogLoaded();
  return catalogCache;
}

/** Re-fetches books/catalog.json — used after a vault upload finishes its
 *  deploy so the new book appears without a full page reload. */
export async function reloadCatalog(): Promise<Book[]> {
  catalogCache = null;
  return loadCatalog(true);
}

function parseCatalog(raw: unknown): Book[] {
  if (!Array.isArray(raw)) return BOOKS;
  const staticById = new Map(BOOKS.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const books: Book[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id : "";
    const fallback = staticById.get(id);
    const title =
      fallback?.title || (typeof e.title === "string" ? e.title : "");
    const type = e.type === "pdf" ? "pdf" : e.type === "epub" ? "epub" : null;
    const url = typeof e.url === "string" ? e.url : "";
    if (!id || !title || !type || !url || seen.has(id)) continue;
    // Only manifest-relative book paths, and nothing that escapes /books.
    if (!url.startsWith("books/") || url.includes("..")) continue;
    seen.add(id);
    const rawAuthor =
      typeof e.author === "string" && e.author ? e.author : fallback?.author;
    const rawCover =
      typeof e.cover === "string" &&
      e.cover.startsWith("books/covers/") &&
      !e.cover.includes("..")
        ? e.cover
        : fallback?.cover;
    books.push({
      id,
      title,
      type,
      url,
      ...(rawAuthor ? { author: rawAuthor } : {}),
      ...(rawCover ? { cover: rawCover } : {}),
    });
  }
  return books.length > 0 ? books : BOOKS;
}