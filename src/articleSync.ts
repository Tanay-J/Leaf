/**
 * Optional cross-device sync for the reading list, backed by a GitHub Gist.
 *
 * The browser is always the source of truth; the gist is just the wire.
 * Flow:
 *   - local mutations -> articles.ts fires ARTICLES_CHANGED_EVENT
 *   - we debounce and PATCH the gist
 *   - on startup / "Sync now" we GET the gist, merge with local (URL-keyed,
 *     last-writer-wins per field, tombstones for deletes), and persist.
 *
 * Auth is a GitHub classic personal access token with only the "gist" scope,
 * stored in localStorage (same threat model as the rest of the app).
 */
import {
  ARTICLES_CHANGED_EVENT,
  domainOf,
  loadAllArticles,
  replaceArticles,
  type SavedArticle,
} from "./articles";

const SYNC_KEY = "leaf:sync";
const GIST_DESCRIPTION = "Leaf — reading list";
const GIST_FILENAME = "leaf-reading-list.json";
const PAYLOAD_SCHEMA = 1;
const API = "https://api.github.com";
const DEBOUNCE_MS = 2_000;
const PUSH_COOLDOWN_MS = 15_000;
/** Tombstones older than this are dropped (a device offline longer than this
    could theoretically resurrect a very old delete — documented limitation). */
export const TOMBSTONE_PRUNE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export interface SyncConfig {
  token: string;
  gistId: string;
  lastSyncedAt: number | null;
}

export type SyncState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "syncing"
  | "error";

export interface SyncStatus {
  state: SyncState;
  lastSyncedAt: number | null;
  lastError?: string;
}

const SYNC_STATUS_EVENT = "leaf:sync-status";

let config: SyncConfig | null = readConfig();
let status: SyncStatus = config
  ? { state: "connected", lastSyncedAt: config.lastSyncedAt }
  : { state: "disconnected", lastSyncedAt: null };

let initialized = false;
let applyingRemote = false;
let pushTimer: number | undefined;
let lastPushAt = 0;

/* ---------- config / status ---------- */

function readConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<SyncConfig>;
    if (!c || typeof c.token !== "string" || typeof c.gistId !== "string") {
      return null;
    }
    return {
      token: c.token,
      gistId: c.gistId,
      lastSyncedAt: c.lastSyncedAt ?? null,
    };
  } catch {
    return null;
  }
}

function writeConfig(c: SyncConfig | null): void {
  config = c;
  try {
    if (c) localStorage.setItem(SYNC_KEY, JSON.stringify(c));
    else localStorage.removeItem(SYNC_KEY);
  } catch {
    /* storage unavailable */
  }
}

function setStatus(next: SyncStatus): void {
  status = next;
  try {
    window.dispatchEvent(
      new CustomEvent<SyncStatus>(SYNC_STATUS_EVENT, { detail: { ...next } })
    );
  } catch {
    /* SSR / unavailable */
  }
}

export function getSyncStatus(): SyncStatus {
  return { ...status };
}

export function isSyncConnected(): boolean {
  return !!config;
}

/* ---------- GitHub API ---------- */

