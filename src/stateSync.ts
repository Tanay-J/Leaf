/**
 * Cross-device sync for reading progress and library pins.
 *
 * Stored as state/leaf-state.json on the vault's "sync" branch (the same
 * branch the article list uses), so it never triggers a Pages deploy. The
 * browser stays the source of truth:
 *   - local mutations (progress saves, pin/unpin) -> debounced push
 *   - startup / tab focus -> pull, merge into local, persist
 *
 * Merge semantics:
 *   - progress: last-writer-wins per book (updatedAt); lastReadAt and
 *     finishedAt never regress
 *   - pins: tombstoned — an unpin propagates unless the other side pinned
 *     again after the unpin
 *   - readDays: union (drives streaks)
 *
 * Requires the vault connection (Add book → Set up vault uploads); without
 * it everything simply stays local.
 */
import {
  PROGRESS_SAVED_EVENT,
  loadAllProgress,
  readDays,
  readSecondsMap,
  replaceProgress,
  replaceReadDays,
  replaceReadSeconds,
  type BookProgress,
} from "./lib";
import {
  loadAllPins,
  replacePins,
  USER_BOOKS_CHANGED_EVENT,
  type UserBook,
} from "./userBooks";
import { CATALOG_LOADED_EVENT, getCatalog } from "./books";
import {
  ensureVaultBranch,
  getVaultText,
  isVaultConnected,
  putVaultText,
  VaultConflictError,
  VaultMissingRefError,
} from "./vaultSync";

const STATE_PATH = "state/leaf-state.json";
const SYNC_BRANCH = "sync";
/** 2: adds readSeconds (per-day reading time). Schema-1 payloads still load.
 *  3: pins carry the book metadata (title/author/type/url/cover) so a fresh
 *     device can materialise My library from the vault alone. */
const SCHEMA = 3;
const LAST_KEY = "leaf:state-sync";
const DEBOUNCE_MS = 3_000;
const PUSH_COOLDOWN_MS = 15_000;
const FOCUS_PULL_COOLDOWN_MS = 60_000;
const TOMBSTONE_PRUNE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export const STATE_SYNC_STATUS_EVENT = "leaf:state-sync-status";

export type StateSyncState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "syncing"
  | "error";

export interface StateSyncStatus {
  state: StateSyncState;
  lastSyncedAt: number | null;
  lastError?: string;
}

interface PinRecord {
  addedAt: number;
  pinnedAt?: number;
  removedAt: number | null;
  updatedAt: number;
  /** Book metadata (schema 3) so another device can re-create the library
   *  entry. Absent on records written by older builds. */
  title?: string;
  author?: string;
  type?: "epub" | "pdf";
  url?: string;
  cover?: string;
}

interface ProgressRecord extends BookProgress {
  updatedAt: number;
  lastReadAt?: number | null;
  finishedAt?: number | null;
}

interface StatePayload {
  schema: number;
  progress: Record<string, ProgressRecord>;
  pins: Record<string, PinRecord>;
  readDays: Record<string, boolean>;
  /** Seconds read per local day (YYYY-MM-DD → seconds). */
  readSeconds: Record<string, number>;
}

let status: StateSyncStatus = isVaultConnected()
  ? {
      state: "connected",
      lastSyncedAt: readLast()?.lastSyncedAt ?? null,
    }
  : { state: "disconnected", lastSyncedAt: null };

let initialized = false;
let applyingRemote = false;
let pushTimer: number | undefined;
let lastPushAt = 0;
let lastFocusPullAt = 0;
/** Blob sha of the last vault read — lets pushes detect lost races. */
let vaultSha: string | null = null;
/** Last pulled payload — merged back into pushes so nothing is lost. */
let lastRemote: StatePayload | null = null;

function readLast(): { lastSyncedAt: number | null } | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lastSyncedAt?: unknown };
    return { lastSyncedAt: typeof parsed.lastSyncedAt === "number" ? parsed.lastSyncedAt : null };
  } catch {
    return null;
  }
}

function writeLast(last: { lastSyncedAt: number | null }): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(last));
  } catch {
    /* storage unavailable */
  }
}

function setStatus(next: StateSyncStatus): void {
  status = next;
  try {
    window.dispatchEvent(
      new CustomEvent<StateSyncStatus>(STATE_SYNC_STATUS_EVENT, {
        detail: { ...next },
      })
    );
  } catch {
    /* SSR / unavailable */
  }
}

