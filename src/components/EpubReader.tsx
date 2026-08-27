import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus } from "lucide-react";
import ePub from "epubjs";
import type { Book as EpubBook, Rendition } from "epubjs";
import type { Book } from "../books";
import { loadProgress, saveProgress, type Theme } from "../lib";
import { loadBook } from "../bookLoader";

/* Font choices offered in the reader topbar. An empty stack keeps the
   book's own typography untouched. */
const FONT_OPTIONS: { id: string; label: string; stack?: string }[] = [
  { id: "", label: "Default font" },
  {
    id: "serif",
    label: "Serif — Georgia",
    stack: "Georgia, 'Times New Roman', serif",
  },
  {
    id: "book",
    label: "Book — Palatino",
    stack: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  },
  {
    id: "sans",
    label: "Sans — System",
    stack:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  },
];

/* Warm paper tint injected into the book body in sepia mode.
   Mirrors the --bg-app value of html.sepia-theme. */
const SEPIA_BODY_BG = "#f4ead8";

interface TocEntry {
  label: string;
  href: string;
  depth: number;
}

interface Props {
  book: Book;
  theme: Theme;
  setControls: (node: ReactNode) => void;
  setSidebar: (node: ReactNode) => void;
}

export default function EpubReader({
  book,
  theme,
  setControls,
  setSidebar,
}: Props) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const tocRef = useRef<TocEntry[]>([]);

  const [toc, setToc] = useState<TocEntry[]>([]);
  const [activeToc, setActiveToc] = useState(-1);
  const [chapter, setChapter] = useState("");
  const [fontSize, setFontSize] = useState<number>(
    () => loadProgress(book.id).fontSize ?? 100
  );
  const [fontFamily, setFontFamily] = useState<string>(
    () => loadProgress(book.id).fontFamily ?? ""
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [errorText, setErrorText] = useState("");

  /* Fetch the book bytes, then create the rendition. */
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    let disposed = false;
    let eb: EpubBook | null = null;
    let rendition: Rendition | null = null;
    const saved = loadProgress(book.id);

    (async () => {
      try {
        const data = await loadBook(book);
        if (disposed) return;

        eb = ePub(data);
        rendition = eb.renderTo(el, {
          width: "100%",
          height: "100%",
          spread: "none",
        });
        renditionRef.current = rendition;

        // Flatten the table of contents into a dropdown list.
        eb.loaded.navigation
          .then((nav) => {
            if (disposed) return;
            const entries: TocEntry[] = [];
            const walk = (items: unknown[], depth: number) => {
              for (const raw of items ?? []) {
                const item = raw as {
                  label?: string;
                  href?: string;
                  subitems?: unknown[];
                };
                entries.push({
                  label: String(item.label ?? "").trim(),
                  href: String(item.href ?? ""),
                  depth,
                });
                if (item.subitems?.length) walk(item.subitems, depth + 1);
              }
            };
            walk((nav as { toc?: unknown[] }).toc ?? [], 0);
            tocRef.current = entries;
            setToc(entries);
          })
          .catch(() => undefined);

        // Track position and persist progress.
        rendition.on("relocated", (loc: unknown) => {
          const start = (loc as { start?: { cfi?: string; href?: string } })
            ?.start;
          const cfi = start?.cfi ?? "";
          const href = (start?.href ?? "").split("#")[0];
          const entries = tocRef.current;
          const idx = entries.findIndex((it) => it.href.split("#")[0] === href);
          const label = idx >= 0 ? entries[idx].label : "";
          setChapter(label);
          setActiveToc(idx);
          saveProgress(book.id, {
            ...loadProgress(book.id),
            cfi,
            chapter: label,
          });
        });

        await rendition.display(saved.cfi || undefined);
        if (!disposed) setStatus("ready");
      } catch (err) {
        if (disposed) return;
        setStatus("error");
        setErrorText(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      disposed = true;
      renditionRef.current = null;
      rendition?.destroy();
      eb?.destroy();
    };
  }, [book.id, book.url]);

  /* Apply typography and the sepia page tint whenever they change. */
  useEffect(() => {
    const themes = renditionRef.current?.themes;
    if (!themes) return;

    // epubjs implements removeOverride() at runtime but omits it from types.
    const t = themes as typeof themes & { removeOverride(name: string): void };

    const stack = FONT_OPTIONS.find((o) => o.id === fontFamily)?.stack;
    if (stack) {
      t.font(stack);
    } else {
      t.removeOverride("font-family");
    }

    themes.fontSize(`${fontSize}%`);

    if (theme === "sepia") {
      themes.override("background-color", SEPIA_BODY_BG);
    } else {
      t.removeOverride("background-color");
    }
  }, [fontSize, fontFamily, theme, status]);

  useEffect(() => {
    saveProgress(book.id, {
      ...loadProgress(book.id),
      fontSize,
      fontFamily,
    });
  }, [fontSize, fontFamily, book.id]);

  const changeFont = (delta: number) =>
    setFontSize((f) => Math.min(200, Math.max(60, f + delta)));

  const goPrev = useCallback(() => renditionRef.current?.prev(), []);
  const goNext = useCallback(() => renditionRef.current?.next(), []);

  /* Keyboard navigation. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
      ) {
        return;
      }
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext]);

  /* Render format-specific controls into the topbar slot. */
  useEffect(() => {
    setControls(
      <>
        <select
          className="control-select"
          value={fontFamily}
          onChange={(e) => setFontFamily(e.target.value)}
          title="Font style"
        >
          {FONT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          className="mini-btn"
          onClick={() => changeFont(-10)}
          title="Smaller text"
        >
          <Minus size={14} />
        </button>
        <span className="pos-label">{fontSize}%</span>
        <button
          className="mini-btn"
          onClick={() => changeFont(10)}
          title="Larger text"
        >
          <Plus size={14} />
        </button>
      </>
    );
    return () => setControls(null);
  }, [fontSize, fontFamily, setControls]);

  /* Render the table of contents into the collapsible sidebar. */
  useEffect(() => {
    if (toc.length === 0) {
      setSidebar(null);
      return () => setSidebar(null);
    }
    setSidebar(
      <ul className="toc-list">
        {toc.map((it, i) => (
          <li key={`${it.href}-${i}`}>
            <button
              className={`toc-item${i === activeToc ? " active" : ""}`}
              style={{ paddingLeft: 12 + it.depth * 14 }}
              onClick={() => renditionRef.current?.display(it.href)}
            >
              {it.label || "Untitled"}
            </button>
          </li>
        ))}
      </ul>
    );
    return () => setSidebar(null);
  }, [toc, activeToc, setSidebar]);

  return (
    <div className="format-reader">
      {status === "loading" && (
        <div className="pane-overlay">
          <Loader2 className="spin" size={26} />
          <span>Loading book…</span>
        </div>
      )}
      {status === "error" && (
        <div className="error-pane">
          <strong>Could not load “{book.title}”.</strong>
          <p>{errorText}</p>
          <p>
            If this looks like a network/CORS error, host the file somewhere
            that sends Access-Control-Allow-Origin (GitHub Pages and
            raw.githubusercontent.com both do).
          </p>
        </div>
      )}
      <div ref={viewerRef} className="epub-viewer" />
      <footer className="reader-navbar">
        <button className="nav-btn" onClick={goPrev}>
          <ChevronLeft size={15} />
          Prev
        </button>
        <span className="nav-pos">{chapter}</span>
        <button className="nav-btn" onClick={goNext}>
          Next
          <ChevronRight size={15} />
        </button>
      </footer>
    </div>
  );
}