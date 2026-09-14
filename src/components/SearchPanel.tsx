import { Loader2, Search, X } from "lucide-react";

export interface SearchHit {
  /** Unique key for React. */
  id: string;
  /** Primary label, e.g. chapter title or page number. */
  where: string;
  excerpt: string;
  /** EPUB: spine href to display when picked. */
  href?: string;
  /** PDF: page number to show when picked. */
  page?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  results: SearchHit[];
  busy: boolean;
  searched: string;
  onPick: (hit: SearchHit) => void;
}

/**
 * Floating in-book search panel, shared by the EPUB and PDF readers. The
 * parent owns the query/results logic; this is purely presentational.
 */
export default function SearchPanel({
  open,
  onClose,
  query,
  onQueryChange,
  results,
  busy,
  searched,
  onPick,
}: Props) {
  if (!open) return null;
  return (
    <div className="search-panel" role="dialog" aria-label="Search in book">
      <div className="search-panel-head">
        <div className="search-shell search-panel-input">
          <Search size={15} />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search this book…"
            aria-label="Search this book"
          />
        </div>
        <button
          className="icon-btn"
          onClick={onClose}
          title="Close search"
          aria-label="Close search"
        >
          <X size={16} />
        </button>
      </div>
      <div className="search-panel-body">
        {busy && (
          <p className="search-status">
            <Loader2 className="spin" size={14} /> Searching…
          </p>
        )}
        {!busy && query.trim().length >= 2 && searched !== "" && (
          <p className="search-status">
            {results.length === 0
              ? `No matches for “${searched}”.`
              : `${results.length} match${results.length === 1 ? "" : "es"}`}
          </p>
        )}
        {!busy && query.trim().length < 2 && (
          <p className="search-status">Type at least 2 characters.</p>
        )}
        <ul className="search-results">
          {results.map((hit) => (
            <li key={hit.id}>
              <button
                className="search-hit"
                onClick={() => onPick(hit)}
                title={hit.where}
              >
                <span className="search-hit-where">{hit.where}</span>
                <span className="search-hit-excerpt">{hit.excerpt}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}