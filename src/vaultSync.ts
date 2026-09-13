/**
 * Upload books from the browser into the private content vault — the repo
 * whose files CI encrypts and publishes on GitHub Pages (see
 * .github/workflows/deploy.yml and scripts/encrypt-books.mjs).
 *
 * Unlike device-local books (src/localBooks.ts), a vault upload is the
 * cross-device path: once the deploy finishes, the book shows up under
 * Browse on every device.
 *
 * Auth is a fine-grained GitHub personal access token scoped to the vault
 * repo with only "Contents: Read and write", stored in localStorage (same
 * threat model as the article-sync gist token in src/articleSync.ts).
 *
 * Flow:
 *   - dedupe against the vault's current files (same name + size → skip)
 *   - PUT /contents/<name> with base64 content (XHR for upload progress)
 *   - optionally upsert the file into books.json with the given title/author
 *   - optionally watch the Leaf deploy run until it completes
 *
 * The vault holds PLAINTEXT book files by design (it is private); encryption
 * to the public site happens in CI with BOOKS_PASSPHRASE.
 */

export interface VaultConfig {
  /** Fine-grained PAT with Contents: Read and write on the vault repo only. */
  token: string;
  /** The vault as "owner/name". */
  repo: string;
  /** Optional: this repo as "owner/name", to watch deploys after an upload. */
  leafRepo?: string;
  /** Optional: PAT with Actions: Read on leafRepo. The vault's auto-deploy
   *  trigger token (Actions: Read and write) works for this. */
  leafToken?: string;
}

export type VaultState = "disconnected" | "connecting" | "connected" | "error";

export interface VaultStatus {
  state: VaultState;
  repo?: string;
  lastError?: string;
}

export type VaultUploadResult =
  | {
      ok: true;
      fileName: string;
      /** Replaced an existing vault file with different content. */
      replaced: boolean;
      /** The same file (name + size) was already in the vault. */
      skipped: boolean;
      /** books.json could not be updated — the book itself still uploaded. */
      metaWarning?: string;
    }
  | { ok: false; error: string };

export interface DeployWatch {
  /** "success" / "failure" / … once completed; null when it couldn't be watched. */
  conclusion: string | null;
  error?: string;
}

const STORAGE_KEY = "leaf:vault";
const API = "https://api.github.com";
/** The Contents API rejects anything larger. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const POLL_MS = 10_000;
const WATCH_TIMEOUT_MS = 10 * 60_000;

/** Fired on every status change; the Library modal listens to re-render. */
export const VAULT_STATUS_EVENT = "leaf:vault-status";

let config: VaultConfig | null = readConfig();
let status: VaultStatus = config
  ? { state: "connected", repo: config.repo }
  : { state: "disconnected" };

/* ---------- config / status ---------- */

function readConfig(): VaultConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<VaultConfig>;
    if (!c || typeof c.token !== "string" || typeof c.repo !== "string") {
      return null;
    }
    return {
      token: c.token,
      repo: c.repo,
      ...(typeof c.leafRepo === "string" && typeof c.leafToken === "string"
        ? { leafRepo: c.leafRepo, leafToken: c.leafToken }
        : {}),
    };
  } catch {
    return null;
  }
}

