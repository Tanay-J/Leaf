import { useEffect, useState, type FormEvent } from "react";
import {
  BookOpen,
  Link2,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  Trash2,
  Unplug,
} from "lucide-react";
import {
  addArticle,
  loadArticles,
  removeArticle,
  type SavedArticle,
} from "../articles";
import {
  getSyncStatus,
  syncConnect,
  syncDisconnect,
  syncNow,
  type SyncStatus,
} from "../articleSync";
import { navigate, type Theme } from "../lib";
import ThemeButton from "./ThemeButton";

interface Props {
  theme: Theme;
  onCycleTheme: () => void;
  /** Set when the user arrived via #/add?url with an invalid URL. */
  initialError?: boolean;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function ArticlesList({
  theme,
  onCycleTheme,
  initialError,
}: Props) {
  const [articles, setArticles] = useState<SavedArticle[]>(() =>
    loadArticles()
  );
  const [url, setUrl] = useState("");
  const [error, setError] = useState(
    initialError ? "That doesn’t look like a valid link." : ""
  );

  /* Cross-device sync UI state. */
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() =>
    getSyncStatus()
  );
  const [token, setToken] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [connectError, setConnectError] = useState("");

  useEffect(() => {
    const onStatus = (e: Event) =>
      setSyncStatus({ ...(e as CustomEvent<SyncStatus>).detail });
    window.addEventListener("leaf:sync-status", onStatus);
    return () => window.removeEventListener("leaf:sync-status", onStatus);
  }, []);

  const connect = async () => {
    setSyncBusy(true);
    setConnectError("");
    const res = await syncConnect(token);
    if (!res.ok) {
      setConnectError(res.error);
    } else {
      setToken("");
      setArticles(loadArticles());
    }
    setSyncBusy(false);
  };

  const manualSync = async () => {
    setSyncBusy(true);
    await syncNow();
    setArticles(loadArticles());
    setSyncBusy(false);
  };

  const disconnect = () => {
    syncDisconnect();
    setConnectError("");
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    try {
      const { article } = addArticle(url.trim());
      setUrl("");
      setError("");
      // Refresh so a duplicate stays put and a fresh save appears at the top.
      setArticles(loadArticles());
      navigate(`#/article/${article.id}`);
    } catch {
      setError("That doesn’t look like a valid link.");
    }
  };

  const remove = (id: string) => {
    removeArticle(id);
    setArticles(loadArticles());
  };

  /* "Save to Leaf" bookmarklet, generated against the app's own URL so it
     works from any deployment (localhost, a GitHub Pages subpath, …). */
  const appBase = `${window.location.origin}${window.location.pathname}`;
  const bookmarklet = `javascript:(function(){var%20u=encodeURIComponent(location.href);var%20w=window.open('${appBase}#/add?url='+u,'_blank');if(!w)location.href='${appBase}#/add?url='+u;})();`;

