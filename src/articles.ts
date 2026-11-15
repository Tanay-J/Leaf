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
  /** Short plain-text excerpt from extracted markdown. */
  excerpt?: string;
  /** Estimated reading time in minutes (~220 wpm). */
  readingMinutes?: number;
  /** Extraction / offline content status. */
  contentStatus?: "pending" | "ready" | "failed";
  /** Scroll reading progress 0..1. */
  progress?: number;
  /** Last time any field changed; drives sync merge conflicts. */
  updatedAt: number;
  /** Tombstone for cross-device deletes; null while the row is live. */
  removedAt: number | null;
}

const STORAGE_KEY = "leaf:articles";

/** Fired by persist(); the sync engine listens to schedule a push. */
export const ARTICLES_CHANGED_EVENT = "leaf:articles-changed";

/** Predefined category tags available out-of-the-box for organizing articles. */
export const PREDEFINED_TAGS: readonly { id: string; label: string }[] = [
  { id: "tech", label: "Tech" },
  { id: "ai", label: "AI" },
  { id: "design", label: "Design" },
  { id: "business", label: "Business" },
  { id: "science", label: "Science" },
  { id: "culture", label: "Culture" },
  { id: "essays", label: "Essays" },
];

export function formatTagLabel(tag: string): string {
  const found = PREDEFINED_TAGS.find((t) => t.id === tag.toLowerCase());
  if (found) return found.label;
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

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

function cleanTagList(tags: string[]): string[] {
  return Array.from(
    new Set(
      tags
        .map((t) => t.replace(/^#+/, "").trim().toLowerCase())
        .filter(Boolean)
    )
  ).slice(0, 12);
}

/** Returns the stored entry and whether it was newly created (dedupes by URL). */
export function addArticle(
  rawInput: string,
  initialTags: string[] = []
): { article: SavedArticle; added: boolean } {
  // Support inline "#tag" tokens after the URL (e.g. "https://example.com #tech #ai").
  const inlineTags: string[] = [];
  const strippedUrl = rawInput
    .trim()
    .replace(/(?:^|\s)#([a-z0-9_-]+)/gi, (_m, tag: string) => {
      inlineTags.push(tag);
      return "";
    })
    .trim();

  const url = normalizeUrl(strippedUrl || rawInput.trim());
  const mergedTags = cleanTagList([...initialTags, ...inlineTags]);
  const list = loadRawArticles();
  const existing = list.find((a) => a.url === url && !a.removedAt);
  if (existing) {
    if (mergedTags.length > 0) {
      const nextTags = cleanTagList([...(existing.tags ?? []), ...mergedTags]);
      const updated = { ...existing, tags: nextTags, updatedAt: Date.now() };
      persist(list.map((a) => (a.id === existing.id ? updated : a)));
      return { article: updated, added: false };
    }
    return { article: existing, added: false };
  }

  const timestamp = Date.now();
  const article: SavedArticle = {
    id: makeId(),
    url,
    title: deriveTitle(url),
    domain: domainOf(url),
    addedAt: timestamp,
    readAt: null,
    tags: mergedTags,
    contentStatus: "pending",
    progress: 0,
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
  const clean = cleanTagList(tags);
  persist(
    loadRawArticles().map((a) =>
      a.id === id ? { ...a, tags: clean, updatedAt: now } : a
    )
  );
}

/** Toggles a single tag on/off an article. */
export function toggleArticleTag(id: string, rawTag: string): void {
  const tag = rawTag.replace(/^#+/, "").trim().toLowerCase();
  if (!tag) return;
  const now = Date.now();
  persist(
    loadRawArticles().map((a) => {
      if (a.id !== id) return a;
      const current = a.tags ?? [];
      const next = current.includes(tag)
        ? current.filter((t) => t !== tag)
        : cleanTagList([...current, tag]);
      return { ...a, tags: next, updatedAt: now };
    })
  );
}

/**
 * Splits a Jina Reader (r.jina.ai) text response into its metadata header
 * and the markdown body.
 */
export function parseReaderResponse(raw: string): {
  title: string | null;
  markdown: string;
} {
  const text = raw.replace(/\r\n?/g, "\n");
  const marker = /^Markdown Content:[ \t]*\n?/m.exec(text);
  const head = marker ? text.slice(0, marker.index) : "";
  const looksLikeHeader = marker != null && /^(Title|URL Source):/m.test(head);
  const markdown = looksLikeHeader
    ? text.slice(marker.index + marker[0].length).trim()
    : text.trim();
  const headerTitle = looksLikeHeader
    ? /^Title:[ \t]*(.+)$/m.exec(head)?.[1]?.trim()
    : undefined;
  const headingTitle = /^#\s+(.+)$/m
    .exec(markdown.slice(0, 4000))?.[1]
    ?.replace(/[#*_`]+/g, "")
    .trim();
  return { title: headerTitle || headingTitle || null, markdown };
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

function summarizeMarkdown(md: string): {
  excerpt: string;
  readingMinutes: number;
} {
  const plain = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = plain ? plain.split(/\s+/).length : 0;
  const readingMinutes = Math.max(1, Math.round(words / 220));
  const excerpt = plain.length > 160 ? `${plain.slice(0, 157)}…` : plain;
  return { excerpt, readingMinutes };
}

/** Records extracted title, excerpt, reading time, and ready status. */
export function updateArticleExtracted(
  id: string,
  info: { title?: string | null; markdown: string }
): void {
  const now = Date.now();
  const { excerpt, readingMinutes } = summarizeMarkdown(info.markdown);
  const cleanTitle = info.title?.trim();
  persist(
    loadRawArticles().map((a) =>
      a.id === id
        ? {
            ...a,
            ...(cleanTitle ? { title: cleanTitle } : {}),
            excerpt,
            readingMinutes,
            contentStatus: "ready" as const,
            updatedAt: now,
          }
        : a
    )
  );
}

export function setArticleContentStatus(
  id: string,
  contentStatus: "pending" | "ready" | "failed"
): void {
  const now = Date.now();
  persist(
    loadRawArticles().map((a) =>
      a.id === id ? { ...a, contentStatus, updatedAt: now } : a
    )
  );
}

export function setArticleProgress(id: string, progress: number): void {
  const clamped = Math.max(0, Math.min(1, progress));
  const now = Date.now();
  persist(
    loadRawArticles().map((a) =>
      a.id === id
        ? {
            ...a,
            progress: clamped,
            ...(clamped >= 0.9 ? { readAt: a.readAt ?? now } : {}),
            updatedAt: now,
          }
        : a
    )
  );
}