function writeConfig(c: VaultConfig | null): void {
  config = c;
  try {
    if (c) localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

function setStatus(next: VaultStatus): void {
  status = next;
  try {
    window.dispatchEvent(
      new CustomEvent<VaultStatus>(VAULT_STATUS_EVENT, { detail: { ...next } })
    );
  } catch {
    /* SSR / unavailable */
  }
}

export function getVaultStatus(): VaultStatus {
  return { ...status };
}

export function isVaultConnected(): boolean {
  return status.state === "connected";
}

/** True when uploads can also poll the Leaf deploy run for live progress. */
export function canWatchDeploys(): boolean {
  return !!(config?.leafRepo && config?.leafToken);
}

/* ---------- GitHub API helpers ---------- */

async function gh(
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
}

function statusError(status: number, detail = ""): string {
  if (status === 401) {
    return "The token was rejected (401) — is it valid and unexpired?";
  }
  if (status === 403) {
    if (/rate limit/i.test(detail)) {
      return "GitHub rate limit hit — try again in a few minutes.";
    }
    return `GitHub refused the request (403)${detail ? ` — ${detail}` : ""}. Does the token have Contents: Read and write on the vault?`;
  }
  if (status === 404) {
    return "Repo not found (404) — check owner/name, and that the token's Repository access includes it.";
  }
  if (status === 409) {
    return "GitHub reported a conflict (409) — the file changed meanwhile; try again.";
  }
  if (status === 422) {
    return `GitHub rejected the upload (422)${detail ? ` — ${detail}` : ""}.`;
  }
  return `GitHub returned ${status}${detail ? ` — ${detail}` : ""}.`;
}

async function responseError(res: Response): Promise<string> {
  let detail = "";
  try {
    const data = (await res.json()) as { message?: string };
    if (data?.message) detail = data.message;
  } catch {
    /* body was not JSON */
  }
  return statusError(res.status, detail);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------- encoding ---------- */

const B64_CHUNK = 3 * 0x80000; // multiple of 3 so base64 groups concatenate cleanly

/** Chunked Blob → base64 (avoids giant readAsDataURL strings). */
async function blobToBase64(blob: Blob): Promise<string> {
  let out = "";
  for (let offset = 0; offset < blob.size; offset += B64_CHUNK) {
    const buf = await blob.slice(offset, offset + B64_CHUNK).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const STEP = 0x8000;
    for (let i = 0; i < bytes.length; i += STEP) {
      binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
    }
    out += btoa(binary);
  }
  return out;
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToText(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ---------- vault interactions ---------- */

interface VaultEntry {
  name: string;
  sha?: string;
  size: number;
}

/** One listing of the vault root — the books live flat at its top level. */
async function listVaultRoot(
  token: string,
  repo: string
): Promise<VaultEntry[]> {
  const res = await gh(`/repos/${repo}/contents/`, { token });
  if (!res.ok) throw new Error(await responseError(res));
  const items = (await res.json()) as Array<{
    name?: string;
    type?: string;
    sha?: string;
    size?: number;
  }>;
  if (!Array.isArray(items)) return [];
  return items
    .filter((it) => it.type === "file" && typeof it.name === "string")
    .map((it) => ({
      name: it.name as string,
      sha: it.sha,
      size: it.size ?? 0,
    }));
}

/** PUT /contents — via XHR so the caller gets upload-progress events. */
function putContents(
  repo: string,
  fileName: string,
  token: string,
  body: { message: string; content: string; sha?: string },
  onProgress?: (pct: number) => void
): Promise<{ status: number; message: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "PUT",
      `${API}/repos/${repo}/contents/${encodeURIComponent(fileName)}`
    );
    xhr.setRequestHeader("Accept", "application/vnd.github+json");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        // e.total includes the JSON/base64 wrapper; hold at 99 until the
        // server answers so the UI never claims "done" too early.
        onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      }
    };
    xhr.onload = () => {
      onProgress?.(100);
      let message = "";
      try {
        const data = JSON.parse(xhr.responseText) as { message?: string };
        if (data?.message) message = data.message;
      } catch {
        /* empty body */
      }
      resolve({ status: xhr.status, message });
    };
    xhr.onerror = () =>
      reject(
        new Error("Network error while uploading — check your connection.")
      );
    xhr.send(JSON.stringify(body));
  });
}

/**
 * Adds (or updates) the file's entry in the vault's optional books.json so
 * the title/author survive CI. Non-fatal by design — returns a warning
 * string when it couldn't, undefined when everything is fine.
 */
