import { useState, type FormEvent } from "react";
import { BookOpen, Link2, Newspaper, Plus, Trash2 } from "lucide-react";
import {
  addArticle,
  loadArticles,
  removeArticle,
  type SavedArticle,
} from "../articles";
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

        <p className="footnote">Saved links live in this browser.</p>
      </main>
    </div>
  );
}