import { useEffect, useState } from "react";
import { BookOpen, FileText, Play } from "lucide-react";
import { CATALOG_LOADED_EVENT, getCatalog, type Book } from "../books";
import { loadProgress, navigate, PROGRESS_SAVED_EVENT } from "../lib";
import { getMyLibrary, USER_BOOKS_CHANGED_EVENT } from "../userBooks";

function findActiveBook(): {
  book: Book;
  pctLabel: string;
  pct: number;
} | null {
  const mine = getMyLibrary();
  const mineIds = new Set(mine.map((b) => b.id));
  const candidates = [
    ...mine,
    ...getCatalog().filter((b) => !mineIds.has(b.id)),
  ];

  let best: Book | null = null;
  let bestTs = 0;
  for (const b of candidates) {
    const p = loadProgress(b.id);
    if (!p.finishedAt && p.lastReadAt && p.lastReadAt > bestTs) {
      bestTs = p.lastReadAt;
      best = b;
    }
  }
  if (!best) return null;

  const p = loadProgress(best.id);
  let pct = 0;
  let pctLabel = "In progress";
  if (best.type === "pdf" && p.page && p.total) {
    pct = Math.min(1, Math.max(0, p.page / p.total));
    pctLabel = `p. ${p.page}/${p.total}`;
  } else if (p.pct != null) {
    pct = Math.min(1, Math.max(0, p.pct));
    pctLabel = `${Math.round(pct * 100)}%`;
  }
  return { book: best, pctLabel, pct };
}

/**
 * Compact "Now Reading" quick-resume card rendered in the left rail so
 * the user can jump back into their active book from Articles or Stats.
 */
export default function NowReadingCard() {
  const [active, setActive] = useState(findActiveBook);

  useEffect(() => {
    const refresh = () => setActive(findActiveBook());
    window.addEventListener(PROGRESS_SAVED_EVENT, refresh);
    window.addEventListener(USER_BOOKS_CHANGED_EVENT, refresh);
    window.addEventListener(CATALOG_LOADED_EVENT, refresh);
    return () => {
      window.removeEventListener(PROGRESS_SAVED_EVENT, refresh);
      window.removeEventListener(USER_BOOKS_CHANGED_EVENT, refresh);
      window.removeEventListener(CATALOG_LOADED_EVENT, refresh);
    };
  }, []);

  if (!active) return null;
  const { book, pctLabel, pct } = active;

  return (
    <button
      type="button"
      className="now-reading-rail-card"
      onClick={() => navigate(`#/book/${encodeURIComponent(book.id)}`)}
      title={`Resume reading ${book.title}`}
    >
      <div className="now-reading-rail-head">
        <span className="now-reading-rail-eyebrow">
          {book.type === "epub" ? (
            <BookOpen size={11} />
          ) : (
            <FileText size={11} />
          )}
          Now Reading
        </span>
        <span className="now-reading-rail-pct">{pctLabel}</span>
      </div>
      <div className="now-reading-rail-title-row">
        <strong className="now-reading-rail-title">{book.title}</strong>
        <span className="now-reading-rail-play" aria-hidden>
          <Play size={11} />
        </span>
      </div>
      {pct > 0 && (
        <div className="now-reading-rail-bar" aria-hidden>
          <span style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
      )}
    </button>
  );
}
