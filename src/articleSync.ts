/**
 * Optional cross-device sync for the reading list.
 *
 * The browser is always the source of truth; the remote is just the wire.
 * Two transports share one merge engine (URL-keyed, last-writer-wins per
 * field, tombstones for deletes):
 *   - vault — articles/reading-list.json on a "sync" branch of the private
 *     vault, powered by the existing vault connection (no extra token)
 *   - gist  — a private GitHub Gist, for the classic personal-access-token
 *     flow
 *
 * Flow either way:
 *   - local mutations -> articles.ts fires ARTICLES_CHANGED_EVENT
 *   - we debounce a push
 *   - on startup / "Sync now" we pull, merge with local, and persist.
 *
 * The active backend is a stored preference; devices without it simply keep
 * their list local.
 */
import {
  ARTICLES_CHANGED_EVENT,
  domainOf,
  loadAllArticles,
  replaceArticles,
  type SavedArticle,
} from "./articles";
import {
  ensureVaultBranch,
  getVaultText,
  isVaultConnected,
  putVaultText,
  VaultConflictError,
  VaultMissingRefError,
} from "./vaultSync";

const SYNC_KEY = "leaf:sync";
const BACKEND_KEY = "leaf:article-sync";
/** Vault transport: list file + branch (never triggers a Pages deploy). */
const LIST_PATH = "articles/reading-list.json";
const SYNC_BRANCH = "sync";
const VAULT_COMMIT_MSG = "Sync reading list (Leaf)";
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

/** Which wire the list syncs over. */
export type Backend = "gist" | "vault";

interface SyncMeta {
  backend: Backend;
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
  backend?: Backend | null;
}

const SYNC_STATUS_EVENT = "leaf:sync-status";

let config: SyncConfig | null = readConfig();
let meta: SyncMeta | null = readMeta();
let status: SyncStatus = initStatus();

let initialized = false;
let applyingRemote = false;
let pushTimer: number | undefined;
let lastPushAt = 0;
/** Blob sha of the last vault read — lets pushes detect lost races. */
let vaultSha: string | null = null;

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

