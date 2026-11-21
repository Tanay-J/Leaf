import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ChevronDown,
  Download,
  Loader2,
  LogOut,
  RefreshCw,
  Upload,
} from "lucide-react";
import { getSyncStatus, syncNow, type SyncStatus } from "../articleSync";
import { getStoredPassphrase } from "../bookCrypto";
import {
  getStateSyncStatus,
  isStateSyncActive,
  stateSyncNow,
  STATE_SYNC_STATUS_EVENT,
  type StateSyncStatus,
} from "../stateSync";
import {
  connectProfile,
  disconnectProfile,
  getSyncProfile,
  getVaultStatus,
  VAULT_STATUS_EVENT,
  type SyncProfile,
  type VaultStatus,
} from "../vaultSync";
import { downloadBackup, restoreBackup } from "../backup";

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
 * Unified Name + PIN cross-device sync (books in progress, reading stats,
 * and saved articles) plus one-click JSON export/import backup.
 */
export default function SyncCard() {
  const [open, setOpen] = useState(false);
  const [vault, setVault] = useState<VaultStatus>(() => getVaultStatus());
  const [profile, setProfile] = useState<SyncProfile | null>(() =>
    getSyncProfile()
  );
  const [state, setState] = useState<StateSyncStatus>(() =>
    getStateSyncStatus()
  );
  const [articles, setArticles] = useState<SyncStatus>(() => getSyncStatus());

  const [name, setName] = useState(() => getSyncProfile()?.name ?? "");
  const [pin, setPin] = useState("");
  const [libraryPassphrase, setLibraryPassphrase] = useState("");
  const [needsPassphrase, setNeedsPassphrase] = useState(
    () => !getStoredPassphrase() && getVaultStatus().state !== "connected"
  );
  const [showRepoFallback, setShowRepoFallback] = useState(false);
  const [customRepo, setCustomRepo] = useState("");
  const [customToken, setCustomToken] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onVault = () => {
      setVault(getVaultStatus());
      setProfile(getSyncProfile());
    };
    const onState = () => setState(getStateSyncStatus());
    const onArticles = (e: Event) =>
      setArticles({ ...(e as CustomEvent<SyncStatus>).detail });
    window.addEventListener(VAULT_STATUS_EVENT, onVault);
    window.addEventListener(STATE_SYNC_STATUS_EVENT, onState);
    window.addEventListener("leaf:sync-status", onArticles);
    return () => {
      window.removeEventListener(VAULT_STATUS_EVENT, onVault);
      window.removeEventListener(STATE_SYNC_STATUS_EVENT, onState);
      window.removeEventListener("leaf:sync-status", onArticles);
    };
  }, []);

  const syncAll = async () => {
    setBusy(true);
    setNote("");
    setError("");
    try {
      await Promise.all([stateSyncNow(), syncNow()]);
      setNote("Books, stats & articles synced.");
    } catch {
      setError("Sync failed — check your connection and try again.");
    }
    setBusy(false);
  };

  const onConnectSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNote("");
    const res = await connectProfile({
      name,
      pin,
      libraryPassphrase: libraryPassphrase || undefined,
      customRepo: customRepo || undefined,
      customToken: customToken || undefined,
    });
    if (!res.ok) {
      if (res.needsPassphrase) setNeedsPassphrase(true);
      if (res.needsRepoSetup) setShowRepoFallback(true);
      setError(res.error);
      setBusy(false);
      return;
    }
    setPin("");
    setLibraryPassphrase("");
    setCustomToken("");
    setProfile(res.profile);
    try {
      await Promise.all([stateSyncNow(), syncNow()]);
      setNote(`Connected as ${res.profile.name} — synced across devices.`);
    } catch {
      setNote(`Connected as ${res.profile.name}.`);
    }
    setBusy(false);
  };

  const onSignOut = () => {
    disconnectProfile();
    setProfile(null);
    setNote("Signed out of profile sync on this device.");
    setError("");
  };

  const onImportPicked = async (file: File) => {
    setNote("");
    setError("");
    try {
      const res = restoreBackup(await file.text());
      setNote(
        `Restored ${res.restored} item${res.restored === 1 ? "" : "s"} — reloading…`
      );
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    }
  };

  const isConnected = vault.state === "connected" && !!profile;
  const lastSync =
    Math.max(state.lastSyncedAt ?? 0, articles.lastSyncedAt ?? 0) || null;
  const dotState = isConnected
    ? state.state === "error" || articles.state === "error"
      ? "error"
      : state.state === "syncing" || articles.state === "syncing"
        ? "syncing"
        : "connected"
    : isStateSyncActive()
      ? state.state
      : "disconnected";

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
          <Dot state={dotState} />
          <strong>
            {isConnected ? `Synced · ${profile.name}` : "Sync & Backup"}
          </strong>
        </span>
        <ChevronDown
          size={15}
          className={`chev${open ? " up" : ""}`}
          aria-hidden
        />
      </summary>

      <div className="sync-diag-body">
        {isConnected ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 12,
              }}
            >
              <span>
                Profile: <strong>{profile.name}</strong>
              </span>
              <span style={{ opacity: 0.75 }}>
                {lastSync ? `Synced ${timeAgo(lastSync)}` : "Ready"}
              </span>
            </div>
            <p className="vault-note" style={{ margin: 0 }}>
              Syncing your books in progress, reading stats, and saved articles.
            </p>
            <div className="backup-row">
              <button
                type="button"
                className="secondary-action"
                onClick={() => void syncAll()}
                disabled={busy}
                title="Pull, merge, and push books, stats, and articles now"
              >
                {busy ? (
                  <Loader2 className="spin" size={13} />
                ) : (
                  <RefreshCw size={13} />
                )}
                Sync now
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={onSignOut}
                disabled={busy}
                title="Sign out of this sync profile on this device"
              >
                <LogOut size={13} />
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => void onConnectSubmit(e)}
            style={{ display: "flex", flexDirection: "column", gap: 7 }}
          >
            <p className="vault-note" style={{ margin: 0 }}>
              Sync books you&apos;re reading, stats, and saved articles across
              devices with your Name &amp; PIN.
            </p>
            <input
              type="text"
              className="sync-token-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError("");
              }}
              placeholder="Your Name (e.g. tanay)"
              aria-label="Sync profile name"
              autoComplete="username"
              required
            />
            <input
              type="password"
              className="sync-token-input"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                if (error) setError("");
              }}
              placeholder="PIN or passphrase (4+ chars)"
              aria-label="Sync PIN or passphrase"
              autoComplete="current-password"
              required
            />
            {needsPassphrase && vault.state !== "connected" && (
              <input
                type="password"
                className="sync-token-input"
                value={libraryPassphrase}
                onChange={(e) => {
                  setLibraryPassphrase(e.target.value);
                  if (error) setError("");
                }}
                placeholder="Library Passphrase (unlocks cloud)"
                aria-label="Library passphrase"
              />
            )}
            {showRepoFallback && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  paddingTop: 4,
                }}
              >
                <input
                  type="text"
                  className="sync-token-input"
                  value={customRepo}
                  onChange={(e) => setCustomRepo(e.target.value)}
                  placeholder="Storage repo (owner/name)"
                  aria-label="Storage repository"
                />
                <input
                  type="password"
                  className="sync-token-input"
                  value={customToken}
                  onChange={(e) => setCustomToken(e.target.value)}
                  placeholder="GitHub token (Contents: Read/Write)"
                  aria-label="GitHub token"
                />
              </div>
            )}
            <button
              type="submit"
              className="add-article-btn"
              disabled={busy}
              style={{ justifyContent: "center", width: "100%" }}
            >
              {busy ? (
                <Loader2 className="spin" size={14} />
              ) : (
                <RefreshCw size={14} />
              )}
              {busy ? "Connecting…" : "Sync My Reading"}
            </button>
          </form>
        )}

        {error && <p className="article-error">{error}</p>}
        {note && <p className="sync-note">{note}</p>}

        <div
          className="backup-row"
          style={{
            borderTop: "1px solid var(--border-subtle, rgba(128,128,128,0.18))",
            paddingTop: 8,
            marginTop: 4,
          }}
        >
          <button
            type="button"
            className="secondary-action"
            onClick={downloadBackup}
            title="Download books progress, pins, articles, and stats as JSON"
          >
            <Download size={13} />
            Export JSON
          </button>
          <button
            type="button"
            className="secondary-action"
            onClick={() => fileRef.current?.click()}
            title="Restore a Leaf JSON backup file"
          >
            <Upload size={13} />
            Import JSON
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
      </div>
    </details>
  );
}
