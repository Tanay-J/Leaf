import { useEffect, useState, type FormEvent } from "react";
import {
  Archive,
  ArchiveRestore,
  Link2,
  Plus,
  RefreshCw,
  Star,
  Tag,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import {
  ARTICLES_CHANGED_EVENT,
  addArticle,
  loadArticles,
  removeArticle,
  setArticleArchived,
  setArticleStar,
  setArticleTags,
  type SavedArticle,
} from "../articles";
import {
  extractAndSyncArticle,
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
import ArticleReader from "./ArticleReader";

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
  const [selectedId, setSelectedId] = useState<string | null>(
    () => loadArticles().find((a) => !a.archivedAt)?.id ?? null
  );
  const [listMinimized, setListMinimized] = useState(false);
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

  useEffect(() => {
    const refresh = () => setArticles(loadArticles());
    window.addEventListener(ARTICLES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ARTICLES_CHANGED_EVENT, refresh);
  }, []);

  const visible = articles.filter((a) => {
    if (activeTag && !(a.tags ?? []).includes(activeTag)) return false;
    if (filter === "archived") return !!a.archivedAt;
    if (a.archivedAt) return false;
    if (filter === "unread") return !a.readAt;
    if (filter === "starred") return !!a.starredAt;
    return true;
  });

  const selectedArticle =
    articles.find((a) => a.id === selectedId) ?? visible[0] ?? null;

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
      const { article, added } = addArticle(url.trim());
      setUrl("");
      setError("");
      setArticles(loadArticles());
      setSelectedId(article.id);
      if (added) {
        void extractAndSyncArticle(article);
      }
    } catch {
      setError("That doesn’t look like a valid link.");
    }
  };

  const remove = (id: string) => {
    removeArticle(id);
    setArticles(loadArticles());
    if (selectedId === id) setSelectedId(null);
  };

  const appBase = `${window.location.origin}${window.location.pathname}`;
  const bookmarklet = `javascript:(function(){var%20u=encodeURIComponent(location.href);var%20w=window.open('${appBase}#/add?url='+u,'_blank');if(!w)location.href='${appBase}#/add?url='+u;})();`;

  return (
    <div className="articles-shell">
      {/* Left Typographic Navigation Rail (Icon-Free, matches Bookshelf) */}
      <aside className="typographic-rail">
        <div className="typographic-rail-top">
          <div className="wordmark-row">
            <span className="wordmark-title">Leaf</span>
            <ThemeButton theme={theme} onCycleTheme={onCycleTheme} />
          </div>

          <div className="rail-group-label">Books</div>
          <button
            type="button"
            className="text-nav-btn"
            onClick={() => navigate("#/")}
          >
            <span>Bookshelf</span>
          </button>
          <button
            type="button"
            className="text-nav-btn"
            onClick={() => navigate("#/stats")}
          >
            <span>Activity</span>
          </button>

          <div className="rail-group-label">Articles</div>
          <button type="button" className="text-nav-btn active">
            <span>Reading List</span>
            <span className="nav-count">
              {articles.filter((a) => !a.readAt && !a.archivedAt).length}
            </span>
          </button>
        </div>

        <div className="typographic-rail-footer">
          <div className="sync-status-mini">
            <span
              className={`sync-dot sync-dot-${syncStatus.state}`}
              aria-hidden
            />
            <span>
              {syncStatus.state === "disconnected"
                ? "Local only"
                : syncStatus.backend === "vault"
                  ? "Vault synced"
                  : "Gist synced"}
            </span>
            {syncStatus.state !== "disconnected" && (
              <button
                type="button"
                className="mini-btn"
                onClick={() => void manualSync()}
                disabled={syncBusy}
                title="Sync now"
              >
                <RefreshCw size={12} />
              </button>
            )}
          </div>
          {syncStatus.state === "disconnected" && isVaultConnected() && (
            <button
              type="button"
              className="secondary-action"
              onClick={() => void connectViaVault()}
              disabled={syncBusy}
              style={{ width: "100%", justifyContent: "center", marginTop: 6 }}
            >
              {syncBusy ? "Connecting…" : "Enable Vault Sync"}
            </button>
          )}
          <details className="rail-sync-details">
            <summary>Bookmarklet & Sync</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              <a className="bookmarklet" href={bookmarklet}>
                <Link2 size={13} />
                Save to Leaf
              </a>
              {syncStatus.state === "disconnected" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void connect();
                  }}
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <input
                    type="password"
                    className="sync-token-input"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Gist token (optional)"
                    aria-label="GitHub token"
                  />
                  <button
                    className="secondary-action"
                    type="submit"
                    disabled={syncBusy}
                  >
                    {syncBusy ? "Connecting…" : "Connect Gist"}
                  </button>
                  {connectError && <p className="article-error">{connectError}</p>}
                </form>
              ) : (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={disconnect}
                >
                  <Unplug size={13} />
                  Disconnect sync
                </button>
              )}
            </div>
          </details>
        </div>
      </aside>

      {/* Split Reading List + Live Article Reader */}
      <div
        className={`articles-workspace${listMinimized ? " list-minimized" : ""}`}
      >
        <section className="articles-feed-pane">
          <div className="articles-feed-head">
            <h2>Reading List</h2>
            <button
              type="button"
              className="secondary-action"
              onClick={() => setListMinimized(true)}
              title="Minimize reading list"
            >
              Hide
            </button>
          </div>

          <form className="add-article compact-add-article" onSubmit={submit}>
            <div className="search-shell add-article-input">
              <Link2 size={14} />
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (error) setError("");
                }}
                placeholder="Paste article link…"
                aria-label="Article URL"
              />
            </div>
            <button className="add-article-btn" type="submit">
              <Plus size={14} />
              Save
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
                >
                  <Tag size={11} />
                  {t}
                </button>
              ))}
            </div>
          )}

          {visible.length === 0 ? (
            <div className="empty-state">
              <p>
                {articles.length === 0
                  ? "Nothing saved yet — paste a link above."
                  : "Nothing matches this filter."}
              </p>
            </div>
          ) : (
            <ul className="article-list compact-article-list">
              {visible.map((a) => (
                <li
                  key={a.id}
                  className={`article-row${selectedArticle?.id === a.id ? " active" : ""}`}
                >
                  <button
                    className="article-row-main"
                    onClick={() => setSelectedId(a.id)}
                    title={a.title}
                  >
                    <span
                      className={`article-status${a.readAt ? "" : " unread"}`}
                    />
                    <span className="article-row-text">
                      <span className="article-row-title">
                        {a.starredAt ? "★ " : ""}
                        {a.title}
                      </span>
                      <span className="article-row-meta">
                        {a.domain}
                        {a.readingMinutes ? ` · ${a.readingMinutes}m` : ""}
                        {a.contentStatus === "pending" ? " · Extracting…" : ""}
                        {" · "}
                        {timeAgo(a.addedAt)}
                      </span>
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
                      >
                        <Star size={13} />
                      </button>
                      <button
                        className="mini-btn"
                        onClick={() => {
                          setArticleArchived(a.id, !a.archivedAt);
                          setArticles(loadArticles());
                        }}
                        title={a.archivedAt ? "Unarchive" : "Archive"}
                      >
                        {a.archivedAt ? (
                          <ArchiveRestore size={13} />
                        ) : (
                          <Archive size={13} />
                        )}
                      </button>
                      <button
                        className="mini-btn"
                        onClick={() => {
                          setTagEditId(a.id);
                          setTagDraft((a.tags ?? []).join(", "));
                        }}
                        title="Edit tags"
                      >
                        <Tag size={13} />
                      </button>
                      <button
                        className="mini-btn"
                        onClick={() => remove(a.id)}
                        title="Remove"
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Live Article Reader Pane */}
        <section className="articles-reader-pane">
          {selectedArticle ? (
            <ArticleReader
              key={selectedArticle.id}
              article={selectedArticle}
              theme={theme}
              onCycleTheme={onCycleTheme}
              embedded
              listMinimized={listMinimized}
              onToggleList={() => setListMinimized((m) => !m)}
            />
          ) : (
            <div className="empty-state" style={{ margin: "auto" }}>
              {listMinimized && (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => setListMinimized(false)}
                  style={{ marginBottom: 12 }}
                >
                  Show Reading List
                </button>
              )}
              <p>Paste a link on the left to save and read an article.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
