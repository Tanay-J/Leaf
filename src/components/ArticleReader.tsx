import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Highlighter,
  Loader2,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  ARTICLES_CHANGED_EVENT,
  PREDEFINED_TAGS,
  addArticleHighlight,
  formatTagLabel,
  getArticle,
  parseReaderResponse,
  removeArticleHighlight,
  setArticleProgress,
  setArticleRead,
  setArticleTags,
  toggleArticleTag,
  updateArticleExtracted,
  type ArticleHighlight,
  type SavedArticle,
} from "../articles";
import { fetchVaultArticleContent, syncArticleContent } from "../articleSync";
import {
  SETTINGS_CHANGED_EVENT,
  navigate,
  notifySettingsChanged,
  type Theme,
} from "../lib";
import { loadArticleContent, saveArticleContent } from "../localBooks";
import {
  ARTICLE_DEFAULT_LINE_HEIGHT,
  DEFAULT_SPACING_ID,
  fontStackFor,
  spacingValueFor,
} from "../typography";
import ThemeButton from "./ThemeButton";
import TypographyMenu from "./TypographyMenu";

interface Props {
  article: SavedArticle;
  theme: Theme;
  onCycleTheme: () => void;
  embedded?: boolean;
  listMinimized?: boolean;
  onToggleList?: () => void;
  onSelectTag?: (tag: string) => void;
}

const FONT_KEY = "article-font";
const FONT_FAMILY_KEY = "article-font-family";
const SPACING_KEY = "article-line-height";
const WIDE_KEY = "article-wide";

function loadWide(): boolean {
  try {
    return localStorage.getItem(WIDE_KEY) === "1";
  } catch {
    return false;
  }
}

function loadFont(): number {
  try {
    const n = Number(localStorage.getItem(FONT_KEY));
    if (n >= 70 && n <= 200) return n;
  } catch {
    /* private mode */
  }
  return 100;
}

function loadFontFamily(): string {
  try {
    return localStorage.getItem(FONT_FAMILY_KEY) ?? "";
  } catch {
    /* private mode */
    return "";
  }
}

function loadSpacingId(): string {
  try {
    return localStorage.getItem(SPACING_KEY) ?? DEFAULT_SPACING_ID;
  } catch {
    /* private mode */
    return DEFAULT_SPACING_ID;
  }
}

/**
 * Safely wraps saved highlight snippets inside text nodes of sanitized HTML
 * with <mark class="article-inline-hl" data-hl-id="..."> so HTML tags/links
 * are never corrupted.
 */
function injectHighlightsIntoHtml(
  rawHtml: string,
  highlights: ArticleHighlight[]
): string {
  if (!rawHtml || highlights.length === 0 || typeof document === "undefined") {
    return rawHtml;
  }
  const container = document.createElement("div");
  container.innerHTML = rawHtml;

  for (const hl of highlights) {
    const target = hl.text.trim();
    if (target.length < 2) continue;
    const lowerTarget = target.toLowerCase();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let current: Node | null = walker.nextNode();
    while (current) {
      if (
        current.parentElement &&
        !["MARK", "SCRIPT", "STYLE", "CODE", "PRE"].includes(
          current.parentElement.tagName
        )
      ) {
        textNodes.push(current as Text);
      }
      current = walker.nextNode();
    }
    for (const node of textNodes) {
      const val = node.nodeValue ?? "";
      const idx = val.toLowerCase().indexOf(lowerTarget);
      if (idx === -1) continue;
      const before = val.slice(0, idx);
      const match = val.slice(idx, idx + target.length);
      const after = val.slice(idx + target.length);
      const mark = document.createElement("mark");
      mark.className = "article-inline-hl";
      mark.setAttribute("data-hl-id", hl.id);
      mark.textContent = match;
      const frag = document.createDocumentFragment();
      if (before) frag.appendChild(document.createTextNode(before));
      frag.appendChild(mark);
      if (after) frag.appendChild(document.createTextNode(after));
      node.parentNode?.replaceChild(frag, node);
      break; // highlight first occurrence
    }
  }
  return container.innerHTML;
}

/**
 * Reader mode for a saved link. Content comes from Jina Reader
 * (https://r.jina.ai/<url>) — free, CORS-enabled, returns clean markdown —
 * then is rendered as sanitized HTML. Sites that block extraction fall
 * back to an "open original" escape hatch.
 */
