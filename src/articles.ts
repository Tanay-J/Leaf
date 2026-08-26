/**
 * Read-later article links, persisted per browser in localStorage
 * (same zero-backend philosophy as reading progress in lib.ts).
 */
export interface SavedArticle {
  id: string;
  url: string;
  title: string;
  domain: string;
  addedAt: number;
  /** Timestamp of last read; null while still unread. */
  readAt: number | null;
}

const STORAGE_KEY = "leaf:articles";

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Adds https:// when missing and validates the result. Throws on garbage. */
export function normalizeUrl(raw: string): string {
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(candidate);
  if (!parsed.hostname.includes(".")) throw new Error("invalid host");
  return parsed.toString();
}

/** Best-effort human title from the URL itself (upgraded later after fetch). */
export function deriveTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const segment =
      parsed.pathname.split("/").filter(Boolean).pop() ??
      parsed.hostname.replace(/^www\./, "");
    const cleaned = decodeURIComponent(segment)
      .replace(/\.(html?|php|aspx?)$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\d{4,}/g, "")
      .trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const sentence = words.join(" ");
      return sentence.charAt(0).toUpperCase() + sentence.slice(1);
    }
  } catch {
    /* fall through */
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function loadArticles(): SavedArticle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as SavedArticle[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persist(list: SavedArticle[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Returns the stored entry and whether it was newly created (dedupes by URL). */
export function addArticle(
  rawUrl: string
): { article: SavedArticle; added: boolean } {
  const url = normalizeUrl(rawUrl);
  const list = loadArticles();
  const existing = list.find((a) => a.url === url);
  if (existing) return { article: existing, added: false };

  const article: SavedArticle = {
    id: makeId(),
    url,
    title: deriveTitle(url),
    domain: domainOf(url),
    addedAt: Date.now(),
    readAt: null,
  };
  persist([article, ...list]);
  return { article, added: true };
}

export function removeArticle(id: string): void {
  persist(loadArticles().filter((a) => a.id !== id));
}

export function setArticleRead(id: string, read: boolean): void {
  persist(
    loadArticles().map((a) =>
      a.id === id ? { ...a, readAt: read ? (a.readAt ?? Date.now()) : null } : a
    )
  );
}

/** Upgrades the placeholder title with the real one pulled from the page. */
export function updateArticleTitle(id: string, title: string): void {
  const clean = title.trim();
  if (!clean) return;
  persist(
    loadArticles().map((a) => (a.id === id ? { ...a, title: clean } : a))
  );
}
