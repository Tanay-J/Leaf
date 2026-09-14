import { useEffect, useState, type FormEvent } from "react";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Link2,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  Star,
  Tag,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import {
  addArticle,
  loadArticles,
  removeArticle,
  setArticleArchived,
  setArticleStar,
  setArticleTags,
  type SavedArticle,
} from "../articles";
import {
  getSyncStatus,
  syncConnect,
  syncConnectViaVault,
  syncDisconnect,
  syncNow,
  type SyncStatus,
} from "../articleSync";
import { isVaultConnected } from "../vaultSync";
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

  /* List organization: filter chips + tag focus + inline tag editing. */
  const [filter, setFilter] = useState<"all" | "unread" | "starred" | "archived">(
    "all"
  );
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagEditId, setTagEditId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");

  const visible = articles.filter((a) => {
    if (activeTag && !(a.tags ?? []).includes(activeTag)) return false;
    if (filter === "archived") return !!a.archivedAt;
    if (a.archivedAt) return false;
    if (filter === "unread") return !a.readAt;
    if (filter === "starred") return !!a.starredAt;
    return true;
  });

  const allTags = Array.from(
    new Set(articles.flatMap((a) => a.tags ?? []))
  ).sort();

  const commitTags = (a: SavedArticle) => {
    if (tagEditId === a.id) setArticleTags(a.id, tagDraft.split(","));
    setTagEditId(null);
    setTagDraft("");
    setArticles(loadArticles());
  };

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

  const connectViaVault = async () => {
    setSyncBusy(true);
    setConnectError("");
    const res = await syncConnectViaVault();
    if (!res.ok) {
      setConnectError(res.error);
    } else {
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

        {articles.length > 0 && (
          <div className="article-filters" role="group" aria-label="Filter articles">
            {(["all", "unread", "starred", "archived"] as const).map((f) => (
              <button
                key={f}
                className={`filter-chip${filter === f ? " active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f === "all"
                  ? "All"
                  : f === "unread"
                    ? "Unread"
                    : f === "starred"
                      ? "Starred"
                      : "Archived"}
              </button>
            ))}
            {allTags.map((t) => (
              <button
                key={t}
                className={`filter-chip tag-chip${activeTag === t ? " active" : ""}`}
                onClick={() => setActiveTag(activeTag === t ? null : t)}
                title={`Show only “${t}”`}
              >
                <Tag size={11} />
                {t}
              </button>
            ))}
          </div>
        )}

        {visible.length === 0 ? (
          <div className="empty-state">
            <Newspaper size={28} />
            <p>
              {articles.length === 0
                ? "Nothing saved yet — paste a link above."
                : "Nothing matches this filter."}
            </p>
            {articles.length === 0 && (
              <p className="empty-hint">
                Tip: drag the “Save to Leaf” link below onto your bookmarks bar
                to save pages from any website.
              </p>
            )}
          </div>
        ) : (
          <ul className="article-list">
            {visible.map((a) => (
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
                    <span className="article-row-title">
                      {a.starredAt ? "★ " : ""}
                      {a.title}
                      {a.archivedAt ? " (archived)" : ""}
                    </span>
                    <span className="article-row-meta">
                      {a.domain} · added {timeAgo(a.addedAt)}
                    </span>
                    {(a.tags ?? []).length > 0 && (
                      <span className="article-row-tags">
                        {(a.tags ?? []).map((t) => (
                          <span key={t} className="article-tag">
                            {t}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </button>
                {tagEditId === a.id ? (
                  <form
                    className="tag-editor"
                    onSubmit={(e) => {
                      e.preventDefault();
                      commitTags(a);
                    }}
                  >
                    <input
                      autoFocus
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onBlur={() => commitTags(a)}
                      placeholder="tags, comma, separated"
                      aria-label={`Tags for ${a.title}`}
                    />
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={() => {
                        setTagEditId(null);
                        setTagDraft("");
                      }}
                      aria-label="Cancel tag editing"
                    >
                      <X size={13} />
                    </button>
                  </form>
                ) : (
                  <span className="article-row-actions">
                    <button
                      className={`mini-btn${a.starredAt ? " star-on" : ""}`}
                      onClick={() => {
                        setArticleStar(a.id, !a.starredAt);
                        setArticles(loadArticles());
                      }}
                      title={a.starredAt ? "Remove star" : "Star"}
                      aria-label={`${a.starredAt ? "Unstar" : "Star"} ${a.title}`}
                    >
                      <Star size={14} />
                    </button>
                    <button
                      className="mini-btn"
                      onClick={() => {
                        setArticleArchived(a.id, !a.archivedAt);
                        setArticles(loadArticles());
                      }}
                      title={a.archivedAt ? "Unarchive" : "Archive"}
                      aria-label={`${a.archivedAt ? "Unarchive" : "Archive"} ${a.title}`}
                    >
                      {a.archivedAt ? (
                        <ArchiveRestore size={14} />
                      ) : (
                        <Archive size={14} />
                      )}
                    </button>
                    <button
                      className="mini-btn"
                      onClick={() => {
                        setTagEditId(a.id);
                        setTagDraft((a.tags ?? []).join(", "));
                      }}
                      title="Edit tags"
                      aria-label={`Edit tags for ${a.title}`}
                    >
                      <Tag size={14} />
                    </button>
                    <button
                      className="mini-btn"
                      onClick={() => remove(a.id)}
                      title="Remove from reading list"
                      aria-label={`Remove ${a.title}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                )}
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
                Share your reading list with every browser and device you use.
              </p>
              {isVaultConnected() ? (
                <button
                  type="button"
                  className="add-article-btn sync-vault-cta"
                  onClick={() => void connectViaVault()}
                  disabled={syncBusy}
                  title="Uses your existing vault connection — no token needed"
                >
                  {syncBusy ? (
                    <Loader2 className="spin" size={15} />
                  ) : (
                    <Link2 size={15} />
                  )}
                  {syncBusy ? "Connecting…" : "Sync via my vault"}
                </button>
              ) : null}
              <details className="sync-help">
                <summary>
                  {isVaultConnected()
                    ? "Or sync through a GitHub Gist instead"
                    : "How to get a token"}
                </summary>
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
                        ? `Synced ${timeAgo(syncStatus.lastSyncedAt)}${
                            syncStatus.backend === "vault"
                              ? " via your vault"
                              : ""
                          }.`
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