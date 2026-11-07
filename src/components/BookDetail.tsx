import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  FileText,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { Book } from "../books";
import { navigate, loadProgress, type Theme } from "../lib";
import { bookSecondsMap, READING_TIME_EVENT } from "../lib";
import { loadCover } from "../localBooks";
import {
  getMyLibrary,
  pinBook,
  removeUserBook,
  updateBookMeta,
  USER_BOOKS_CHANGED_EVENT,
} from "../userBooks";
import ThemeButton from "./ThemeButton";

interface Props {
  book: Book;
  theme: Theme;
  onCycleTheme: () => void;
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hrs} h ${rest} min` : `${hrs} h`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Detail page for one book: #/detail/<id>. */
export default function BookDetail({ book, theme, onCycleTheme }: Props) {
  const [cover, setCover] = useState<string | null>(null);
  const [inLibrary, setInLibrary] = useState(() =>
    getMyLibrary().some((b) => b.id === book.id)
  );
  const [, setTimeTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(book.title);
  const [editAuthor, setEditAuthor] = useState(book.author ?? "");

  useEffect(() => {
    setEditTitle(book.title);
    setEditAuthor(book.author ?? "");
  }, [book.title, book.author]);

  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    updateBookMeta(book, { title: editTitle, author: editAuthor });
    setEditing(false);
  };

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    loadCover(book.id)
      .then((blob) => {
        if (!blob || !alive) return;
        url = URL.createObjectURL(blob);
        setCover(url);
      })
      .catch(() => {});
    const onBooks = () => setInLibrary(getMyLibrary().some((b) => b.id === book.id));
    const onTime = () => setTimeTick((t) => t + 1);
    window.addEventListener(USER_BOOKS_CHANGED_EVENT, onBooks);
    window.addEventListener(READING_TIME_EVENT, onTime);
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      window.removeEventListener(USER_BOOKS_CHANGED_EVENT, onBooks);
      window.removeEventListener(READING_TIME_EVENT, onTime);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  const p = loadProgress(book.id);
  const pct =
    book.type === "pdf" && p.page && p.total
      ? p.page / p.total
      : (p.pct ?? null);
  const seconds = bookSecondsMap()[book.id] ?? 0;

  const status = p.finishedAt
    ? `Finished ${fmtDate(p.finishedAt)}`
    : p.lastReadAt
      ? `Reading · last opened ${fmtDate(p.lastReadAt)}`
      : "Not started yet";

  const coverSrc = cover ?? book.cover ?? null;

  return (
    <div className="library">
      <header className="topbar">
        <div className="topbar-actions">
          <button className="secondary-action" onClick={() => navigate("#/")}>
            <ArrowLeft size={15} />
            Library
          </button>
        </div>
        <div className="reader-title">
          <strong>{book.title}</strong>
          {book.author && <span>{book.author}</span>}
        </div>
        <div className="topbar-actions">
          <ThemeButton theme={theme} onCycleTheme={onCycleTheme} />
        </div>
      </header>

      <main className="content detail-page">
        <div className="detail-layout">
          <div className="detail-cover book-cover">
            {coverSrc ? (
              <img className="book-cover-img" src={coverSrc} alt="" />
            ) : book.type === "epub" ? (
              <BookOpen size={40} />
            ) : (
              <FileText size={40} />
            )}
            <span className={`pill pill-${book.type}`}>{book.type}</span>
          </div>

          <div className="detail-main">
            {editing ? (
              <form className="detail-edit-form" onSubmit={submitEdit}>
                <label className="field">
                  <span>Title</span>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    autoFocus
                    required
                  />
                </label>
                <label className="field">
                  <span>Author</span>
                  <input
                    type="text"
                    value={editAuthor}
                    onChange={(e) => setEditAuthor(e.target.value)}
                    placeholder="Author name (optional)"
                  />
                </label>
                <div className="detail-edit-actions">
                  <button type="submit" className="add-article-btn">
                    <Check size={14} />
                    Save
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => {
                      setEditTitle(book.title);
                      setEditAuthor(book.author ?? "");
                      setEditing(false);
                    }}
                  >
                    <X size={14} />
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="detail-title-row">
                <div>
                  <h2>{book.title}</h2>
                  {book.author && <p className="book-author">{book.author}</p>}
                </div>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => setEditing(true)}
                  title="Edit title & author"
                  aria-label="Edit title and author"
                >
                  <Pencil size={14} />
                </button>
              </div>
            )}
            <p className="detail-status">{status}</p>

            {pct != null && (
              <div className="book-progress detail-progress">
                <span>{Math.round(pct * 100)}% read</span>
                <div className="progress-track">
                  <span style={{ width: `${Math.round(pct * 100)}%` }} />
                </div>
              </div>
            )}
            {book.type === "pdf" && p.page && p.total && (
              <p className="detail-facts">Page {p.page} of {p.total}</p>
            )}
            {p.chapter && book.type === "epub" && (
              <p className="detail-facts">Chapter: {p.chapter}</p>
            )}
            {seconds > 0 && (
              <p className="detail-facts">
                Time with this book: {fmtDuration(seconds)}
              </p>
            )}

            <div className="detail-actions">
              <button
                className="add-article-btn"
                onClick={() => navigate(`#/book/${encodeURIComponent(book.id)}`)}
              >
                <BookOpen size={15} />
                {p.lastReadAt ? "Resume reading" : "Start reading"}
              </button>
              <button
                className={`card-add detail-pin${inLibrary ? " added" : ""}`}
                onClick={() =>
                  inLibrary ? removeUserBook(book.id) : pinBook(book)
                }
                title={inLibrary ? "Remove from your library" : "Add to your library"}
                aria-label={inLibrary ? "Remove from your library" : "Add to your library"}
              >
                {inLibrary ? <Check size={15} /> : <Plus size={15} />}
              </button>
              {inLibrary && (
                <button
                  className="card-remove"
                  onClick={() => {
                    removeUserBook(book.id);
                    navigate("#/");
                  }}
                  title="Remove from your library"
                  aria-label={`Remove ${book.title}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}