  return (
    <div className="library">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark brand-mark-articles">
            <Newspaper size={20} />
          </div>
          <div className="brand-text">
            <span className="eyebrow">Save for later</span>
            <h1>Reading list</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className="secondary-action"
            onClick={() => navigate("#/")}
            title="Back to your books"
          >
            <BookOpen size={15} />
            Library
          </button>
          <ThemeButton theme={theme} onCycleTheme={onCycleTheme} />
        </div>
      </header>

      <main className="content">
        <form className="add-article" onSubmit={submit}>
          <div className="search-shell add-article-input">
            <Link2 size={15} />
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError("");
              }}
              placeholder="Paste a link to read later…"
              aria-label="Article URL"
            />
          </div>
          <button className="add-article-btn" type="submit">
            <Plus size={15} />
            Add
          </button>
        </form>
        {error && <p className="article-error">{error}</p>}

        {articles.length === 0 ? (
          <div className="empty-state">
            <Newspaper size={28} />
            <p>Nothing saved yet — paste a link above.</p>
            <p className="empty-hint">
              Tip: drag the “Save to Leaf” link below onto your bookmarks bar
              to save pages from any website.
            </p>
          </div>
        ) : (
          <ul className="article-list">
            {articles.map((a) => (
              <li key={a.id} className="article-row">
                <button
                  className="article-row-main"
                  onClick={() => navigate(`#/article/${a.id}`)}
                  title={a.title}
                >
                  <span
                    className={`article-status${a.readAt ? "" : " unread"}`}
                  />
                  <span className="article-row-text">
                    <span className="article-row-title">{a.title}</span>
                    <span className="article-row-meta">
                      {a.domain} · added {timeAgo(a.addedAt)}
                    </span>
                  </span>
                </button>
                <button
                  className="mini-btn"
                  onClick={() => remove(a.id)}
                  title="Remove from reading list"
                  aria-label={`Remove ${a.title}`}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="sync-card">
          <div className="sync-card-head">
            <span
              className={`sync-dot sync-dot-${syncStatus.state}`}
              aria-hidden
            />
            <strong>Sync across devices</strong>
          </div>

          {syncStatus.state === "disconnected" ? (
            <>
              <p className="sync-hint">
                Share your reading list with every browser and device you use,
                synced through a GitHub Gist.
              </p>
              <details className="sync-help">
                <summary>How to get a token</summary>
                <ol>
                  <li>
                    Create a{" "}
                    <strong>GitHub classic personal access token</strong> with
                    only the <code>gist</code> scope (GitHub → Settings →
                    Developer settings → Personal access tokens → Tokens
                    (classic)).
                  </li>
                  <li>
                    Paste it below on each device. The first device creates the
                    gist; the rest pick it up automatically.
                  </li>
                </ol>
              </details>
              <form
                className="sync-connect"
                onSubmit={(e) => {
                  e.preventDefault();
                  void connect();
                }}
              >
                <input
                  type="password"
                  className="sync-token-input"
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    if (connectError) setConnectError("");
                  }}
                  placeholder="GitHub token (gist scope)"
                  aria-label="GitHub token"
                />
                <button
                  className="add-article-btn"
                  type="submit"
                  disabled={syncBusy}
                >
                  {syncBusy ? (
                    <Loader2 className="spin" size={15} />
                  ) : (
                    <Link2 size={15} />
                  )}
                  {syncBusy ? "Connecting…" : "Connect"}
                </button>
              </form>
              {connectError && <p className="article-error">{connectError}</p>}
            </>
          ) : (
            <>
              <p className="sync-hint">
                {syncStatus.state === "connecting"
                  ? "Connecting…"
                  : syncStatus.state === "syncing"
                    ? "Syncing…"
                    : syncStatus.state === "error"
                      ? syncStatus.lastError ?? "Sync failed — will retry."
                      : syncStatus.lastSyncedAt != null
                        ? `Synced ${timeAgo(syncStatus.lastSyncedAt)}.`
                        : "Connected."}
              </p>
              <div className="sync-actions">
                <button
                  className="secondary-action"
                  onClick={() => void manualSync()}
                  disabled={syncBusy}
                  title="Sync now"
                >
                  <RefreshCw size={15} />
                  Sync now
                </button>
                <button
                  className="secondary-action sync-disconnect"
                  onClick={disconnect}
                  title="Stop syncing"
                >
                  <Unplug size={15} />
                  Disconnect
                </button>
              </div>
            </>
          )}
        </div>

        <div className="bookmarklet-section">
          <strong>Save pages from anywhere</strong>
          <p>
            Drag this link to your bookmarks bar. On any website, click it to
            add the page you’re on to your reading list.
          </p>
          <a className="bookmarklet" href={bookmarklet}>
            <Link2 size={14} />
            Save to Leaf
          </a>
        </div>

        <p className="footnote">
          Saved links live in this browser. Turn on sync (below) to mirror them
          across devices via a GitHub Gist.
        </p>
      </main>
    </div>
  );
}