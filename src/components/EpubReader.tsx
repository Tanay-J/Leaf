import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus, Search } from "lucide-react";
import ePub from "epubjs";
import type { Book as EpubBook, Rendition } from "epubjs";
import type { Book } from "../books";
import { addReadingSeconds, loadProgress, saveProgress, type Theme } from "../lib";
import { loadBook } from "../bookLoader";
import SearchPanel, { type SearchHit } from "./SearchPanel";
import {
  FONT_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  DEFAULT_SPACING_ID,
  fontStackFor,
  spacingValueFor,
} from "../typography";
import {
  PassphraseRequiredError,
  WrongPassphraseError,
  setStoredPassphrase,
} from "../bookCrypto";
import PassphrasePrompt from "./PassphrasePrompt";

/* Font and spacing choices live in src/typography.ts, shared with the
   article reader. */

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
  const bookRef = useRef<EpubBook | null>(null);

  const [toc, setToc] = useState<TocEntry[]>([]);
  const [activeToc, setActiveToc] = useState(-1);
  const [chapter, setChapter] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searched, setSearched] = useState("");
  const [fontSize, setFontSize] = useState<number>(
    () => loadProgress(book.id).fontSize ?? 100
  );
  const [fontFamily, setFontFamily] = useState<string>(
    () => loadProgress(book.id).fontFamily ?? ""
  );
  const [spacingId, setSpacingId] = useState<string>(() => {
    const lh = loadProgress(book.id).lineHeight;
    const opt = LINE_HEIGHT_OPTIONS.find((o) => o.value === lh);
    return opt?.id ?? DEFAULT_SPACING_ID;
  });
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [errorText, setErrorText] = useState("");
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [wrongPassphrase, setWrongPassphrase] = useState(false);
  const [unlockAttempt, setUnlockAttempt] = useState(0);

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
        bookRef.current = eb;
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
          const location = loc as {
            start?: { cfi?: string; href?: string };
            end?: { percentage?: number };
          };
          const start = location?.start;
          const cfi = start?.cfi ?? "";
          const href = (start?.href ?? "").split("#")[0];
          const entries = tocRef.current;
          const idx = entries.findIndex((it) => it.href.split("#")[0] === href);
          const label = idx >= 0 ? entries[idx].label : "";
          setChapter(label);
          setActiveToc(idx);
          const prev = loadProgress(book.id);
          const pct = location?.end?.percentage ?? 0;
          saveProgress(book.id, {
            ...prev,
            cfi,
            chapter: label,
            // Reading position as 0..1, surfaced on library cards.
            pct: Math.round(Math.min(1, Math.max(0, pct)) * 1000) / 1000,
            lastReadAt: Date.now(),
            updatedAt: Date.now(),
            ...(pct >= 0.995 && !prev.finishedAt
              ? { finishedAt: Date.now() }
              : {}),
          });
        });

        await rendition.display(saved.cfi || undefined);
        if (!disposed) setStatus("ready");
      } catch (err) {
        if (disposed) return;
        if (err instanceof PassphraseRequiredError) {
          setNeedsPassphrase(true);
          setWrongPassphrase(false);
          return;
        }
        if (err instanceof WrongPassphraseError) {
          setNeedsPassphrase(true);
          setWrongPassphrase(true);
          return;
        }
        setStatus("error");
        setErrorText(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      disposed = true;
      bookRef.current = null;
      renditionRef.current = null;
      rendition?.destroy();
      eb?.destroy();
    };
  }, [book.id, book.url, unlockAttempt]);

  /* Called by PassphrasePrompt once the visitor submits a passphrase. */
  const handleUnlock = (pw: string) => {
    setStoredPassphrase(pw);
    setNeedsPassphrase(false);
    setWrongPassphrase(false);
    setStatus("loading");
    setUnlockAttempt((n) => n + 1);
  };

  /* Apply typography and the sepia page tint whenever they change. */
  useEffect(() => {
    const themes = renditionRef.current?.themes;
    if (!themes) return;

    // epubjs implements removeOverride() at runtime but omits it from types.
    const t = themes as typeof themes & { removeOverride(name: string): void };

    const stack = fontStackFor(fontFamily);
    if (stack) {
      t.font(stack);
    } else {
      t.removeOverride("font-family");
    }

    themes.fontSize(`${fontSize}%`);

    /* Line spacing: a registered theme with !important rules, so books that
       set line-height on <p> don't defeat it. Re-registering the same name
       updates the injected stylesheet in place (epubjs handles dedupe). */
    const lh = spacingValueFor(spacingId);
    const spacingRules: Record<string, Record<string, string>> = {};
    if (lh) {
      for (const sel of ["body", "p", "li"]) {
        spacingRules[sel] = { "line-height": `${lh} !important` };
      }
    }
    themes.register("leaf-line-spacing", spacingRules);
    themes.select("leaf-line-spacing");

    if (theme === "sepia") {
      themes.override("background-color", SEPIA_BODY_BG);
    } else {
      t.removeOverride("background-color");
    }
  }, [fontSize, fontFamily, spacingId, theme, status]);

  useEffect(() => {
    saveProgress(book.id, {
      ...loadProgress(book.id),
      fontSize,
      fontFamily,
      lineHeight: spacingValueFor(spacingId),
    });
  }, [fontSize, fontFamily, spacingId, book.id]);

  const changeFont = (delta: number) =>
    setFontSize((f) => Math.min(200, Math.max(60, f + delta)));

  const goPrev = useCallback(() => renditionRef.current?.prev(), []);
  const goNext = useCallback(() => renditionRef.current?.next(), []);

  /* Reading-time tracking: 15 s ticks while the book is open in a visible
     tab. Time rides along on the next progress push (no extra sync events). */
  useEffect(() => {
    if (status !== "ready") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        addReadingSeconds(book.id, 15);
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [status, book.id]);

  /* In-book search: scans each spine section's text (debounced). Results
     jump to the section they came from. */
  useEffect(() => {
    if (!searchOpen) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearched("");
      return;
    }
    let disposed = false;
    const timer = window.setTimeout(async () => {
      setSearchBusy(true);
      const hits: SearchHit[] = [];
      const lower = q.toLowerCase();
      const eb = bookRef.current;
      if (eb) {
        // spineItems exists at runtime but is missing from epubjs's types.
        type SpineItem = {
          href: string;
          load(req?: unknown): Promise<Document | undefined | null>;
          unload(): void;
        };
        const items =
          (eb.spine as unknown as { spineItems?: SpineItem[] }).spineItems ??
          [];
        for (const item of items) {
          try {
            const doc = await item.load(eb.load.bind(eb));
            const text = (doc?.body?.textContent ?? "")
              .replace(/\s+/g, " ")
              .trim();
            if (text) {
              const lowerText = text.toLowerCase();
              let idx = lowerText.indexOf(lower);
              let count = 0;
              const label =
                tocRef.current.find(
                  (t) => t.href.split("#")[0] === item.href.split("#")[0]
                )?.label || item.href;
              while (idx !== -1 && count < 2 && hits.length < 30) {
                const from = Math.max(0, idx - 60);
                const to = Math.min(text.length, idx + lower.length + 60);
                hits.push({
                  id: `${item.href}-${idx}`,
                  where: label,
                  excerpt: `${from > 0 ? "…" : ""}${text.slice(from, to)}${
                    to < text.length ? "…" : ""
                  }`,
                  href: item.href,
                });
                count++;
                idx = lowerText.indexOf(lower, idx + lower.length);
              }
            }
          } catch {
            /* skip unreadable sections */
          } finally {
            try {
              item.unload();
            } catch {
              /* ignore */
            }
          }
          if (hits.length >= 30) break;
        }
      }
      if (disposed) return;
      setResults(hits);
      setSearched(q);
      setSearchBusy(false);
    }, 350);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [query, searchOpen]);

  const pickSearch = (hit: SearchHit) => {
    if (hit.href) void renditionRef.current?.display(hit.href);
    setSearchOpen(false);
  };

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
        <button
          className={`mini-btn${searchOpen ? " active" : ""}`}
          onClick={() => setSearchOpen((o) => !o)}
          title="Search in book"
          aria-label="Search in book"
        >
          <Search size={14} />
        </button>
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
        <select
          className="control-select"
          value={spacingId}
          onChange={(e) => setSpacingId(e.target.value)}
          title="Line spacing"
        >
          {LINE_HEIGHT_OPTIONS.map((o) => (
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
  }, [fontSize, fontFamily, spacingId, searchOpen, setControls]);

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
      <SearchPanel
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        query={query}
        onQueryChange={setQuery}
        results={results}
        busy={searchBusy}
        searched={searched}
        onPick={pickSearch}
      />
      {status === "loading" && !needsPassphrase && (
        <div className="pane-overlay">
          <Loader2 className="spin" size={26} />
          <span>Loading book…</span>
        </div>
      )}
      {needsPassphrase && (
        <PassphrasePrompt
          wrong={wrongPassphrase}
          onSubmit={handleUnlock}
        />
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