export function getStateSyncStatus(): StateSyncStatus {
  return { ...status };
}

/** True when state sync can run (i.e. the vault is connected). */
export function isStateSyncActive(): boolean {
  return isVaultConnected();
}

/* ---------- payload build + merge ---------- */

function buildLocalProgress(): Record<string, ProgressRecord> {
  const out: Record<string, ProgressRecord> = {};
  for (const [id, p] of Object.entries(loadAllProgress())) {
    out[id] = { ...p, updatedAt: p.updatedAt ?? 0 };
  }
  return out;
}

function buildLocalPins(): Record<string, PinRecord> {
  const out: Record<string, PinRecord> = {};
  for (const b of loadAllPins()) {
    // Device-local books (file lives in this browser's IndexedDB) can't
    // follow the pin — skip them so an empty url never syncs.
    if (b.blobKey || !b.url) continue;
    out[b.id] = {
      addedAt: b.addedAt,
      pinnedAt: b.pinnedAt ?? b.addedAt,
      removedAt: b.removedAt ?? null,
      updatedAt: b.updatedAt ?? b.addedAt,
      ...(b.title ? { title: b.title } : {}),
      ...(b.author ? { author: b.author } : {}),
      ...(b.type ? { type: b.type } : {}),
      ...(b.url ? { url: b.url } : {}),
      ...(b.cover ? { cover: b.cover } : {}),
    };
  }
  return out;
}

/** Serializes local state; union-merges the remote readDays so pushes never
 *  erase days recorded by other devices. */
function buildPayload(remote?: StatePayload | null): string {
  const readDaysMap: Record<string, boolean> = {
    ...(remote?.readDays ?? {}),
    ...readDays(),
  };
  const today = new Date().toLocaleDateString("en-CA");
  for (const p of Object.values(buildLocalProgress())) {
    if (
      p.lastReadAt &&
      new Date(p.lastReadAt).toLocaleDateString("en-CA") === today
    ) {
      readDaysMap[today] = true;
      break;
    }
  }
  const payload: StatePayload = {
    schema: SCHEMA,
    progress: buildLocalProgress(),
    pins: buildLocalPins(),
    readDays: readDaysMap,
    // Max per day: another device's tally never lowers ours.
    readSeconds: maxMergeNumbers(remote?.readSeconds, readSecondsMap()),
  };
  return JSON.stringify(payload);
}

function maxMergeNumbers(
  remote: Record<string, number> | undefined,
  local: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = { ...local };
  for (const [k, v] of Object.entries(remote ?? {})) {
    out[k] = Math.max(out[k] ?? 0, v ?? 0);
  }
  return out;
}

function mergeProgress(
  local: Record<string, ProgressRecord>,
  remote: Record<string, ProgressRecord>
): Record<string, ProgressRecord> {
  const out: Record<string, ProgressRecord> = { ...local };
  for (const [id, r] of Object.entries(remote)) {
    const l = out[id];
    if (!l) {
      out[id] = r;
      continue;
    }
    const winner = (r.updatedAt ?? 0) > (l.updatedAt ?? 0) ? r : l;
    out[id] = {
      ...winner,
      // Never regress these:
      finishedAt:
        l.finishedAt && r.finishedAt
          ? Math.min(l.finishedAt, r.finishedAt)
          : (l.finishedAt ?? r.finishedAt) ?? undefined,
      lastReadAt:
        Math.max(l.lastReadAt ?? 0, r.lastReadAt ?? 0) || undefined,
      updatedAt: Math.max(l.updatedAt ?? 0, r.updatedAt ?? 0),
    };
  }
  return out;
}

