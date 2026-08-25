import { useMemo, useState } from "react";
import {
  BookOpen,
  FileText,
  LayoutGrid,
  List,
  Search,
} from "lucide-react";
import { BOOKS, type Book } from "../books";
import { loadProgress, navigate, useLibraryView, type Theme } from "../lib";
import ThemeButton from "./ThemeButton";

function progressInfo(book: Book): { label: string; pct: number | null } {
  const p = loadProgress(book.id);
  if (book.type === "pdf" && p.page && p.total) {
    return { label: `Page ${p.page} of ${p.total}`, pct: p.page / p.total };
  }
  if (book.type === "epub" && (p.cfi || p.chapter)) {
    return { label: p.chapter ? `Resume: ${p.chapter}` : "Started", pct: null };
  }
  return { label: "", pct: null };
}

interface Props {
  theme: Theme;
  onCycleTheme: () => void;
}

export default function Library({ theme, onCycleTheme }: Props) {
  const [query, setQuery] = useState("");
  const { view, setView } = useLibraryView();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BOOKS;
    return BOOKS.filter((b) =>
      `${b.title} ${b.author ?? ""}`.toLowerCase().includes(q)
    );
  }, [query]);

  return (
    <div className="library">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">
            <BookOpen size={20} />
          </div>
          <div className="brand-text">
            <span className="eyebrow">Personal reader</span>
            <h1>Leaf</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="search-shell">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your books…"
            />
          </div>
          <div className="view-toggle" role="group" aria-label="View mode">
            <button
              className={`view-btn${view === "grid" ? " active" : ""}`}
              onClick={() => setView("grid")}
              title="Grid view"
            >
              <LayoutGrid size={15} />
            </button>
            <button
              className={`view-btn${view === "list" ? " active" : ""}`}
              onClick={() => setView("list")}
              title="List view"
            >
              <List size={15} />
            </button>
          </div>
          <ThemeButton theme={theme} onCycleTheme={onCycleTheme} />
        </div>
      </header>

      <main className="content">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <BookOpen size={28} />
            <p>
              {BOOKS.length === 0
                ? "No books yet — add some in src/books.ts."
                : "No books match your search."}
            </p>
          </div>
        ) : view === "grid" ? (
          <div className="book-grid">
            {filtered.map((b) => {
              const prog = progressInfo(b);
              return (
                <button
                  key={b.id}
                  className="book-card"
                  onClick={() =>
                    navigate(`#/book/${encodeURIComponent(b.id)}`)
                  }
                >
                  <div className="book-cover">
                    {b.type === "epub" ? (
                      <BookOpen size={34} />
                    ) : (
                      <FileText size={34} />
                    )}
                    <span className={`pill pill-${b.type}`}>{b.type}</span>
                  </div>
                  <div className="book-body">
                    <h3>{b.title}</h3>
                    {b.author && <p className="book-author">{b.author}</p>}
                    {prog.label && (
                      <div className="book-progress">
                        <span>{prog.label}</span>
                        {prog.pct !== null && (
                          <div className="progress-track">
                            <span
                              style={{
                                width: `${Math.round(prog.pct * 100)}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="book-list">
            {filtered.map((b) => {
              const prog = progressInfo(b);
              return (
                <button
                  key={b.id}
                  className="book-list-row"
                  onClick={() =>
                    navigate(`#/book/${encodeURIComponent(b.id)}`)
                  }
                >
                  <div className="book-list-icon">
                    {b.type === "epub" ? (
                      <BookOpen size={18} />
                    ) : (
                      <FileText size={18} />
                    )}
                  </div>
                  <div className="book-list-main">
                    <span className="book-list-title">{b.title}</span>
                    {b.author && (
                      <span className="book-list-author">{b.author}</span>
                    )}
                  </div>
                  {prog.label && (
                    <span className="book-list-progress">{prog.label}</span>
                  )}
                  <span className={`pill pill-${b.type}`}>{b.type}</span>
                </button>
              );
            })}
          </div>
        )}
        <p className="footnote">
          Books are loaded from the URLs listed in <code>src/books.ts</code>.
        </p>
      </main>
    </div>
  );
}