async function upsertBooksJson(
  token: string,
  repo: string,
  fileName: string,
  meta: { title?: string; author?: string }
): Promise<string | undefined> {
  try {
    const metaMap: Record<string, { title?: string; author?: string }> = {};
    let sha: string | undefined;
    const res = await gh(`/repos/${repo}/contents/books.json`, { token });
    if (res.ok) {
      const entry = (await res.json()) as { sha?: string; content?: string };
      sha = entry.sha;
      if (entry.content) {
        try {
          const parsed = JSON.parse(
            base64ToText(entry.content)
          ) as Record<string, unknown>;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            for (const [k, v] of Object.entries(parsed)) {
              if (v && typeof v === "object" && !Array.isArray(v)) {
                metaMap[k] = v as { title?: string; author?: string };
              }
            }
          }
        } catch {
          /* unreadable books.json — a fresh one is written below */
        }
      }
    } else if (res.status !== 404) {
      return `Uploaded, but books.json couldn't be read (GitHub ${res.status}).`;
    }

    const entryMeta: { title?: string; author?: string } = {};
    if (meta.title?.trim()) entryMeta.title = meta.title.trim();
    if (meta.author?.trim()) entryMeta.author = meta.author.trim();
    if (Object.keys(entryMeta).length === 0) return undefined; // nothing to add

    metaMap[fileName] = { ...metaMap[fileName], ...entryMeta };
    const put = await putContents(repo, "books.json", token, {
      message: `Update books.json for ${fileName} (from Leaf)`,
      content: utf8ToBase64(`${JSON.stringify(metaMap, null, 2)}\n`),
      ...(sha ? { sha } : {}),
    });
    if (put.status !== 200 && put.status !== 201) {
      return `Uploaded, but books.json couldn't be updated (GitHub ${put.status}). The title will come from the filename.`;
    }
    return undefined;
  } catch (err) {
    return `Uploaded, but books.json couldn't be updated (${
      err instanceof Error ? err.message : "error"
    }).`;
  }
}

/* ---------- public API ---------- */

/**
 * Connect a device: validate the token against GitHub, confirm it can write
 * to the vault, and (optionally) that the Leaf repo is watchable. Nothing
 * else is stored besides this config.
 */