function mergePins(
  local: Record<string, PinRecord>,
  remote: Record<string, PinRecord>
): Record<string, PinRecord> {
  const out: Record<string, PinRecord> = { ...local };
  for (const [id, r] of Object.entries(remote)) {
    const l = out[id];
    if (!l) {
      out[id] = r;
      continue;
    }
    const addedAt = Math.min(l.addedAt, r.addedAt);
    const touched = Math.max(l.updatedAt ?? 0, r.updatedAt ?? 0);

    if (l.removedAt && r.removedAt) {
      out[id] = {
        ...r,
        addedAt,
        removedAt: Math.max(l.removedAt, r.removedAt),
        updatedAt: touched,
      };
      continue;
    }
    if (l.removedAt && !r.removedAt) {
      // Local deleted; remote alive — a remote re-pin after the delete revives.
      const revived = (r.updatedAt ?? 0) > l.removedAt;
      out[id] = revived
        ? { ...r, addedAt, removedAt: null, updatedAt: touched }
        : { ...l, addedAt, updatedAt: touched };
      continue;
    }
    if (!l.removedAt && r.removedAt) {
      // Remote deleted; local alive — the delete wins unless local re-pinned after.
      const keepDelete = r.removedAt > (l.updatedAt ?? 0);
      out[id] = keepDelete
        ? { ...l, addedAt, removedAt: r.removedAt, updatedAt: touched }
        : { ...r, addedAt, removedAt: null, updatedAt: touched };
      continue;
    }
    // Both live — union.
    out[id] = {
      addedAt,
      pinnedAt: Math.max(l.pinnedAt ?? 0, r.pinnedAt ?? 0) || addedAt,
      removedAt: null,
      updatedAt: touched,
    };
  }
  // Old tombstones have served their purpose — drop them.
  const now = Date.now();
  for (const [id, rec] of Object.entries(out)) {
    if (rec.removedAt && rec.removedAt < now - TOMBSTONE_PRUNE_MS) delete out[id];
  }
  return out;
}

function mergeState(local: StatePayload, remote: StatePayload): StatePayload {
  return {
    schema: SCHEMA,
    progress: mergeProgress(local.progress, remote.progress),
    pins: mergePins(local.pins, remote.pins),
    readDays: { ...remote.readDays, ...local.readDays },
    readSeconds: maxMergeNumbers(remote.readSeconds, local.readSeconds),
  };
}

/** Applies merged state locally; events fired here must not echo back. */
function applyState(merged: StatePayload): void {
  applyingRemote = true;
  try {
    replaceProgress(merged.progress as Record<string, BookProgress>);
    // Pins: merge into entries this device knows, and CREATE the ones it
    // doesn't (fresh device) from the remote metadata — or, for the
    // metadata-less payloads older builds wrote, from the published catalog.
    // Unresolvable ids land on a later pull once the catalog has loaded.
    const current = loadAllPins();
    const byId = new Map<string, UserBook>(current.map((b) => [b.id, b]));
    for (const [id, rec] of Object.entries(merged.pins)) {
      const existing = byId.get(id);
      if (existing) {
        existing.pinnedAt = rec.pinnedAt ?? existing.addedAt;
        existing.removedAt = rec.removedAt;
        existing.updatedAt = Math.max(existing.updatedAt ?? 0, rec.updatedAt ?? 0);
        continue;
      }
      const made = materializePin(id, rec);
      if (made) byId.set(id, made);
    }
    replacePins([...byId.values()]);
    replaceReadDays(merged.readDays);
    replaceReadSeconds(merged.readSeconds);
  } finally {
    applyingRemote = false;
  }
}

/** Builds a library entry for a remote pin this device has never seen —
 *  from the record's own metadata (schema 3), falling back to the published
 *  catalog for payloads written by older builds. */
function materializePin(id: string, rec: PinRecord): UserBook | null {
  if (rec.title && rec.type && rec.url) {
    return {
      id,
      title: rec.title,
      type: rec.type,
      url: rec.url,
      ...(rec.author ? { author: rec.author } : {}),
      ...(rec.cover ? { cover: rec.cover } : {}),
      addedAt: rec.addedAt,
      pinnedAt: rec.pinnedAt ?? rec.addedAt,
      removedAt: rec.removedAt ?? null,
      updatedAt: rec.updatedAt ?? rec.addedAt,
    };
  }
  const cat = getCatalog().find((b) => b.id === id);
  if (!cat) return null;
  return {
    ...cat,
    addedAt: rec.addedAt,
    pinnedAt: rec.pinnedAt ?? rec.addedAt,
    removedAt: rec.removedAt ?? null,
    updatedAt: rec.updatedAt ?? rec.addedAt,
  };
}

/* ---------- pull / push ---------- */

async function pullRemoteState(): Promise<StatePayload | null> {
  const entry = await getVaultText(STATE_PATH, SYNC_BRANCH);
  vaultSha = entry?.sha ?? null;
  if (!entry?.content) return null;
  try {
    const data = JSON.parse(entry.content) as Partial<StatePayload>;
    // Schema 2 = +readSeconds; schema 1 payloads simply have none. Schema 3
    // additionally packs book metadata into pin records (pins without it
    // still resolve against the catalog — see materializePin).
    if (!data || (data.schema !== 1 && data.schema !== 2 && data.schema !== SCHEMA)) {
      return null;
    }
    return {
      schema: SCHEMA,
      progress: data.progress ?? {},
      pins: data.pins ?? {},
      readDays: data.readDays ?? {},
      readSeconds: data.readSeconds ?? {},
    };
  } catch {
    return null; // unreadable payload — start over with whatever local has
  }
}