async function gh(
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {}
): Promise<Response> {
  const token = options.token ?? config?.token;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function githubError(res: Response): string {
  if (res.status === 401) return "Token rejected — check it and try again.";
  if (res.status === 403)
    return "GitHub rate-limited or forbidden — wait a bit and retry.";
  return `GitHub responded ${res.status}.`;
}

/* ---------- payload ---------- */

function serialize(list: SavedArticle[]): string {
  return JSON.stringify({ schema: PAYLOAD_SCHEMA, articles: list });
}

function deserialize(content: string): SavedArticle[] | null {
  try {
    const data = JSON.parse(content) as { schema?: number; articles?: unknown };
    if (Array.isArray(data?.articles)) return data.articles as SavedArticle[];
    if (Array.isArray(data)) return data as SavedArticle[]; // tolerate raw array
    return null;
  } catch {
    return null;
  }
}

/* ---------- merge ---------- */

/**
 * URL-keyed union merge. Tombstones win unless the surviving side edited the
 * entry after the deletion (a re-save). Read-state propagates (mark-unread
 * does not, by design); titles take the side edited last.
 */
export function mergeLists(
  local: SavedArticle[],
  remote: SavedArticle[]
): SavedArticle[] {
  const byUrl = new Map<string, SavedArticle>();
  for (const a of local) byUrl.set(a.url, a);
  for (const r of remote) {
    const l = byUrl.get(r.url);
    byUrl.set(r.url, l ? mergePair(l, r) : r);
  }

  const now = Date.now();
  return Array.from(byUrl.values())
    .filter((a) => !a.removedAt || a.removedAt >= now - TOMBSTONE_PRUNE_MS)
    .sort((a, b) => b.addedAt - a.addedAt);
}

function mergePair(l: SavedArticle, r: SavedArticle): SavedArticle {
  const lTouched = l.updatedAt ?? l.addedAt;
  const rTouched = r.updatedAt ?? r.addedAt;

  if (l.removedAt) {
    // Local deleted; remote alive. If remote edited it after the delete,
    // that's a re-save — keep it. Otherwise propagate the tombstone.
    if (rTouched > l.removedAt) {
      return { ...r, removedAt: null };
    }
    return {
      ...r,
      removedAt: l.removedAt,
      updatedAt: Math.max(lTouched, rTouched),
    };
  }
  if (r.removedAt) {
    if (lTouched > r.removedAt) {
      return { ...l, removedAt: null };
    }
    return {
      ...l,
      removedAt: r.removedAt,
      updatedAt: Math.max(lTouched, rTouched),
    };
  }

  // Both live — keep the earliest add (stable id), latest read, and the title
  // from whichever side was touched last.
  return {
    id: l.addedAt <= r.addedAt ? l.id : r.id,
    url: r.url,
    title: lTouched >= rTouched ? l.title : r.title,
    domain: l.domain || r.domain || domainOf(r.url),
    addedAt: Math.min(l.addedAt, r.addedAt),
    readAt: l.readAt != null ? l.readAt : r.readAt,
    updatedAt: Math.max(lTouched, rTouched),
    removedAt: null,
  };
}

/* ---------- pull / push ---------- */

async function pullRemote(): Promise<SavedArticle[]> {
  if (!config) return [];
  const res = await gh(`/gists/${config.gistId}`);
  if (!res.ok) throw new Error(githubError(res));
  const gist = (await res.json()) as {
    files?: Record<string, { content?: string }>;
  };
  const content = gist.files?.[GIST_FILENAME]?.content;
  const parsed = content != null ? deserialize(content) : null;
  return parsed ?? [];
}

async function pushRemote(list: SavedArticle[]): Promise<void> {
  if (!config) return;
  const res = await gh(`/gists/${config.gistId}`, {
    method: "PATCH",
    body: { files: { [GIST_FILENAME]: { content: serialize(list) } } },
  });
  if (!res.ok) throw new Error(githubError(res));
}

/** GET the gist, merge into local, persist. Emits status. */
export async function pullAndMerge(): Promise<void> {
  if (!config) return;
  const remote = await pullRemote();
  const merged = mergeLists(loadAllArticles(), remote);
  applyingRemote = true;
  try {
    replaceArticles(merged);
  } finally {
    applyingRemote = false;
  }
  const next = { ...config, lastSyncedAt: Date.now() };
  writeConfig(next);
  setStatus({ state: "connected", lastSyncedAt: next.lastSyncedAt });
}

async function doPush(): Promise<void> {
  if (!config) return;
  setStatus({ state: "syncing", lastSyncedAt: status.lastSyncedAt });
  try {
    await pushRemote(loadAllArticles());
    lastPushAt = Date.now();
    const next = { ...config, lastSyncedAt: Date.now() };
    writeConfig(next);
    setStatus({ state: "connected", lastSyncedAt: next.lastSyncedAt });
  } catch (err) {
    setStatus({
      state: "error",
      lastSyncedAt: status.lastSyncedAt,
      lastError: err instanceof Error ? err.message : String(err),
    });
    // The change listener stays active, so the next mutation retries.
  }
}

function schedulePush(): void {
  if (pushTimer !== undefined || !config) return;
  const wait = Math.max(DEBOUNCE_MS, lastPushAt + PUSH_COOLDOWN_MS - Date.now());
  pushTimer = window.setTimeout(() => {
    pushTimer = undefined;
    void doPush();
  }, wait);
}

function onArticlesChanged(): void {
  if (applyingRemote || !config) return;
  schedulePush();
}

/* ---------- public API ---------- */
let startupPullQueued = false;

/** Called once from App: listens for local mutations and pulls remote once. */
export function initSync(): void {
  if (initialized) return;
  initialized = true;
  try {
    window.addEventListener(ARTICLES_CHANGED_EVENT, onArticlesChanged);
  } catch {
    /* unavailable */
  }
  if (config && !startupPullQueued) {
    startupPullQueued = true;
    window.setTimeout(() => {
      void pullAndMerge().catch(() => {
        // Silent on startup: offline or transient — reading still works.
      });
    }, 0);
  }
}

/**
 * Connect a device: validate the token, find or create the Leaf gist, then
 * pull + merge + push so both sides converge immediately.
 */
export async function syncConnect(
  rawToken: string
): Promise<{ ok: true; gistId: string } | { ok: false; error: string }> {
  const token = rawToken.trim();
  if (!token) return { ok: false, error: "Enter a GitHub token first." };
  setStatus({ state: "connecting", lastSyncedAt: null });

  try {
    // Validate the token (only needs the `gist` scope).
    const userRes = await gh("/user", { token });
    if (!userRes.ok) return { ok: false, error: githubError(userRes) };

    // Find our gist among the user's gists (most recent first); else create it.
    const gistsRes = await gh("/gists?per_page=100", { token });
    if (!gistsRes.ok) return { ok: false, error: githubError(gistsRes) };
    const gists = (await gistsRes.json()) as Array<{
      id?: string;
      description?: string | null;
      files?: Record<string, unknown>;
    }>;
    let gistId = (Array.isArray(gists) ? gists : []).find(
      (g) => g.description === GIST_DESCRIPTION && g.files?.[GIST_FILENAME]
    )?.id;

    if (!gistId) {
      const createRes = await gh("/gists", {
        token,
        method: "POST",
        body: {
          description: GIST_DESCRIPTION,
          public: false,
          files: { [GIST_FILENAME]: { content: serialize([]) } },
        },
      });
      if (!createRes.ok) return { ok: false, error: githubError(createRes) };
      gistId = ((await createRes.json()) as { id?: string }).id;
    }
    if (!gistId) return { ok: false, error: "Could not create the gist." };

    writeConfig({ token, gistId, lastSyncedAt: null });
    await pullAndMerge();
    await doPush();
    return { ok: true, gistId };
  } catch (err) {
    writeConfig(null);
    setStatus({ state: "disconnected", lastSyncedAt: null });
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Manual "Sync now": converge then push back. */
export async function syncNow(): Promise<void> {
  if (!config) return;
  setStatus({ state: "syncing", lastSyncedAt: status.lastSyncedAt });
  await pullAndMerge().catch(async (err) => {
    setStatus({
      state: "error",
      lastSyncedAt: status.lastSyncedAt,
      lastError: err instanceof Error ? err.message : String(err),
    });
    throw err;
  });
  await doPush();
}

export function syncDisconnect(): void {
  if (pushTimer !== undefined) {
    window.clearTimeout(pushTimer);
    pushTimer = undefined;
  }
  lastPushAt = 0;
  writeConfig(null);
  setStatus({ state: "disconnected", lastSyncedAt: null });
}