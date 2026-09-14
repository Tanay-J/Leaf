import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { getSyncStatus, syncNow, type SyncStatus } from "../articleSync";
import {
  getStateSyncStatus,
  isStateSyncActive,
  stateSyncNow,
  STATE_SYNC_STATUS_EVENT,
  type StateSyncStatus,
} from "../stateSync";
import { getVaultStatus, type VaultStatus } from "../vaultSync";
import { downloadBackup, restoreBackup } from "../backup";
import { navigate } from "../lib";

function timeAgo(ts: number | null): string {
  if (ts == null) return "never";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function Dot({ state }: { state: string }) {
  return <span className={`sync-dot sync-dot-${state}`} aria-hidden />;
}

/**
 * Diagnostics for everything that leaves the browser, plus one-click
 * export/import of a full settings+progress backup. Rendered collapsed
 * inside My library; every row links to where its feature lives.
 */
export default function SyncCard() {
  const [open, setOpen] = useState(false);
  const [vault] = useState<VaultStatus>(() => getVaultStatus());
  const [state, setState] = useState<StateSyncStatus>(() =>
    getStateSyncStatus()
  );
  const [articles, setArticles] = useState<SyncStatus>(() => getSyncStatus());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onState = () => setState(getStateSyncStatus());
    const onArticles = (e: Event) =>
      setArticles({ ...(e as CustomEvent<SyncStatus>).detail });
    window.addEventListener(STATE_SYNC_STATUS_EVENT, onState);
    window.addEventListener("leaf:sync-status", onArticles);
    return () => {
      window.removeEventListener(STATE_SYNC_STATUS_EVENT, onState);
      window.removeEventListener("leaf:sync-status", onArticles);
    };
  }, []);

  const syncAll = async () => {
    setBusy(true);
    setNote("");
    try {
      await Promise.allSettled([stateSyncNow(), syncNow()]);
      setNote("Synced just now.");
    } catch {
      setNote("Sync failed — check the statuses below.");
    }
    setBusy(false);
  };

  const onImportPicked = async (file: File) => {
    setNote("");
    try {
      const res = restoreBackup(await file.text());
      setNote(
        `Restored ${res.restored} item${res.restored === 1 ? "" : "s"}` +
          (res.skippedTokens
            ? ` (skipped ${res.skippedTokens} token key(s))`
            : "") +
          " — reloading…"
      );
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Import failed.");
    }
  };

  return (
    <details className="sync-card sync-diagnostics" open={open}>
      <summary
        className="sync-card-head"
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        <span className="sync-card-head-left">
          <Dot state={isStateSyncActive() ? state.state : "disconnected"} />
          <strong>Sync &amp; backup</strong>
        </span>
        <ChevronDown size={15} className={`chev${open ? " up" : ""}`} aria-hidden />
      </summary>

      <div className="sync-diag-body">
        <ul className="diag-list">
          <li>
            <span className="diag-label">Vault (book uploads)</span>
            <span className="diag-value">
              <Dot state={vault.state} />
              {vault.state === "connected" && vault.repo
                ? `connected · ${vault.repo}`
                : vault.state === "error"
                  ? "error — check the token"
                  : "not connected"}
            </span>
          </li>
          <li>
            <span className="diag-label">
              Progress &amp; pins{" "}
              <button
                className="link-btn"
                onClick={() => void syncAll()}
                disabled={busy || !isStateSyncActive()}
                title="Pull, merge, and push book state now"
              >
                {busy ? (
                  <Loader2 className="spin" size={12} />
                ) : (
                  <RefreshCw size={12} />
                )}
                Sync now
              </button>
            </span>
            <span className="diag-value">
              <Dot state={isStateSyncActive() ? state.state : "disconnected"} />
              {isStateSyncActive()
                ? state.state === "error"
                  ? state.lastError ?? "error — will retry"
                  : `synced ${timeAgo(state.lastSyncedAt)}`
                : "connect your vault to enable"}
            </span>
          </li>
          <li>
            <span className="diag-label">
              Reading list{" "}
              <button
                className="link-btn"
                onClick={() => navigate("#/articles")}
                title="Open the reading list to manage article sync"
              >
                manage
              </button>
            </span>
            <span className="diag-value">
              <Dot state={articles.state} />
              {articles.state === "disconnected"
                ? "not connected"
                : `synced ${timeAgo(articles.lastSyncedAt)}`}
            </span>
          </li>
        </ul>

        {note && <p className="sync-note">{note}</p>}

        <div className="backup-row">
          <button
            className="secondary-action"
            onClick={downloadBackup}
            title="Download settings, progress, pins, and reading stats as JSON"
          >
            <Download size={14} />
            Export backup
          </button>
          <button
            className="secondary-action"
            onClick={() => fileRef.current?.click()}
            title="Restore a Leaf backup file"
          >
            <Upload size={14} />
            Import backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onImportPicked(f);
            }}
          />
        </div>
        <p className="vault-note">
          Backups cover everything in this browser except device-file books and
          GitHub tokens (those never leave the device).
        </p>
      </div>
    </details>
  );
}