export async function vaultConnect(input: {
  token: string;
  repo: string;
  leafRepo?: string;
  leafToken?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = input.token.trim();
  const repo = input.repo.trim().replace(/^\/+|\/+$/g, "");
  const leafRepo = input.leafRepo?.trim().replace(/^\/+|\/+$/g, "") || undefined;

  if (!token) {
    return {
      ok: false,
      error:
        "Paste a fine-grained token with Contents: Read and write on the vault.",
    };
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    return { ok: false, error: "Vault repo must look like owner/name." };
  }
  if (leafRepo && !/^[^/\s]+\/[^/\s]+$/.test(leafRepo)) {
    return {
      ok: false,
      error: "Leaf repo must look like owner/name (or leave it empty).",
    };
  }

  setStatus({ state: "connecting", repo });
  try {
    const userRes = await gh("/user", { token });
    if (!userRes.ok) throw new Error(await responseError(userRes));

    const repoRes = await gh(`/repos/${repo}`, { token });
    if (!repoRes.ok) throw new Error(await responseError(repoRes));
    const info = (await repoRes.json()) as { permissions?: { push?: boolean } };
    if (info.permissions && info.permissions.push === false) {
      throw new Error(
        "That token can read the vault but not write — grant Contents: Read and write."
      );
    }

    let leafToken: string | undefined;
    if (leafRepo) {
      leafToken = input.leafToken?.trim() || undefined;
      const leafRes = await gh(`/repos/${leafRepo}`, {
        token: leafToken ?? token,
      });
      if (!leafRes.ok) throw new Error(await responseError(leafRes));
    }

    writeConfig({
      token,
      repo,
      ...(leafRepo && leafToken ? { leafRepo, leafToken } : {}),
    });
    setStatus({ state: "connected", repo });
    return { ok: true };
  } catch (err) {
    setStatus({
      state: "disconnected",
      lastError: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function vaultDisconnect(): void {
  writeConfig(null);
  setStatus({ state: "disconnected" });
}

/**
 * Uploads a picked file to the vault root. Same name + same size counts as
 * "already there" (skipped); a different size is committed as a replacement.
 * `onProgress` reports upload percentage (0–100) while the request runs.
 */
export async function uploadToVault(
  file: File,
  meta: { title?: string; author?: string } = {},
  onProgress?: (pct: number) => void
): Promise<VaultUploadResult> {
  const cfg = config;
  if (!cfg) {
    return {
      ok: false,
      error: "Connect the vault first — see “Upload books to your vault”.",
    };
  }

  const fileName = file.name.split(/[\\/]/).pop() ?? file.name;
  if (!/\.(epub|pdf)$/i.test(fileName)) {
    return {
      ok: false,
      error: "Only .epub and .pdf files can be uploaded to the vault.",
    };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error:
        "That file is over the 100 MB GitHub API limit — drop it on github.com instead (vault → Add file → Upload files).",
    };
  }

  try {
    onProgress?.(2);
    const entries = await listVaultRoot(cfg.token, cfg.repo);
    const existing = entries.find((e) => e.name === fileName);
    const content = await blobToBase64(file);
    onProgress?.(5); // encoded; the XHR takes over from here

    if (existing && existing.size === file.size) {
      const metaWarning = await upsertBooksJson(
        cfg.token,
        cfg.repo,
        fileName,
        meta
      );
      return {
        ok: true,
        fileName,
        replaced: false,
        skipped: true,
        ...(metaWarning ? { metaWarning } : {}),
      };
    }

    const attempt = (sha?: string) =>
      putContents(
        cfg.repo,
        fileName,
        cfg.token,
        {
          message: sha
            ? `Update ${fileName} (from Leaf)`
            : `Add ${fileName} (from Leaf)`,
          content,
          ...(sha ? { sha } : {}),
        },
        onProgress
      );

    let put = await attempt(existing?.sha);
    if (put.status === 409) {
      // The vault moved underneath us — re-list and retry once with the
      // current sha. A missing entry means it vanished; surface the conflict.
      const fresh = (await listVaultRoot(cfg.token, cfg.repo)).find(
        (e) => e.name === fileName
      );
      if (!fresh) return { ok: false, error: statusError(409) };
      put = await attempt(fresh.sha);
    }
    if (put.status !== 200 && put.status !== 201) {
      return { ok: false, error: statusError(put.status, put.message) };
    }

    const metaWarning = await upsertBooksJson(
      cfg.token,
      cfg.repo,
      fileName,
      meta
    );
    return {
      ok: true,
      fileName,
      replaced: !!existing,
      skipped: false,
      ...(metaWarning ? { metaWarning } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Waits for the Leaf deploy run created after `startedAt` to complete.
 * Only meaningful when canWatchDeploys() is true.
 */
export async function waitForDeploy(
  startedAt: number,
  timeoutMs = WATCH_TIMEOUT_MS
): Promise<DeployWatch> {
  const cfg = config;
  const leafRepo = cfg?.leafRepo;
  const leafToken = cfg?.leafToken;
  if (!leafRepo || !leafToken) {
    return {
      conclusion: null,
      error: "Deploy watching isn't set up (add the Leaf repo + token).",
    };
  }

  const deadline = Date.now() + timeoutMs;
  const startedAfter = (iso?: string): boolean =>
    !!iso && Date.parse(iso) >= startedAt - 5_000;
  const tick = async (): Promise<void> =>
    sleep(Math.min(POLL_MS, Math.max(2_000, deadline - Date.now())));

  while (Date.now() < deadline) {
    const res = await gh(`/repos/${leafRepo}/actions/runs?per_page=30`, {
      token: leafToken,
    });
    if (res.ok) {
      const data = (await res.json()) as {
        workflow_runs?: Array<{
          id: number;
          status?: string;
          conclusion?: string | null;
          created_at?: string;
        }>;
      };
      const run = (data.workflow_runs ?? [])
        .filter((r) => startedAfter(r.created_at))
        .sort(
          (a, b) =>
            Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "")
        )[0];
      if (run) {
        // Our run exists — poll it directly until it completes.
        while (Date.now() < deadline) {
          const runRes = await gh(
            `/repos/${leafRepo}/actions/runs/${run.id}`,
            { token: leafToken }
          );
          if (runRes.ok) {
            const cur = (await runRes.json()) as {
              status?: string;
              conclusion?: string | null;
            };
            if (cur.status === "completed") {
              return { conclusion: cur.conclusion ?? "unknown" };
            }
          } else if (runRes.status === 403 || runRes.status === 404) {
            return {
              conclusion: null,
              error:
                "Lost access to deploy runs — the Leaf token needs Actions: Read.",
            };
          }
          await tick();
        }
        break;
      }
      // No run yet — the vault's auto-trigger may need a few seconds.
    } else if (res.status === 403 || res.status === 404) {
      return {
        conclusion: null,
        error:
          "Can't read deploy runs — the Leaf token needs Actions: Read on this repo.",
      };
    }
    await tick();
  }
  return {
    conclusion: null,
    error:
      "The deploy didn't finish in 10 minutes — it may still be running; check Browse in a bit.",
  };
}