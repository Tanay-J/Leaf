/**
 * "My library", persisted per browser in localStorage. Two kinds of entries:
 *   - books pinned from the static `src/books.ts` catalog (reusing the built-in
 *     id, so reading progress and #/book routes keep working), and
 *   - external EPUB/PDF links added by URL ("Add book").
 * The My library tab renders this list; the Browse tab renders the catalog
 * with pin/unpin toggles. Only metadata lives here — the file itself is
 * fetched at runtime by URL (same as static books).
 */
import { BOOKS, type Book } from "./books";

export interface UserBook extends Book {
  /** When this book was added to "my library". */
  addedAt: number;
}

export type BookType = "epub" | "pdf";

const STORAGE_KEY = "leaf:user-books";

/** Fired by persist(); the Library listens to refresh. */
export const USER_BOOKS_CHANGED_EVENT = "leaf:user-books-changed";

function readAll(): UserBook[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as UserBook[]) : [];
  } catch {
    return [];
  }
}

function persist(list: UserBook[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(USER_BOOKS_CHANGED_EVENT));
  } catch {
    /* storage unavailable */
  }
}

export function loadUserBooks(): UserBook[] {
  return readAll();
}

/** My library only — URL books plus pinned catalog books, newest first. */
export function getMyLibrary(): UserBook[] {
  return [...readAll()].sort((a, b) => b.addedAt - a.addedAt);
}

function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "book";
}

function makeId(existing: Set<string>, url: string, title: string): string {
  let id = slugify(title) || slugify(url);
  while (existing.has(id)) {
    id = `${id}-${existing.size + 1}`;
  }
  return id;
}

/** Best-effort title from a file URL (s3.amazonaws.com/a-great-book.epub ->
    "A Great Book"), used when the user leaves the title blank. */
export function deriveBookTitle(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    const fileName = segments[segments.length - 1];
    if (fileName) {
      const cleaned = decodeURIComponent(fileName)
        .replace(/\.[^.]+$/, "")
        .replace(/[-_]+/g, " ")
        .trim();
      if (cleaned) {
        return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      }
    }
    // No meaningful path segment — fall back to the hostname, untouched.
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Detects epub/pdf from the URL extension (case-insensitive). */
export function detectBookType(url: string): BookType | null {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (/\.pdf\b/.test(path)) return "pdf";
    if (/\.epub\b/.test(path)) return "epub";
  } catch {
    /* fall through */
  }
  return null;
}

/** Adds https:// when missing and validates — throws on garbage. */
export function normalizeBookUrl(raw: string): string {
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(candidate);
  if (!parsed.hostname.includes(".")) throw new Error("invalid host");
  return parsed.toString();
}

/**
 * Adds a book to "my library". Dedupes by URL (returns the existing entry
 * with `added: false` if already present).
 */
export function addUserBook(input: {
  url: string;
  title: string;
  author: string;
  type: BookType;
}): { book: UserBook; added: boolean } {
  const url = normalizeBookUrl(input.url);
  const list = readAll();
  const existing = list.find((b) => b.url === url);
  if (existing) return { book: existing, added: false };

  const title = input.title.trim() || deriveBookTitle(url);
  const book: UserBook = {
    id: makeId(new Set(list.map((b) => b.id)), url, title),
    title,
    type: input.type,
    url,
    ...(input.author.trim() ? { author: input.author.trim() } : {}),
    addedAt: Date.now(),
  };
  persist([book, ...list]);
  return { book, added: true };
}

/**
 * Pins a book from the static catalog into "my library". Reuses the built-in
 * id so reading progress, routes, and dedupe all keep working. Dedupes by id.
 */
export function pinBook(book: Book): { book: UserBook; added: boolean } {
  const list = readAll();
  const existing = list.find((b) => b.id === book.id);
  if (existing) return { book: existing, added: false };
  const entry: UserBook = { ...book, addedAt: Date.now() };
  persist([entry, ...list]);
  return { book: entry, added: true };
}

export function removeUserBook(id: string): void {
  persist(readAll().filter((b) => b.id !== id));
}

/** Every resolvable book — my library first, then the static catalog. */
export function getAllBooks(): Book[] {
  return [...readAll(), ...BOOKS];
}

export function isUserBook(id: string): boolean {
  return readAll().some((b) => b.id === id);
}

export function findBook(id: string): Book | undefined {
  return getAllBooks().find((b) => b.id === id);
}