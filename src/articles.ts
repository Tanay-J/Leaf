/**
 * Read-later article links, persisted per browser in localStorage
 * (same zero-backend philosophy as reading progress in lib.ts). Also the
 * source of truth that the optional GitHub-Gist cross-device sync
 * (src/articleSync.ts) merges with.
 */
export interface SavedArticle {
  id: string;
  url: string;
  title: string;
  domain: string;
  addedAt: number;
  /** Timestamp of last read; null while still unread. */
  readAt: number | null;
  /** Timestamp when starred; null while unstarred. */
  starredAt?: number | null;
  /** Timestamp when archived; null while in the active list. */
  archivedAt?: number | null;
  /** User tags, lowercase and trimmed. */
  tags?: string[];
  /** Last time any field changed; drives sync merge conflicts. */
  updatedAt: number;
  /** Tombstone for cross-device deletes; null while the row is live. */
  removedAt: number | null;
}

const STORAGE_KEY = "leaf:articles";

/** Fired by persist(); the sync engine listens to schedule a push. */
export const ARTICLES_CHANGED_EVENT = "leaf:articles-changed";

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Backfills fields added after migration so old rows stay merge-safe. */
function normalize(a: SavedArticle): SavedArticle {
  return {
    ...a,
    starredAt: a.starredAt ?? null,
    archivedAt: a.archivedAt ?? null,
    tags: Array.isArray(a.tags) ? a.tags : [],
    updatedAt: a.updatedAt ?? a.addedAt,
    removedAt: a.removedAt ?? null,
  };
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

function loadRawArticles(): SavedArticle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as SavedArticle[]) : [];
    return Array.isArray(list) ? list.map(normalize) : [];
  } catch {
    return [];
  }
}

/** Live (non-deleted) articles, newest first — what the UI shows. */
export function loadArticles(): SavedArticle[] {
  return loadRawArticles().filter((a) => !a.removedAt);
}

/** Every row including tombstones — for sync merge only. */
export function loadAllArticles(): SavedArticle[] {
  return loadRawArticles();
}

export function getArticle(id: string): SavedArticle | null {
  const found = loadRawArticles().find((a) => a.id === id);
  return found && !found.removedAt ? found : null;
}

function persist(list: SavedArticle[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
  try {
    window.dispatchEvent(new CustomEvent(ARTICLES_CHANGED_EVENT));
  } catch {
    /* SSR / storage unavailable */
  }
}

/** Writes a full list, used by the sync engine after a remote merge. */
export function replaceArticles(list: SavedArticle[]): void {
  persist(list.map(normalize));
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
  const list = loadRawArticles();
  const existing = list.find((a) => a.url === url && !a.removedAt);
  if (existing) return { article: existing, added: false };

  const timestamp = Date.now();
  const article: SavedArticle = {
    id: makeId(),
    url,
    title: deriveTitle(url),
    domain: domainOf(url),
    addedAt: timestamp,
    readAt: null,
    updatedAt: timestamp,
    removedAt: null,
  };

  // Re-saving a previously-deleted link revives it (replaces the tombstone).
  const tombstone = list.find((a) => a.url === url && a.removedAt);
  persist(
    tombstone
      ? list.map((a) => (a.url === url && a.removedAt ? article : a))
      : [article, ...list]
  );
  return { article, added: true };
}

/** Deletes by setting a tombstone so other synced devices honour the removal. */
export function removeArticle(id: string): void {
  const now = Date.now();
  persist(
    loadRawArticles().map((a) =>
      a.id === id ? { ...a, removedAt: now, updatedAt: now } : a
    )
  );
}

export function setArticleRead(id: string, read: boolean): void {
  const now = Date.now();
  persist(
    loadRawArticles().map((a) =>
      a.id === id
        ? {
            ...a,
            readAt: read ? (a.readAt ?? now) : null,
            updatedAt: now,
          }
        : a
    )
  );
}

/** Star / unstar an article. */
export function setArticleStar(id: string, starred: boolean): void {
  const now = Date.now();
  persist(
    loadRawArticles().map((a) =>
      a.id === id
        ? { ...a, starredAt: starred ? (a.starredAt ?? now) : null, updatedAt: now }
        : a
    )
  );
}

/** Archive / unarchive an article (hidden from the active list while archived). */
export function setArticleArchived(id: string, archived: boolean): void {
  const now = Date.now();
  persist(
    loadRawArticles().map((a) =>
      a.id === id
        ? {
            ...a,
            archivedAt: archived ? (a.archivedAt ?? now) : null,
            updatedAt: now,
          }
        : a
    )
  );
}

/** Replaces an article's tag list (lowercased, deduped, non-empty). */
export function setArticleTags(id: string, tags: string[]): void {
  const now = Date.now();
  const clean = Array.from(
    new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))
  ).slice(0, 10);
  persist(
    loadRawArticles().map((a) =>
      a.id === id ? { ...a, tags: clean, updatedAt: now } : a
    )
  );
}

/** Upgrades the placeholder title with the real one pulled from the page. */
export function updateArticleTitle(id: string, title: string): void {
  const clean = title.trim();
  if (!clean) return;
  const now = Date.now();
  persist(
    loadRawArticles().map((a) =>
      a.id === id ? { ...a, title: clean, updatedAt: now } : a
    )
  );
}
