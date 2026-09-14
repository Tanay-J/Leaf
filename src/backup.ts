/**
 * Full-library backup: every leaf-owned localStorage key in one JSON file,
 * with a matching restore. Token-bearing keys are excluded on purpose —
 * GitHub PATs are per-browser secrets and should never leave the device.
 *
 * Not covered (by design): device-file books and cached article content,
 * which live in IndexedDB and never leave the browser.
 */

const TOKEN_KEYS = new Set([
  "leaf:vault", // GitHub token + repo config for vault uploads
  "leaf:sync", // gist token (legacy article sync)
]);

const PREF_KEYS = new Set([
  "reader-theme",
  "reader-sidebar-open",
  "library-view",
  "library-sort",
  "article-font",
  "article-font-family",
  "article-line-height",
]);

const LEAF_PREFIX = "leaf:";
const PROGRESS_PREFIX = "reader:";

function ownedKey(key: string): boolean {
  return (
    key.startsWith(LEAF_PREFIX) ||
    key.startsWith(PROGRESS_PREFIX) ||
    PREF_KEYS.has(key)
  );
}

export interface BackupFile {
  app: "leaf";
  version: 1;
  exportedAt: number;
  data: Record<string, string>;
}

export function exportBackup(): BackupFile {
  const data: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !ownedKey(key) || TOKEN_KEYS.has(key)) continue;
      const value = localStorage.getItem(key);
      if (value != null) data[key] = value;
    }
  } catch {
    /* storage unavailable — return what we have */
  }
  return { app: "leaf", version: 1, exportedAt: Date.now(), data };
}

export function downloadBackup(): void {
  const blob = new Blob([JSON.stringify(exportBackup(), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leaf-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export interface RestoreResult {
  restored: number;
  skippedTokens: number;
  wrongApp: boolean;
}

/**
 * Restores a backup into localStorage. The browser stays the source of
 * truth: values overwrite matching keys, everything else is left alone.
 * Callers reload the page afterwards so all UI state re-reads.
 */
export function restoreBackup(raw: string): RestoreResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const file = parsed as Partial<BackupFile>;
  if (file?.app !== "leaf" || typeof file.data !== "object" || !file.data) {
    throw new Error("That doesn't look like a Leaf backup file.");
  }
  let restored = 0;
  let skippedTokens = 0;
  for (const [key, value] of Object.entries(file.data)) {
    if (typeof value !== "string") continue;
    if (TOKEN_KEYS.has(key)) {
      skippedTokens++;
      continue;
    }
    if (!ownedKey(key)) continue;
    try {
      localStorage.setItem(key, value);
      restored++;
    } catch {
      /* storage unavailable */
    }
  }
  return { restored, skippedTokens, wrongApp: false };
}