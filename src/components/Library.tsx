import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BookOpen,
  FileText,
  LayoutGrid,
  List,
  Newspaper,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { BOOKS, type Book } from "../books";
import { loadArticles } from "../articles";
import { loadProgress, navigate, useLibraryView, type Theme } from "../lib";
import ThemeButton from "./ThemeButton";
import {
  addUserBook,
  deriveBookTitle,
  detectBookType,
  getAllBooks,
  loadUserBooks,
  removeUserBook,
  USER_BOOKS_CHANGED_EVENT,
  type BookType,
} from "../userBooks";

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
  const [books, setBooks] = useState<Book[]>(() => getAllBooks());
  const unreadArticles = useMemo(
    () => loadArticles().filter((a) => !a.readAt).length,
    []
  );

  /* Refresh the combined library (user books in front) whenever it changes. */
  useEffect(() => {
    const onBooks = () => setBooks(getAllBooks());
    window.addEventListener(USER_BOOKS_CHANGED_EVENT, onBooks);
    return () => window.removeEventListener(USER_BOOKS_CHANGED_EVENT, onBooks);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return books;
    return books.filter((b) =>
      `${b.title} ${b.author ?? ""}`.toLowerCase().includes(q)
    );
  }, [query, books]);

  /* ---- "Add book" modal state ---- */
  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addAuthor, setAddAuthor] = useState("");
  const [addType, setAddType] = useState<BookType>("epub");
  const [addError, setAddError] = useState("");

  const onUrlChange = (v: string) => {
    setAddUrl(v);
    if (addError) setAddError("");
    const det = detectBookType(v);
    if (det) setAddType(det);
  };

  const onTitleBlur = () => {
    if (!addTitle.trim() && addUrl.trim()) {
      setAddTitle(deriveBookTitle(addUrl.trim()));
    }
  };

  const submitAdd = (e: FormEvent) => {
    e.preventDefault();
    try {
      const { added } = addUserBook({
        url: addUrl,
        title: addTitle,
        author: addAuthor,
        type: addType,
      });
      if (!added) {
        setAddError("That book is already in your library.");
        return;
      }
      setAddUrl("");
      setAddTitle("");
      setAddAuthor("");
      setAddType("epub");
      setAddError("");
      setShowAdd(false);
    } catch {
      setAddError("That link doesn’t look valid — check it and try again.");
    }
  };

  const remove = (id: string) => {
    removeUserBook(id);
  };

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
          <button
            className="secondary-action"
            onClick={() => setShowAdd(true)}
            title="Add a book to your library"
          >
            <Plus size={15} />
            Add book
          </button>
          <button
            className="secondary-action"
            onClick={() => navigate("#/articles")}
            title="Your reading list"
          >
            <Newspaper size={15} />
            Reading list
            {unreadArticles > 0 && (
              <span className="nav-badge">{unreadArticles}</span>
            )}
          </button>
          <ThemeButton theme={theme} onCycleTheme={onCycleTheme} />
        </div>
      </header>

      <main className="content">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <BookOpen size={28} />
            <p>
              {books.length === 0
                ? "No books yet — click “Add book” to start your library."
                : "No books match your search."}
            </p>
          </div>
        ) : view === "grid" ? (
          <div className="book-grid">
            {filtered.map((b) => {
              const prog = progressInfo(b);
              const isMine = mine(b.id);
              return (
                <div className="book-card-wrap" key={b.id}>
                  <button
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
                      {isMine && (
                        <span className="pill pill-yours">Yours</span>
                      )}
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
                                style={{ width: `${Math.round(prog.pct * 100)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                  {isMine && (
                    <button
                      className="card-remove"
                      onClick={() => remove(b.id)}
                      title="Remove from your library"
                      aria-label={`Remove ${b.title}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
<div className="book-list">
            {filtered.map((b) => {
              const prog = progressInfo(b);
              const isMine = mine(b.id);
              return (
                <div className="book-list-row-wrap" key={b.id}>
                  <button
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
                    {isMine && <span className="book-list-yours">Yours</span>}
                  </button>
                  {isMine && (
                    <button
                      className="card-remove"
                      onClick={() => remove(b.id)}
                      title="Remove from your library"
                      aria-label={`Remove ${b.title}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="footnote">
          {BOOKS.length > 0
            ? "Books marked “Yours” are the ones you added and stay in this browser. The rest are the demo library."
            : "Your library is empty — click “Add book” to start it."}
        </p>
      </main>

      {showAdd && (
        <div
          className="modal-overlay"
          onClick={() => (addError ? setAddError("") : setShowAdd(false))}
        >
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitAdd}
          >
            <div className="modal-head">
              <strong>Add book to your library</strong>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowAdd(false)}
                title="Close"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <label className="field">
              <span>File URL</span>
              <input
                type="text"
                value={addUrl}
                onChange={(e) => onUrlChange(e.target.value)}
                placeholder="https://example.com/book.epub"
                autoFocus
                required
              />
            </label>

            <div className="field-row">
              <label className="field">
                <span>Title</span>
                <input
                  type="text"
                  value={addTitle}
                  onChange={(e) => {
                    setAddTitle(e.target.value);
                    if (addError) setAddError("");
                  }}
                  onBlur={onTitleBlur}
                  placeholder="Auto from URL if blank"
                />
              </label>
              <label className="field field-type">
                <span>Type</span>
                <select
                  value={addType}
                  onChange={(e) => setAddType(e.target.value as BookType)}
                >
                  <option value="epub">EPUB</option>
                  <option value="pdf">PDF</option>
                </select>
              </label>
            </div>

            <label className="field">
              <span>Author (optional)</span>
              <input
                type="text"
                value={addAuthor}
                onChange={(e) => setAddAuthor(e.target.value)}
                placeholder="Author name"
              />
            </label>

            {addError && <p className="article-error">{addError}</p>}

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-action"
                onClick={() => setShowAdd(false)}
              >
                Cancel
              </button>
              <button type="submit" className="add-article-btn">
                <Plus size={15} />
                Add to library
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
  const mine = (id: string) => loadUserBooks().some((b) => b.id === id);