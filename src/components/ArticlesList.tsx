import { useEffect, useState, type FormEvent } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  Link2,
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
  ARTICLES_CHANGED_EVENT,
  PREDEFINED_TAGS,
  addArticle,
  formatTagLabel,
  loadArticles,
  removeArticle,
  setArticleArchived,
  setArticleStar,
  setArticleTags,
  toggleArticleTag,
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
import ArticleReader from "./ArticleReader";
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

  /* Split-pane selection and feed visibility. */
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const first = loadArticles().find((a) => !a.archivedAt);
    return first?.id ?? null;
  });
  const [listMinimized, setListMinimized] = useState(false);

  /* List organization: filter chips + tag focus + inline tag editing. */
  const [filter, setFilter] = useState<"all" | "unread" | "starred" | "archived">(
    "all"
  );
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagEditId, setTagEditId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");

  const visible = articles.filter((a) => {
    if (filter === "archived") {
      if (!a.archivedAt) return false;
    } else {
      if (a.archivedAt) return false;
      if (filter === "unread" && a.readAt) return false;
      if (filter === "starred" && !a.starredAt) return false;
    }
    if (activeTag === "__untagged__") {
      return (a.tags ?? []).length === 0;
    }
    if (activeTag && !(a.tags ?? []).includes(activeTag)) return false;
    return true;
  });

  const nonArchived = articles.filter((a) => !a.archivedAt);
  const unreadCount = nonArchived.filter((a) => !a.readAt).length;
  const starredCount = nonArchived.filter((a) => !!a.starredAt).length;
  const archivedCount = articles.filter((a) => !!a.archivedAt).length;

  const predefinedIds = new Set(PREDEFINED_TAGS.map((p) => p.id));
  const customTags = Array.from(
    new Set(
      articles
        .flatMap((a) => a.tags ?? [])
        .filter((t) => !predefinedIds.has(t))
    )
  ).sort();

  const allCategoryTags = [
    ...PREDEFINED_TAGS.map((p) => ({ id: p.id, label: p.label, isPreset: true })),
    ...customTags.map((t) => ({ id: t, label: formatTagLabel(t), isPreset: false })),
  ];

  const tagCounts: Record<string, number> = {};
  for (const a of nonArchived) {
    for (const t of a.tags ?? []) {
      tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    }
  }

  const selectedArticle =
    articles.find((a) => a.id === selectedId) ?? visible[0] ?? null;

  const addCustomTagToArticle = (a: SavedArticle) => {
    const cleaned = tagDraft
      .split(",")
      .map((t) => t.replace(/^#+/, "").trim().toLowerCase())
      .filter(Boolean);
    if (cleaned.length > 0) {
      setArticleTags(a.id, [...(a.tags ?? []), ...cleaned]);
      setArticles(loadArticles());
    }
    setTagDraft("");
  };

  /* Sync panel state: mirrors getSyncStatus() via the window event. */
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => getSyncStatus());
  const [token, setToken] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [connectError, setConnectError] = useState("");

  useEffect(() => {
    const onStatus = (e: Event) =>
      setSyncStatus({ ...(e as CustomEvent<SyncStatus>).detail });
    const onArticles = () => setArticles(loadArticles());
    window.addEventListener("leaf:sync-status", onStatus);
    window.addEventListener(ARTICLES_CHANGED_EVENT, onArticles);
    return () => {
      window.removeEventListener("leaf:sync-status", onStatus);
      window.removeEventListener(ARTICLES_CHANGED_EVENT, onArticles);
    };
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
      if (added) void extractAndSyncArticle(article);
    } catch {
      setError("That doesn’t look like a valid link.");
    }
  };

  const remove = (id: string) => {
    removeArticle(id);
    const remaining = loadArticles();
    setArticles(remaining);
    if (selectedId === id) {
      const next = remaining.find((a) => !a.archivedAt);
      setSelectedId(next?.id ?? null);
    }
  };

  const activeCount = articles.filter((a) => !a.archivedAt).length;

  /* "Save to Leaf" bookmarklet, generated against the app's own URL so it
     works from any deployment (localhost, a GitHub Pages subpath, …). */
  const appBase = `${window.location.origin}${window.location.pathname}`;
  const bookmarklet = `javascript:(function(){var%20u=encodeURIComponent(location.href);var%20w=window.open('${appBase}#/add?url='+u,'_blank');if(!w)location.href='${appBase}#/add?url='+u;})();`;

  return (
    <div className={`articles-shell${listMinimized ? " list-minimized" : ""}`}>
      <aside className="typographic-rail">
        <div className="typographic-rail-top">
          <div className="wordmark-row">
            <span className="wordmark-title">Leaf</span>
            <ThemeButton theme={theme} onCycleTheme={onCycleTheme} />
          </div>

          <div className="rail-group-label">Articles</div>
          <button
            type="button"
            className={`text-nav-btn${filter === "all" ? " active" : ""}`}
            onClick={() => setFilter("all")}
          >
            <span>All Articles</span>
            <span className="nav-count">{activeCount}</span>
          </button>
          <button
            type="button"
            className={`text-nav-btn${filter === "unread" ? " active" : ""}`}
            onClick={() => setFilter("unread")}
          >
            <span>Unread</span>
            <span className="nav-count">{unreadCount}</span>
          </button>
          <button
            type="button"
            className={`text-nav-btn${filter === "starred" ? " active" : ""}`}
            onClick={() => setFilter("starred")}
          >
            <span>Starred</span>
            <span className="nav-count">{starredCount}</span>
          </button>
          <button
            type="button"
            className={`text-nav-btn${filter === "archived" ? " active" : ""}`}
            onClick={() => setFilter("archived")}
          >
            <span>Archived</span>
            <span className="nav-count">{archivedCount}</span>
          </button>

          <div className="rail-group-label">Books</div>
          <button
            type="button"
            className="text-nav-btn"
            onClick={() => navigate("#/books")}
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
            <summary>Bookmarklet &amp; Sync</summary>
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

      <div
        className={`articles-workspace${listMinimized ? " list-minimized" : ""}`}
      >
        <section className="articles-feed-pane">
          <div className="articles-feed-head">
            <h2>
              {filter === "all"
                ? "Reading List"
                : filter === "unread"
                  ? "Unread"
                  : filter === "starred"
                    ? "Starred"
                    : "Archived"}
            </h2>
            {activeTag && (
              <button
                type="button"
                className="active-tag-Indicator"
                onClick={() => setActiveTag(null)}
                title="Clear tag filter"
              >
                <span>
                  #{activeTag === "__untagged__" ? "Untagged" : formatTagLabel(activeTag)}
                </span>
                <X size={11} />
              </button>
            )}
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

          <div
            className="article-category-strip"
            role="group"
            aria-label="Filter by category"
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 6,
              flexShrink: 0,
              overflow: "visible",
            }}
          >
            <button
              type="button"
              className={`category-pill${activeTag === null ? " active" : ""}`}
              onClick={() => setActiveTag(null)}
            >
              All
            </button>
            {allCategoryTags.map((cat) => {
              const count = tagCounts[cat.id] ?? 0;
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`category-pill${activeTag === cat.id ? " active" : ""}`}
                  onClick={() =>
                    setActiveTag(activeTag === cat.id ? null : cat.id)
                  }
                >
                  <span>{cat.label}</span>
                  {count > 0 && <span className="category-pill-count">{count}</span>}
                </button>
              );
            })}
          </div>

          {visible.length === 0 ? (
            <div className="empty-state">
              <Newspaper size={26} />
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
                        {a.archivedAt ? " (archived)" : ""}
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

                  <div className="article-row-footer">
                    <span className="article-row-tags">
                      {(a.tags ?? []).map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={`article-tag article-tag-clickable${activeTag === t ? " active" : ""}`}
                          onClick={() =>
                            setActiveTag(activeTag === t ? null : t)
                          }
                          title={`Filter by ${formatTagLabel(t)}`}
                        >
                          {formatTagLabel(t)}
                        </button>
                      ))}
                    </span>
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
                        <Star size={13} />
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
                          <ArchiveRestore size={13} />
                        ) : (
                          <Archive size={13} />
                        )}
                      </button>
                      <button
                        className={`mini-btn${tagEditId === a.id ? " active" : ""}`}
                        onClick={() => {
                          setTagEditId(tagEditId === a.id ? null : a.id);
                          setTagDraft("");
                        }}
                        title="Edit tags"
                        aria-label={`Edit tags for ${a.title}`}
                      >
                        <Tag size={13} />
                      </button>
                      <button
                        className="mini-btn"
                        onClick={() => remove(a.id)}
                        title="Remove"
                        aria-label={`Remove ${a.title}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </div>

                  {tagEditId === a.id && (
                    <div className="article-tag-picker-card">
                      <div className="tag-picker-presets">
                        {allCategoryTags.map((cat) => {
                          const hasTag = (a.tags ?? []).includes(cat.id);
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              className={`preset-tag-chip${hasTag ? " active" : ""}`}
                              onClick={() => {
                                toggleArticleTag(a.id, cat.id);
                                setArticles(loadArticles());
                              }}
                            >
                              {hasTag ? <Check size={10} /> : <Plus size={10} />}
                              {cat.label}
                            </button>
                          );
                        })}
                      </div>
                      <form
                        className="tag-picker-custom"
                        onSubmit={(e) => {
                          e.preventDefault();
                          addCustomTagToArticle(a);
                        }}
                      >
                        <input
                          value={tagDraft}
                          onChange={(e) => setTagDraft(e.target.value)}
                          placeholder="Add custom tag…"
                          aria-label={`Custom tag for ${a.title}`}
                        />
                        <button
                          type="submit"
                          className="tag-custom-add-btn"
                          disabled={!tagDraft.trim()}
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          className="mini-btn"
                          onClick={() => {
                            setTagEditId(null);
                            setTagDraft("");
                          }}
                          aria-label="Close tag picker"
                        >
                          <X size={12} />
                        </button>
                      </form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

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
              onSelectTag={(t) => {
                setActiveTag((prev) => (prev === t ? null : t));
                setListMinimized(false);
              }}
            />
          ) : (
            <div className="articles-empty-reader">
              <Newspaper size={28} />
              <strong>Select an article to read</strong>
              <p>Paste a link on the left or pick an item from your Reading List.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
