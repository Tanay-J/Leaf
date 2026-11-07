import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Keyboard,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import type { Book } from "../books";
import { navigate, useSidebarOpen, type Theme } from "../lib";
import EpubReader from "./EpubReader";
import PdfReader from "./PdfReader";
import ThemeButton from "./ThemeButton";

interface Props {
  book: Book;
  theme: Theme;
  onCycleTheme: () => void;
}

const SHORTCUTS: [string, string][] = [
  ["← / →, J / K", "Previous / next page"],
  ["Space / Shift+Space", "Next / previous page"],
  ["B", "Bookmark current page"],
  ["S", "Toggle the contents sidebar"],
  ["Z", "Distraction-free focus mode"],
  ["F", "Fullscreen"],
  ["Esc", "Close panels or exit focus mode"],
  ["?", "This shortcut list"],
];

export default function Reader({ book, theme, onCycleTheme }: Props) {
  // Format-specific controls (TOC / font size / zoom) are rendered by the
  // child reader into the topbar via this slot.
  const [controls, setControls] = useState<ReactNode>(null);
  // Format-specific sidebar content (table of contents) rendered into the
  // collapsible left pane.
  const [sidebar, setSidebar] = useState<ReactNode>(null);
  const { sidebarOpen, toggleSidebar } = useSidebarOpen();
  const [zenMode, setZenMode] = useState(false);

  // Reading position as 0..1, reported by the active reader — drawn as the
  // thin progress line under the topbar.
  const [pct, setPct] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  /* Reader-level shortcuts: sidebar, zen mode, fullscreen, help. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
      ) {
        return;
      }
      if (e.key === "Escape") {
        if (showHelp) {
          setShowHelp(false);
          return;
        }
        if (zenMode) {
          setZenMode(false);
          return;
        }
      }
      if (e.key === "s") toggleSidebar();
      if (e.key === "z") setZenMode((z) => !z);
      if (e.key === "f") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      }
      if (e.key === "?") setShowHelp((h) => !h);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHelp, zenMode, toggleSidebar]);

  return (
    <div className={`reader-shell${zenMode ? " zen-mode" : ""}`}>
      {zenMode && (
        <button
          type="button"
          className="zen-exit-btn"
          onClick={() => setZenMode(false)}
          title="Exit focus mode (Z or Esc)"
          aria-label="Exit focus mode"
        >
          <Minimize2 size={14} />
        </button>
      )}
      <header className="topbar reader-topbar">
        <div className="topbar-actions">
          <button className="secondary-action" onClick={() => navigate("#/")}>
            <ArrowLeft size={15} />
            Library
          </button>
          <button
            className="icon-btn"
            onClick={toggleSidebar}
            title={sidebarOpen ? "Hide contents" : "Show contents"}
          >
            {sidebarOpen ? (
              <PanelLeftClose size={16} />
            ) : (
              <PanelLeftOpen size={16} />
            )}
          </button>
        </div>
        <div className="reader-title">
          <strong>{book.title}</strong>
          {book.author && <span>{book.author}</span>}
        </div>
        <div className="topbar-actions">
          {controls}
          <button
            className="icon-btn"
            onClick={() => setZenMode(true)}
            title="Focus mode (Z)"
            aria-label="Focus mode"
          >
            <Maximize2 size={15} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowHelp((h) => !h)}
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
          >
            <Keyboard size={16} />
          </button>
          <ThemeButton theme={theme} onCycleTheme={onCycleTheme} />
        </div>
        {pct != null && (
          <div className="reader-progress" aria-hidden>
            <span style={{ width: `${Math.round(pct * 100)}%` }} />
          </div>
        )}
      </header>

      {showHelp && (
        <div className="kbd-pop" role="dialog" aria-label="Keyboard shortcuts">
          <div className="kbd-pop-head">
            <strong>Keyboard shortcuts</strong>
            <button
              className="icon-btn"
              onClick={() => setShowHelp(false)}
              aria-label="Close shortcuts"
            >
              <X size={14} />
            </button>
          </div>
          {SHORTCUTS.map(([keys, desc]) => (
            <div className="kbd-row" key={keys}>
              <span>{desc}</span>
              <kbd>{keys}</kbd>
            </div>
          ))}
        </div>
      )}

      <div className="reader-body">
        <aside className={`reader-sidebar ${sidebarOpen ? "" : "collapsed"}`}>
          <div className="reader-sidebar-inner">
            {sidebar ?? (
              <>
                <h2 className="reader-sidebar-title">Contents</h2>
                <p className="reader-sidebar-empty">No contents to show.</p>
              </>
            )}
          </div>
        </aside>

        <main className="reader-stage">
          {book.type === "epub" ? (
            <EpubReader
              book={book}
              theme={theme}
              setControls={setControls}
              setSidebar={setSidebar}
              onProgress={setPct}
            />
          ) : (
            <PdfReader
              book={book}
              setControls={setControls}
              setSidebar={setSidebar}
              onProgress={setPct}
            />
          )}
        </main>
      </div>
    </div>
  );
}