export default function ArticleReader({
  article,
  theme,
  onCycleTheme,
  embedded,
  listMinimized,
  onToggleList,
  onSelectTag,
}: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [html, setHtml] = useState("");
  const [errorText, setErrorText] = useState("");
  const [fetchedTitle, setFetchedTitle] = useState<string | null>(null);
  const [font, setFont] = useState<number>(loadFont);
  const [fontFamily, setFontFamily] = useState<string>(loadFontFamily);
  const [spacingId, setSpacingId] = useState<string>(loadSpacingId);
  const [wide, setWide] = useState<boolean>(loadWide);
  const [scrollPct, setScrollPct] = useState<number>(() => article.progress ?? 0);
  const [tags, setTags] = useState<string[]>(() => article.tags ?? []);
  const [highlights, setHighlights] = useState<ArticleHighlight[]>(
    () => article.highlights ?? []
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hlOpen, setHlOpen] = useState(false);
  const [copiedHl, setCopiedHl] = useState(false);
  const [pendingSel, setPendingSel] = useState<string | null>(null);
  const [customTag, setCustomTag] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const hlMenuRef = useRef<HTMLDivElement>(null);
  const proseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTags(article.tags ?? []);
    setHighlights(article.highlights ?? []);
    setScrollPct(article.progress ?? 0);
    setPendingSel(null);
  }, [article.id, article.tags, article.highlights, article.progress]);

  useEffect(() => {
    if (!pickerOpen && !hlOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        pickerOpen &&
        pickerRef.current &&
        !pickerRef.current.contains(e.target as Node)
      ) {
        setPickerOpen(false);
      }
      if (
        hlOpen &&
        hlMenuRef.current &&
        !hlMenuRef.current.contains(e.target as Node)
      ) {
        setHlOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [pickerOpen, hlOpen]);

  useEffect(() => {
    const onArticles = () => {
      const fresh = getArticle(article.id);
      if (fresh) {
        setTags(fresh.tags ?? []);
        setHighlights(fresh.highlights ?? []);
      }
    };
    window.addEventListener(ARTICLES_CHANGED_EVENT, onArticles);
    return () => window.removeEventListener(ARTICLES_CHANGED_EVENT, onArticles);
  }, [article.id]);

  const highlightedHtml = useMemo(
    () => injectHighlightsIntoHtml(html, highlights),
    [html, highlights]
  );

  const checkSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setPendingSel(null);
      return;
    }
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (text.length < 3) {
      setPendingSel(null);
      return;
    }
    const anchor = sel.anchorNode;
    if (anchor && proseRef.current && proseRef.current.contains(anchor)) {
      setPendingSel(text);
    } else {
      setPendingSel(null);
    }
  };

  const saveSelectedHighlight = () => {
    if (!pendingSel) return;
    addArticleHighlight(article.id, pendingSel);
    window.getSelection()?.removeAllRanges();
    setPendingSel(null);
  };

  const copySelectedText = () => {
    if (!pendingSel) return;
    void navigator.clipboard?.writeText(pendingSel);
    window.getSelection()?.removeAllRanges();
    setPendingSel(null);
  };

  const jumpToHighlight = (id: string) => {
    const mark = proseRef.current?.querySelector(`[data-hl-id="${id}"]`);
    if (mark) {
      mark.scrollIntoView({ behavior: "smooth", block: "center" });
      setHlOpen(false);
    }
  };

  const copyHighlightsMarkdown = () => {
    const pageTitle = fetchedTitle ?? article.title;
    const lines = [
      `# ${pageTitle}`,
      `*Source: [${article.domain || article.url}](${article.url})*`,
      "",
      "## Highlights",
      "",
    ];
    for (const h of highlights) {
      lines.push(`> “${h.text}”`, "");
    }
    void navigator.clipboard?.writeText(lines.join("\n")).then(() => {
      setCopiedHl(true);
      window.setTimeout(() => setCopiedHl(false), 1800);
    });
  };

  const handleToggleTag = (tagId: string) => {
    toggleArticleTag(article.id, tagId);
  };

  const handleAddCustomTag = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = customTag.replace(/^#+/, "").trim().toLowerCase();
    if (!cleaned) return;
    setArticleTags(article.id, [...tags, cleaned]);
    setCustomTag("");
  };

  useEffect(() => {
    const onSettings = () => {
      setFont(loadFont());
      setFontFamily(loadFontFamily());
      setSpacingId(loadSpacingId());
    };
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettings);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettings);
  }, []);
  const [retry, setRetry] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    restoredRef.current = false;
    setStatus("loading");
    setErrorText("");
    setHtml("");
    setFetchedTitle(null);

    const render = (md: string): void => {
      const rendered = marked.parse(md) as string;
      setHtml(DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } }));
    };

    /* Stale-while-revalidate: show the cached copy immediately (offline
       friendly), then check vault sync or refresh from the source. */
    let hadCache = false;
    void loadArticleContent(article.id)
      .then(async (cached) => {
        if (disposed) return;
        if (cached) {
          hadCache = true;
          const parsed = parseReaderResponse(cached);
          render(parsed.markdown);
          setStatus("ready");
          setArticleRead(article.id, true);
          return;
        }
        const vaultMd = await fetchVaultArticleContent(article.id);
        if (disposed || !vaultMd) return;
        hadCache = true;
        const parsed = parseReaderResponse(vaultMd);
        render(parsed.markdown);
        setStatus("ready");
        setArticleRead(article.id, true);
        void saveArticleContent(article.id, parsed.markdown).catch(() => {});
      })
      .catch(() => {});

    (async () => {
      try {
        const res = await fetch(`https://r.jina.ai/${article.url}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.text();
        if (disposed) return;
        const parsed = parseReaderResponse(raw);
        render(parsed.markdown);
        setStatus("ready");
        setArticleRead(article.id, true);
        void saveArticleContent(article.id, parsed.markdown).catch(() => {});
        void syncArticleContent(article.id, parsed.markdown).catch(() => {});
        updateArticleExtracted(article.id, parsed);
        if (parsed.title) setFetchedTitle(parsed.title);
      } catch (err) {
        if (disposed || controller.signal.aborted) return;
        // A cached or vault-synced copy beats an error page.
        if (hadCache) return;
        setErrorText(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [article.id, article.url, retry]);

  useEffect(() => {
    if (status !== "ready") return;
    const el = scrollRef.current;
    if (!el) return;

    if (!restoredRef.current) {
      restoredRef.current = true;
      const target = article.progress ?? 0;
      if (target > 0.02) {
        requestAnimationFrame(() => {
          const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
          if (maxScroll > 0) {
            el.scrollTop = Math.round(maxScroll * target);
          }
        });
      }
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      if (maxScroll <= 0) return;
      const pct = Math.min(1, Math.max(0, el.scrollTop / maxScroll));
      setScrollPct(pct);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setArticleProgress(article.id, pct);
      }, 400);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [status, article.id, article.progress]);

  function changeFont(delta: number): void {
    setFont((f) => {
      const next = Math.min(180, Math.max(80, f + delta));
      try {
        localStorage.setItem(FONT_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    notifySettingsChanged();
  }

  function changeFontFamily(id: string): void {
    setFontFamily(id);
    try {
      localStorage.setItem(FONT_FAMILY_KEY, id);
    } catch {
      /* ignore */
    }
    notifySettingsChanged();
  }

  function changeSpacing(id: string): void {
    setSpacingId(id);
    try {
      localStorage.setItem(SPACING_KEY, id);
    } catch {
      /* ignore */
    }
    notifySettingsChanged();
  }

  function toggleWide(): void {
    setWide((w) => {
      const next = !w;
      try {
        localStorage.setItem(WIDE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const title = fetchedTitle ?? article.title;

  return (
    <div className={`article-reader${embedded ? " embedded-article-reader" : ""}`}>
      <header className="topbar reader-topbar article-reader-topbar">
        <div className="topbar-actions">
          {embedded && onToggleList ? (
            <button
              type="button"
              className="secondary-action"
              onClick={onToggleList}
              title={listMinimized ? "Show reading list" : "Collapse reading list"}
            >
              {listMinimized ? (
                <PanelLeftOpen size={15} />
              ) : (
                <PanelLeftClose size={15} />
              )}
              {listMinimized ? "Show List" : "Hide List"}
            </button>
          ) : (
            <button className="secondary-action" onClick={() => navigate("#/articles")}>
              <ArrowLeft size={15} />
              Reading list
            </button>
          )}
        </div>
        <div className="reader-title">
          <strong>{title}</strong>
          <span>
            {article.domain}
            {article.readingMinutes ? ` · ${article.readingMinutes} min read` : ""}
          </span>
        </div>
        <div className="topbar-actions">
          <div className="reader-tag-menu-wrap" ref={hlMenuRef}>
            <button
              type="button"
              className={`icon-btn reader-tag-btn${highlights.length > 0 || hlOpen ? " active" : ""}`}
              onClick={() => setHlOpen((o) => !o)}
              title="Article highlights & notes"
              aria-label="Article highlights"
            >
              <Highlighter size={14} />
              {highlights.length > 0 && (
                <span className="reader-tag-count">{highlights.length}</span>
              )}
            </button>
            {hlOpen && (
              <div
                className="reader-tag-dropdown article-hl-dropdown"
                role="dialog"
                aria-label="Article highlights"
              >
                <div className="reader-tag-dropdown-head">
                  <strong>Highlights ({highlights.length})</strong>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {highlights.length > 0 && (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={copyHighlightsMarkdown}
                        title="Copy all highlights as Markdown"
                      >
                        {copiedHl ? <Check size={12} /> : <Copy size={12} />}
                        {copiedHl ? "Copied" : "Markdown"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={() => setHlOpen(false)}
                      aria-label="Close highlights menu"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
                {highlights.length === 0 ? (
                  <p className="inspector-empty-notes" style={{ margin: 0 }}>
                    Select any text inside the article to highlight key passages.
                  </p>
                ) : (
                  <div className="article-hl-list">
                    {highlights.map((h) => (
                      <div key={h.id} className="inspector-note-card">
                        <button
                          type="button"
                          className="inspector-note-jump"
                          onClick={() => jumpToHighlight(h.id)}
                        >
                          <blockquote>“{h.text}”</blockquote>
                        </button>
                        <button
                          type="button"
                          className="note-del-btn"
                          onClick={() => removeArticleHighlight(article.id, h.id)}
                          title="Delete highlight"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="reader-tag-menu-wrap" ref={pickerRef}>
            <button
              type="button"
              className={`icon-btn reader-tag-btn${tags.length > 0 || pickerOpen ? " active" : ""}`}
              onClick={() => setPickerOpen((o) => !o)}
              title="Tag article"
              aria-label="Tag article"
            >
              <Tag size={14} />
              {tags.length > 0 && <span className="reader-tag-count">{tags.length}</span>}
            </button>
            {pickerOpen && (
              <div className="reader-tag-dropdown" role="dialog" aria-label="Article tags">
                <div className="reader-tag-dropdown-head">
                  <strong>Tags</strong>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => setPickerOpen(false)}
                    aria-label="Close tags menu"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="tag-picker-presets">
                  {PREDEFINED_TAGS.map((preset) => {
                    const active = tags.includes(preset.id);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`preset-tag-chip${active ? " active" : ""}`}
                        onClick={() => handleToggleTag(preset.id)}
                      >
                        {active ? <Check size={10} /> : <Plus size={10} />}
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <form className="tag-picker-custom" onSubmit={handleAddCustomTag}>
                  <input
                    type="text"
                    value={customTag}
                    onChange={(e) => setCustomTag(e.target.value)}
                    placeholder="Custom tag…"
                    aria-label="Add custom tag"
                  />
                  <button type="submit" className="tag-custom-add-btn" disabled={!customTag.trim()}>
                    Add
                  </button>
                </form>
              </div>
            )}
          </div>
          <button
            type="button"
            className={`icon-btn${wide ? " active" : ""}`}
            onClick={toggleWide}
            title={wide ? "Standard reading width" : "Wide reading width"}
            aria-label="Toggle reading width"
          >
            {wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setRetry((r) => r + 1)}
            title="Re-fetch fresh copy from web"
            aria-label="Refresh article"
          >
            <RefreshCw size={14} />
          </button>
          <a
            className="icon-btn"
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open original"
          >
            <ExternalLink size={15} />
          </a>
          <TypographyMenu
            fontId={fontFamily}
            spacingId={spacingId}
            fontSize={font}
            onFont={changeFontFamily}
            onSpacing={changeSpacing}
            onSize={changeFont}
          />
          {!embedded && <ThemeButton theme={theme} onCycleTheme={onCycleTheme} />}
        </div>
        {scrollPct > 0.01 && (
          <div className="reader-progress" aria-hidden>
            <span style={{ width: `${Math.round(scrollPct * 100)}%` }} />
          </div>
        )}
      </header>

      <main className="article-body">
        {status === "loading" && (
          <div className="pane-overlay">
            <Loader2 className="spin" size={26} />
            <span>Fetching article…</span>
          </div>
        )}
        {status === "error" && (
          <div className="error-pane">
            <strong>Could not fetch this article.</strong>
            <p>{errorText}</p>
            <p>The site may block reader extraction or require a login.</p>
            <div className="error-actions">
              <button className="secondary-action" onClick={() => setRetry((r) => r + 1)}>
                Retry
              </button>
              <a
                className="secondary-action"
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open original
                <ExternalLink size={14} />
              </a>
            </div>
          </div>
        )}
        {status === "ready" && (
          <div className="article-scroll" ref={scrollRef}>
            {pendingSel && (
              <div
                className="epub-selection-bar article-selection-bar"
                role="toolbar"
                aria-label="Text selection actions"
              >
                <button
                  type="button"
                  className="selection-action-btn primary"
                  onClick={saveSelectedHighlight}
                >
                  <Highlighter size={13} />
                  Highlight
                </button>
                <button
                  type="button"
                  className="selection-action-btn"
                  onClick={copySelectedText}
                >
                  <Copy size={13} />
                  Copy
                </button>
                <button
                  type="button"
                  className="selection-action-btn"
                  onClick={() => {
                    window.getSelection()?.removeAllRanges();
                    setPendingSel(null);
                  }}
                  aria-label="Dismiss"
                >
                  <X size={13} />
                </button>
              </div>
            )}
            <article className={`article-sheet${wide ? " wide" : ""}`}>
              {tags.length > 0 && (
                <div className="article-sheet-tags">
                  {tags.map((t) => (
                    <span key={t} className="article-tag reader-tag-pill">
                      <button
                        type="button"
                        className="reader-tag-pill-label"
                        onClick={() => onSelectTag?.(t)}
                      >
                        #{formatTagLabel(t)}
                      </button>
                      <button
                        type="button"
                        className="reader-tag-pill-remove"
                        onClick={() => handleToggleTag(t)}
                        aria-label={`Remove ${t}`}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div
                ref={proseRef}
                className="article-prose"
                onMouseUp={checkSelection}
                onKeyUp={checkSelection}
                onTouchEnd={checkSelection}
                style={{
                  fontSize: `${font}%`,
                  fontFamily: fontStackFor(fontFamily),
                  lineHeight: spacingValueFor(spacingId) ?? ARTICLE_DEFAULT_LINE_HEIGHT,
                }}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
              {highlights.length > 0 && (
                <section className="article-highlights-footer">
                  <div className="inspector-notes-head">
                    <span className="studio-nav-label">
                      Saved Highlights ({highlights.length})
                    </span>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={copyHighlightsMarkdown}
                    >
                      {copiedHl ? <Check size={12} /> : <Copy size={12} />}
                      {copiedHl ? "Copied Markdown" : "Copy as Markdown"}
                    </button>
                  </div>
                  <div className="inspector-notes-list">
                    {highlights.map((h) => (
                      <div key={h.id} className="inspector-note-card">
                        <button
                          type="button"
                          className="inspector-note-jump"
                          onClick={() => jumpToHighlight(h.id)}
                        >
                          <blockquote>“{h.text}”</blockquote>
                        </button>
                        <button
                          type="button"
                          className="note-del-btn"
                          onClick={() => removeArticleHighlight(article.id, h.id)}
                          title="Delete highlight"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <p className="article-source">
                Source:{" "}
                <a href={article.url} target="_blank" rel="noopener noreferrer">
                  {article.domain || article.url}
                </a>
              </p>
            </article>
          </div>
        )}
      </main>
    </div>
  );
}