async function pushState(): Promise<void> {
  const message = "Sync reading state (Leaf)";
  try {
    vaultSha = await putVaultText(STATE_PATH, buildPayload(lastRemote), {
      ref: SYNC_BRANCH,
      message,
      ...(vaultSha ? { sha: vaultSha } : {}),
    });
  } catch (err) {
    if (!(err instanceof VaultMissingRefError)) throw err;
    // First sync on this vault — bootstrap the branch and retry.
    await ensureVaultBranch(SYNC_BRANCH);
    vaultSha = await putVaultText(STATE_PATH, buildPayload(lastRemote), {
      ref: SYNC_BRANCH,
      message,
    });
  }
}

/** Pulls the remote, merges into local, persists. Emits status. */
export async function statePullAndMerge(): Promise<void> {
  if (!isVaultConnected()) return;
  const remote = await pullRemoteState();
  lastRemote = remote;
  const merged = mergeState(
    {
      schema: SCHEMA,
      progress: buildLocalProgress(),
      pins: buildLocalPins(),
      readDays: readDays(),
      readSeconds: readSecondsMap(),
    },
    remote ?? {
      schema: SCHEMA,
      progress: {},
      pins: {},
      readDays: {},
      readSeconds: {},
    }
  );
  applyState(merged);
  const last = { lastSyncedAt: Date.now() };
  writeLast(last);
  setStatus({ state: "connected", lastSyncedAt: last.lastSyncedAt });
}

async function doPush(): Promise<void> {
  if (!isVaultConnected()) return;
  setStatus({ state: "syncing", lastSyncedAt: status.lastSyncedAt });
  try {
    try {
      await pushState();
    } catch (err) {
      if (!(err instanceof VaultConflictError)) throw err;
      // Another device committed since our last read — merge and retry once.
      await statePullAndMerge();
      await pushState();
    }
    lastPushAt = Date.now();
    const last = { lastSyncedAt: Date.now() };
    writeLast(last);
    setStatus({ state: "connected", lastSyncedAt: last.lastSyncedAt });
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
  if (pushTimer !== undefined || !isVaultConnected()) return;
  const wait = Math.max(
    DEBOUNCE_MS,
    lastPushAt + PUSH_COOLDOWN_MS - Date.now()
  );
  pushTimer = window.setTimeout(() => {
    pushTimer = undefined;
    void doPush();
  }, wait);
}

function onStateChanged(): void {
  if (applyingRemote || !isVaultConnected()) return;
  schedulePush();
}

/* ---------- public API ---------- */

let startupQueued = false;

/** Called once from App: listens for local mutations and pulls once. */
export function initStateSync(): void {
  if (initialized) return;
  initialized = true;
  window.addEventListener(PROGRESS_SAVED_EVENT, onStateChanged);
  window.addEventListener(USER_BOOKS_CHANGED_EVENT, onStateChanged);
  // A pin whose book wasn't known yet (fresh device, catalog still loading)
  // resolves the moment books/catalog.json arrives.
  window.addEventListener(CATALOG_LOADED_EVENT, () => {
    void statePullAndMerge().catch(() => {
      // Silent: the next pull (focus, Sync now) retries anyway.
    });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !isVaultConnected()) return;
    if (Date.now() - lastFocusPullAt < FOCUS_PULL_COOLDOWN_MS) return;
    lastFocusPullAt = Date.now();
    void statePullAndMerge().catch(() => {
      // Silent on focus pulls: offline or transient — reading still works.
    });
  });
  if (isVaultConnected() && !startupQueued) {
    startupQueued = true;
    window.setTimeout(() => {
      void statePullAndMerge().catch(() => {
        // Silent on startup: offline or transient — reading still works.
      });
    }, 0);
  }
}

/** Manual converge: pull + merge, then push back. */
export async function stateSyncNow(): Promise<void> {
  if (!isVaultConnected()) return;
  setStatus({ state: "syncing", lastSyncedAt: status.lastSyncedAt });
  await statePullAndMerge();
  await doPush();
}