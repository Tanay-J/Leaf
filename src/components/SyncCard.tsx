import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Download,
  Loader2,
  LogOut,
  RefreshCw,
  Upload,
  X,
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
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

function Dot({ state }: { state: string }) {
  return <span className={`sync-dot sync-dot-${state}`} aria-hidden />;
}

/**
 * Compact 1-line Sync & Backup pill for the left rail footer that opens
 * a well-proportioned Sync & Backup modal when clicked.
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
      setNote("Books, stats & articles synced just now.");
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
    <>
      <button
        type="button"
        className="sync-pill-trigger"
        onClick={() => {
          setError("");
          setNote("");
          setOpen(true);
        }}
        title="Manage cross-device sync and local JSON backups"
      >
        <span className="sync-pill-trigger-left">
          <Dot state={dotState} />
          <span>Sync &amp; Backup</span>
        </span>
        <span className="sync-pill-trigger-meta">
          {isConnected
            ? `${profile.name}${lastSync ? ` · ${timeAgo(lastSync)}` : ""}`
            : "Setup"}
        </span>
      </button>

      {open && (
        <div
          className="modal-overlay"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Sync and Backup"
        >
          <div
            className="modal sync-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <strong style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Dot state={dotState} />
                Sync &amp; Backup
              </strong>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setOpen(false)}
                title="Close"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {isConnected ? (
              <div className="sync-modal-connected">
                <div className="sync-modal-profile-box">
                  <div>
                    <span className="sync-modal-eyebrow">Active Profile</span>
                    <strong className="sync-modal-profile-name">
                      {profile.name}
                    </strong>
                  </div>
                  <span className="sync-modal-timestamp">
                    {lastSync
                      ? `Last synced ${timeAgo(lastSync)} ago`
                      : "Ready to sync"}
                  </span>
                </div>
                <p className="modal-hint" style={{ margin: 0 }}>
                  Your books in progress, reading stats, and saved articles stay
                  in sync across devices signed in with this Name &amp; PIN.
                </p>
                <div className="sync-modal-actions-row">
                  <button
                    type="button"
                    className="add-article-btn"
                    onClick={() => void syncAll()}
                    disabled={busy}
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    {busy ? (
                      <Loader2 className="spin" size={14} />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    {busy ? "Syncing…" : "Sync Now"}
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={onSignOut}
                    disabled={busy}
                  >
                    <LogOut size={14} />
                    Sign Out
                  </button>
                </div>
              </div>
            ) : (
              <form
                className="sync-modal-form"
                onSubmit={(e) => void onConnectSubmit(e)}
              >
                <p className="modal-hint" style={{ margin: 0 }}>
                  Enter your Name &amp; PIN to sync the books you&apos;re
                  reading, reading stats, and saved articles across all your
                  devices.
                </p>

                <div className="field-row">
                  <label className="field">
                    <span>Your Name</span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (error) setError("");
                      }}
                      placeholder="e.g. tanay"
                      autoComplete="username"
                      autoFocus
                      required
                    />
                  </label>
                  <label className="field">
                    <span>PIN / Passphrase</span>
                    <input
                      type="password"
                      value={pin}
                      onChange={(e) => {
                        setPin(e.target.value);
                        if (error) setError("");
                      }}
                      placeholder="4+ characters"
                      autoComplete="current-password"
                      required
                    />
                  </label>
                </div>

                {needsPassphrase && vault.state !== "connected" && (
                  <label className="field">
                    <span>Library Passphrase (unlocks cloud sync)</span>
                    <input
                      type="password"
                      value={libraryPassphrase}
                      onChange={(e) => {
                        setLibraryPassphrase(e.target.value);
                        if (error) setError("");
                      }}
                      placeholder="Enter your library passphrase"
                    />
                  </label>
                )}

                {showRepoFallback && (
                  <div className="field-row">
                    <label className="field">
                      <span>Storage Repo (owner/name)</span>
                      <input
                        type="text"
                        value={customRepo}
                        onChange={(e) => setCustomRepo(e.target.value)}
                        placeholder="owner/book-vault"
                      />
                    </label>
                    <label className="field">
                      <span>GitHub Token (Read/Write)</span>
                      <input
                        type="password"
                        value={customToken}
                        onChange={(e) => setCustomToken(e.target.value)}
                        placeholder="github_pat_…"
                      />
                    </label>
                  </div>
                )}

                <button
                  type="submit"
                  className="add-article-btn"
                  disabled={busy}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  {busy ? (
                    <Loader2 className="spin" size={15} />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  {busy ? "Connecting…" : "Sync My Reading"}
                </button>
              </form>
            )}

            {error && <p className="article-error">{error}</p>}
            {note && <p className="sync-note">{note}</p>}

            <div className="sync-modal-backup-bar">
              <span className="sync-modal-backup-label">
                Manual JSON Backup
              </span>
              <div className="sync-modal-backup-btns">
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
          </div>
        </div>
      )}
    </>
  );
}
