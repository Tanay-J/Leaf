import { useState, type ReactNode } from "react";
import { ArrowLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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

export default function Reader({ book, theme, onCycleTheme }: Props) {
  // Format-specific controls (TOC / font size / zoom) are rendered by the
  // child reader into the topbar via this slot.
  const [controls, setControls] = useState<ReactNode>(null);
  // Format-specific sidebar content (table of contents) rendered into the
  // collapsible left pane.
  const [sidebar, setSidebar] = useState<ReactNode>(null);
  const { sidebarOpen, toggleSidebar } = useSidebarOpen();

  return (
    <div className="reader-shell">
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
          <ThemeButton theme={theme} onCycleTheme={onCycleTheme} />
        </div>
      </header>

      <div className="reader-body">
        <aside className={`reader-sidebar ${sidebarOpen ? "" : "collapsed"}`}>
          <div className="reader-sidebar-inner">
            <h2 className="reader-sidebar-title">Contents</h2>
            {sidebar ?? (
              <p className="reader-sidebar-empty">No contents to show.</p>
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
            />
          ) : (
            <PdfReader
              book={book}
              setControls={setControls}
              setSidebar={setSidebar}
            />
          )}
        </main>
      </div>
    </div>
  );
}