function readMeta(): SyncMeta | null {
  try {
    const raw = localStorage.getItem(BACKEND_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Partial<SyncMeta>;
    if (m?.backend !== "gist" && m?.backend !== "vault") return null;
    return { backend: m.backend, lastSyncedAt: m.lastSyncedAt ?? null };
  } catch {
    return null;
  }
}

function writeMeta(m: SyncMeta | null): void {
  meta = m;
  try {
    if (m) localStorage.setItem(BACKEND_KEY, JSON.stringify(m));
    else localStorage.removeItem(BACKEND_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** The transport that's both selected and actually usable right now. */
function activeBackend(): Backend | null {
  if (!meta) return null;
  if (meta.backend === "vault") return isVaultConnected() ? "vault" : null;
  return config ? "gist" : null;
}

function initStatus(): SyncStatus {
  const backend = activeBackend();
  return backend
    ? {
        state: "connected",
        lastSyncedAt: meta?.lastSyncedAt ?? null,
        backend,
      }
    : { state: "disconnected", lastSyncedAt: null, backend: null };
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
  return !!activeBackend();
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

/* ---------- gist transport ---------- */

async function pullGist(): Promise<SavedArticle[]> {
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

async function pushGist(list: SavedArticle[]): Promise<void> {
  if (!config) return;
  const res = await gh(`/gists/${config.gistId}`, {
    method: "PATCH",
    body: { files: { [GIST_FILENAME]: { content: serialize(list) } } },
  });
  if (!res.ok) throw new Error(githubError(res));
}

/* ---------- vault transport ---------- */

async function pullVault(): Promise<SavedArticle[]> {
  const entry = await getVaultText(LIST_PATH, SYNC_BRANCH);
  vaultSha = entry?.sha ?? null;
  const parsed = entry?.content ? deserialize(entry.content) : null;
  return parsed ?? [];
}

async function pushVault(list: SavedArticle[]): Promise<void> {
  try {
    vaultSha = await putVaultText(LIST_PATH, serialize(list), {
      ref: SYNC_BRANCH,
      message: VAULT_COMMIT_MSG,
      ...(vaultSha ? { sha: vaultSha } : {}),
    });
  } catch (err) {
    if (!(err instanceof VaultMissingRefError)) throw err;
    // First sync on this vault — bootstrap the branch and retry.
    await ensureVaultBranch(SYNC_BRANCH);
    vaultSha = await putVaultText(LIST_PATH, serialize(list), {
      ref: SYNC_BRANCH,
      message: VAULT_COMMIT_MSG,
    });
  }
}

/* ---------- dispatch ---------- */

function pullRemote(): Promise<SavedArticle[]> {
  const backend = activeBackend();
  if (backend === "vault") return pullVault();
  if (backend === "gist" && config) return pullGist();
  return Promise.resolve([]);
}

function pushRemote(list: SavedArticle[]): Promise<void> {
  const backend = activeBackend();
  if (backend === "vault") return pushVault(list);
  if (backend === "gist" && config) return pushGist(list);
  return Promise.resolve();
}

/** GET the remote, merge into local, persist. Emits status. */
export async function pullAndMerge(): Promise<void> {
  const backend = activeBackend();
  if (!backend || !meta) return;
  const remote = await pullRemote();
  const merged = mergeLists(loadAllArticles(), remote);
  applyingRemote = true;
  try {
    replaceArticles(merged);
  } finally {
    applyingRemote = false;
  }
  meta = { ...meta, lastSyncedAt: Date.now() };
  writeMeta(meta);
  setStatus({ state: "connected", lastSyncedAt: meta.lastSyncedAt, backend });
}

async function doPush(): Promise<void> {
  const backend = activeBackend();
  if (!backend || !meta) return;
  setStatus({ state: "syncing", lastSyncedAt: status.lastSyncedAt, backend });
  try {
    try {
      await pushRemote(loadAllArticles());
    } catch (err) {
      if (!(err instanceof VaultConflictError) || backend !== "vault") {
        throw err;
      }
      // Another device committed since our last read — merge and retry once.
      await pullAndMerge();
      await pushRemote(loadAllArticles());
    }
    lastPushAt = Date.now();
    meta = { ...meta, lastSyncedAt: Date.now() };
    writeMeta(meta);
    setStatus({
      state: "connected",
      lastSyncedAt: meta.lastSyncedAt,
      backend,
    });
  } catch (err) {
    setStatus({
      state: "error",
      lastSyncedAt: status.lastSyncedAt,
      lastError: err instanceof Error ? err.message : String(err),
      backend,
    });
    // The change listener stays active, so the next mutation retries.
  }
}

function schedulePush(): void {
  if (pushTimer !== undefined || !activeBackend()) return;
  const wait = Math.max(DEBOUNCE_MS, lastPushAt + PUSH_COOLDOWN_MS - Date.now());
  pushTimer = window.setTimeout(() => {
    pushTimer = undefined;
    void doPush();
  }, wait);
}

function onArticlesChanged(): void {
  if (applyingRemote || !activeBackend()) return;
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
  if (activeBackend() && !startupPullQueued) {
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
  setStatus({ state: "connecting", lastSyncedAt: null, backend: "gist" });

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
    meta = { backend: "gist", lastSyncedAt: null };
    writeMeta(meta);
    await pullAndMerge();
    await doPush();
    return { ok: true, gistId };
  } catch (err) {
    writeConfig(null);
    writeMeta(null);
    setStatus({ state: "disconnected", lastSyncedAt: null, backend: null });
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Connect list sync through the already-configured vault — no token needed.
 * The list lives as articles/reading-list.json on the vault's "sync" branch,
 * which never triggers a Pages deploy.
 */
export async function syncConnectViaVault(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (!isVaultConnected()) {
    return {
      ok: false,
      error: "Connect the vault first (Add book → Set up vault uploads).",
    };
  }
  meta = { backend: "vault", lastSyncedAt: null };
  writeMeta(meta);
  setStatus({ state: "connecting", lastSyncedAt: null, backend: "vault" });
  try {
    await pullAndMerge();
    await doPush();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus({
      state: "error",
      lastSyncedAt: meta?.lastSyncedAt ?? null,
      lastError: message,
      backend: "vault",
    });
    return { ok: false, error: message };
  }
}

/** Manual "Sync now": converge then push back. */
export async function syncNow(): Promise<void> {
  if (!activeBackend()) return;
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
  vaultSha = null;
  // Stop syncing the list only: the vault connection (books) and the stored
  // gist credentials both survive, so either can be re-enabled later.
  writeMeta(null);
  setStatus({ state: "disconnected", lastSyncedAt: null, backend: null });
}