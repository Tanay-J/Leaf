import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  BookOpen,
  Check,
  CloudUpload,
  Compass,
  FileText,
  FolderOpen,
  LayoutGrid,
  List,
  Loader2,
  Newspaper,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { getCatalog, loadCatalog, reloadCatalog, type Book } from "../books";
import { loadArticles } from "../articles";
import { loadAllProgress, loadProgress, navigate, readDays, useLibraryView, type Theme } from "../lib";
import ThemeButton from "./ThemeButton";
import { findKeyBySha, hashBlob, loadCover, saveCover } from "../localBooks";
import { readEpubMeta } from "../epubMeta";
import {
  addUserBook,
  deriveBookTitle,
  detectBookType,
  getMyLibrary,
  addLocalBook,
  pinBook,
  removeUserBook,
  USER_BOOKS_CHANGED_EVENT,
  type BookType,
} from "../userBooks";
import {
  canWatchDeploys,
  getVaultStatus,
  uploadToVault,
  VAULT_STATUS_EVENT,
  vaultConnect,
  vaultDisconnect,
  vaultEnableWatch,
  waitForDeploy,
  type VaultStatus,
} from "../vaultSync";

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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/** What the quiet stats strip on My library shows. */
function readingStats(): { finished: number; inProgress: number; streak: number } {
  let finished = 0;
  let inProgress = 0;
  for (const p of Object.values(loadAllProgress())) {
    if (p.finishedAt) finished++;
    else if (p.lastReadAt) inProgress++;
  }
  const days = readDays();
  const key = (d: Date) => d.toLocaleDateString("en-CA");
  let streak = 0;
  const cursor = new Date();
  if (!days[key(cursor)]) cursor.setDate(cursor.getDate() - 1);
  while (days[key(cursor)]) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { finished, inProgress, streak };
}

interface Props {
  theme: Theme;
  onCycleTheme: () => void;
}

export default function Library({ theme, onCycleTheme }: Props) {
  const [query, setQuery] = useState("");
  const { view, setView } = useLibraryView();
  /* Which collection is on screen: your picks or the built-in catalog. */
  const [tab, setTab] = useState<"mine" | "browse">("mine");
  const [books, setBooks] = useState<Book[]>(() => getMyLibrary());
  /* Browse shelf: the CI-published catalog (static list until it loads). */
  const [catalog, setCatalog] = useState<Book[]>(getCatalog);
  const unreadArticles = useMemo(
    () => loadArticles().filter((a) => !a.readAt).length,
    []
  );

  /* Quiet reading-stats strip (finished / in progress / streak). */
  const [stats, setStats] = useState(readingStats);
  useEffect(() => {
    if (tab === "mine") setStats(readingStats());
  }, [tab, books]);

  /* Extracted epub covers, keyed by book id (local adds only). */
  const [covers, setCovers] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const ids = new Set([...books, ...catalog].map((b) => b.id));
      const next: Record<string, string> = {};
      await Promise.all(
        Array.from(ids).map(async (id) => {
          const blob = await loadCover(id).catch(() => null);
          if (!blob) return;
          next[id] = await blobToDataUrl(blob);
        })
      );
      if (alive) setCovers(next);
    })();
    return () => {
      alive = false;
    };
  }, [books, catalog]);

  /* Refresh my library whenever anything is pinned, unpinned, or added. */
  useEffect(() => {
    const onBooks = () => setBooks(getMyLibrary());
    window.addEventListener(USER_BOOKS_CHANGED_EVENT, onBooks);
    return () => window.removeEventListener(USER_BOOKS_CHANGED_EVENT, onBooks);
  }, []);

  /* Pick up the vault-published catalog once it arrives. */
  useEffect(() => {
    let alive = true;
    loadCatalog().then((list) => {
      if (alive) setCatalog(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  /* Browse renders the vault-published catalog, falling back to the static
     src/books.ts list until books/catalog.json is available. */
  const source = tab === "mine" ? books : catalog;
  const mineIds = useMemo(() => new Set(books.map((b) => b.id)), [books]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return source;
    return source.filter((b) =>
      `${b.title} ${b.author ?? ""}`.toLowerCase().includes(q)
    );
  }, [query, source]);

  /* ---- "Add book" modal state ---- */
  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addAuthor, setAddAuthor] = useState("");
  const [addType, setAddType] = useState<BookType>("epub");
  const [addError, setAddError] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;
    setAddError("");
    setAddBusy(true);
    (async () => {
      // Duplicate detection: identical content anywhere in the library?
      const sha = await hashBlob(file);
      const dupKey = sha ? await findKeyBySha(sha) : null;
      if (dupKey) {
        const known = getMyLibrary().find((b) => b.blobKey === dupKey);
        throw new Error(
          known
            ? `Already in your library as “${known.title}”.`
            : "This file is already in your library."
        );
      }
      // Epub metadata prefill (fills blanks only).
      let meta: Awaited<ReturnType<typeof readEpubMeta>> = null;
      if (/\.epub$/i.test(file.name)) {
        meta = await readEpubMeta(file);
        if (meta?.title && !addTitle.trim()) setAddTitle(meta.title);
        if (meta?.author && !addAuthor.trim()) setAddAuthor(meta.author);
      }
      const { book } = await addLocalBook(file, sha ?? undefined);
      if (meta?.cover) await saveCover(book.id, meta.cover);
      setAddUrl("");
      setAddTitle("");
      setAddAuthor("");
      setAddType("epub");
      setShowAdd(false);
    })()
      .catch((err) => {
        setAddError(
          err instanceof Error ? err.message : "Could not add that file."
        );
      })
      .finally(() => setAddBusy(false));
  };

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

  /** Mine-tab trash: unpins catalog books, deletes URL-added ones. */
  const remove = (id: string) => {
    removeUserBook(id);
  };

  /** Browse-tab toggle: pin a catalog book, unpin when it's already yours. */
  const togglePin = (book: Book) => {
    if (mineIds.has(book.id)) removeUserBook(book.id);
    else pinBook(book);
  };

  /* ---- Vault upload ("reads on every device") state ---- */
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>(() =>
    getVaultStatus()
  );
  const [showVaultSetup, setShowVaultSetup] = useState(false);
  const [vaultToken, setVaultToken] = useState("");
  const [vaultRepo, setVaultRepo] = useState("");
  const [leafRepo, setLeafRepo] = useState("");
  const [vaultLeafToken, setVaultLeafToken] = useState("");
  const [vaultError, setVaultError] = useState("");
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultNote, setVaultNote] = useState("");
  const [vaultPhase, setVaultPhase] = useState<"upload" | "deploy" | null>(null);
  const [vaultPct, setVaultPct] = useState(0);
  const vaultFileRef = useRef<HTMLInputElement>(null);
  const [showWatchSetup, setShowWatchSetup] = useState(false);
  const [watchDone, setWatchDone] = useState(false);
  const [watchLeafRepo, setWatchLeafRepo] = useState("");
  const [watchToken, setWatchToken] = useState("");
  const [watchError, setWatchError] = useState("");
  const [watchBusy, setWatchBusy] = useState(false);

  /* Keep the connect/disconnect state in step with vaultSync. */
  useEffect(() => {
    const onVault = (e: Event) =>
      setVaultStatus({ ...(e as CustomEvent<VaultStatus>).detail });
    window.addEventListener(VAULT_STATUS_EVENT, onVault);
    return () => window.removeEventListener(VAULT_STATUS_EVENT, onVault);
  }, []);

  const connectVault = async () => {
    setVaultBusy(true);
    setVaultError("");
    const res = await vaultConnect({
      token: vaultToken,
      repo: vaultRepo,
      leafRepo,
      leafToken: vaultLeafToken,
    });
    if (res.ok) {
      setVaultToken("");
      setVaultLeafToken("");
      setShowVaultSetup(false);
    } else {
      setVaultError(res.error);
    }
    setVaultBusy(false);
  };

  const startVaultUpload = async (file: File) => {
    setAddError("");
    setVaultNote("");
    setAddBusy(false);
    setVaultBusy(true);
    setVaultPhase("upload");
    setVaultPct(0);
    const startedAt = Date.now();
    try {
      // Epub metadata prefill so vault uploads carry title/author for CI.
      let title = addTitle;
      let author = addAuthor;
      let cover: Blob | undefined;
      if (/\.epub$/i.test(file.name)) {
        const meta = await readEpubMeta(file).catch(() => null);
        if (meta?.title && !title) {
          title = meta.title;
          setAddTitle(meta.title);
        }
        if (meta?.author && !author) {
          author = meta.author;
          setAddAuthor(meta.author);
        }
        cover = meta?.cover;
      }
      const res = await uploadToVault(
        file,
        { title, author },
        (pct) => setVaultPct(pct)
      );
      if (!res.ok) {
        setAddError(res.error);
        return;
      }
      if (res.skipped) {
        setVaultNote(
          "That file is already in the vault (same name and size) — nothing to upload." +
            (res.metaWarning ? ` ${res.metaWarning}` : "")
        );
        return;
      }
      let note = res.replaced
        ? `Replaced “${res.fileName}” in the vault.`
        : `Uploaded “${res.fileName}” to the vault.`;
      if (res.metaWarning) note += ` ${res.metaWarning}`;

      setVaultPhase("deploy");
      if (canWatchDeploys()) {
        const watch = await waitForDeploy(startedAt);
        if (watch.conclusion === "success") {
          const fresh = await reloadCatalog();
          setCatalog(fresh);
          const added = fresh.find((b) => b.url === `books/${res.fileName}`);
          if (added) {
            pinBook(added);
            if (cover) await saveCover(added.id, cover);
            setTab("browse");
          }
          note += added
            ? " It’s live and pinned to My library."
            : " It’s live under Browse.";
        } else if (watch.conclusion) {
          note += ` But the deploy failed (${watch.conclusion}) — check the Actions tab.`;
        } else if (watch.error) {
          note += ` ${watch.error}`;
        }
      } else {
        note +=
          " It appears under Browse once the deploy finishes (a few minutes).";
      }
      setVaultNote(note);
    } finally {
      setVaultPhase(null);
      setVaultPct(0);
      setVaultBusy(false);
    }
  };

  const onVaultFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;
    void startVaultUpload(file);
  };

  const enableWatch = async () => {
    setWatchBusy(true);
    setWatchError("");
    const res = await vaultEnableWatch(watchLeafRepo, watchToken);
    if (res.ok) {
      setWatchToken("");
      setShowWatchSetup(false);
      setWatchDone(true);
    } else {
      setWatchError(res.error);
    }
    setWatchBusy(false);
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
              placeholder={tab === "mine" ? "Search your books…" : "Search the catalog…"}
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
        {tab === "mine" && (stats.finished > 0 || stats.inProgress > 0) && (
          <p className="reading-stats">
            {stats.finished} finished · {stats.inProgress} in progress
            {stats.streak > 1 ? ` · 🔥 ${stats.streak}-day streak` : ""}
          </p>
        )}

        <div className="library-tabs" role="tablist" aria-label="Choose which collection is shown">
          <button
            role="tab"
            aria-selected={tab === "mine"}
            className={`tab-btn${tab === "mine" ? " active" : ""}`}
            onClick={() => setTab("mine")}
            title="Books you've collected"
          >
            <BookOpen size={14} />
            My library
          </button>
          <button
            role="tab"
            aria-selected={tab === "browse"}
            className={`tab-btn${tab === "browse" ? " active" : ""}`}
            onClick={() => setTab("browse")}
            title="The built-in catalog shipped with Leaf"
          >
            <Compass size={14} />
            Browse
          </button>
          <span className="tab-count">{filtered.length}</span>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            <BookOpen size={28} />
            <p>
              {query.trim() !== ""
                ? "No books match your search."
                : tab === "mine"
                  ? "Your library is empty — pin books from the catalog or add one by link."
                  : "No books match your search."}
            </p>
            {tab === "mine" && query.trim() === "" && (
              <div className="empty-actions">
                <button
                  className="add-article-btn"
                  onClick={() => setTab("browse")}
                >
                  <Compass size={15} />
                  Browse main library
                </button>
                <button
                  className="secondary-action"
                  onClick={() => setShowAdd(true)}
                >
                  <Plus size={15} />
                  Add book link
                </button>
              </div>
            )}
          </div>
        ) : view === "grid" ? (
          <div className="book-grid">
            {filtered.map((b) => {
              const prog = progressInfo(b);
              const isMine = mineIds.has(b.id);
              return (
                <div className="book-card-wrap" key={b.id}>
                  <button
                    className="book-card"
                    onClick={() =>
                      navigate(`#/book/${encodeURIComponent(b.id)}`)
                    }
                  >
                    <div className="book-cover">
                      {covers[b.id] ? (
                        <img
                          className="book-cover-img"
                          src={covers[b.id]}
                          alt=""
                        />
                      ) : b.type === "epub" ? (
                        <BookOpen size={34} />
                      ) : (
                        <FileText size={34} />
                      )}
                      <span
                        className={`pill pill-${b.type}${
                          tab === "browse" ? " pill-tucked" : ""
                        }`}
                      >
                        {b.type}
                      </span>
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
                  {tab === "mine" ? (
                    isMine && (
                      <button
                        className="card-remove"
                        onClick={() => remove(b.id)}
                        title="Remove from your library"
                        aria-label={`Remove ${b.title}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    )
                  ) : (
                    <button
                      className={`card-add${isMine ? " added" : ""}`}
                      onClick={() => togglePin(b)}
                      title={
                        isMine
                          ? "Remove from your library"
                          : "Add to your library"
                      }
                      aria-label={
                        (isMine ? "Remove " : "Add ") +
                        b.title +
                        (isMine ? " from" : " to") +
                        " your library"
                      }
                    >
                      {isMine ? <Check size={15} /> : <Plus size={15} />}
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
              const isMine = mineIds.has(b.id);
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
                    <span
                      className={`pill pill-${b.type}${
                        tab === "browse" ? " pill-tucked" : ""
                      }`}
                    >
                      {b.type}
                    </span>
                    {isMine && <span className="book-list-yours">Yours</span>}
                  </button>
                  {tab === "mine" ? (
                    isMine && (
                      <button
                        className="card-remove"
                        onClick={() => remove(b.id)}
                        title="Remove from your library"
                        aria-label={`Remove ${b.title}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    )
                  ) : (
                    <button
                      className={`card-add${isMine ? " added" : ""}`}
                      onClick={() => togglePin(b)}
                      title={
                        isMine
                          ? "Remove from your library"
                          : "Add to your library"
                      }
                      aria-label={
                        (isMine ? "Remove " : "Add ") +
                        b.title +
                        (isMine ? " from" : " to") +
                        " your library"
                      }
                    >
                      {isMine ? <Check size={15} /> : <Plus size={15} />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="footnote">
          {tab === "mine"
            ? "Your picks are kept in this browser. Open Browse to pull more in from the built-in catalog."
            : "The catalog shipped with Leaf — “Yours” marks what you’ve collected. Click the toggle on any card to add or remove it."}
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

            <div className="modal-divider">
              <span>or</span>
            </div>

            <label className="modal-file-btn">
              <input
                ref={fileRef}
                type="file"
                accept=".epub,.pdf"
                onChange={onFilePicked}
                disabled={addBusy || vaultBusy}
              />
              <FolderOpen size={16} />
              {addBusy
                ? "Saving to this browser…"
                : "Choose an EPUB or PDF from this device"}
            </label>
            <p className="modal-hint">
              Files you pick are stored in this browser only — nothing is
              uploaded.
            </p>

            <div className="modal-divider">
              <span>or upload to your vault — reads on every device</span>
            </div>

            {vaultStatus.state === "connected" ? (
              <>
                <label className="modal-file-btn">
                  <input
                    ref={vaultFileRef}
                    type="file"
                    accept=".epub,.pdf"
                    onChange={onVaultFilePicked}
                    disabled={vaultBusy || addBusy}
                  />
                  {vaultPhase === "upload" ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <CloudUpload size={16} />
                  )}
                  {vaultPhase === "upload"
                    ? `Uploading ${vaultPct}%`
                    : vaultPhase === "deploy"
                      ? "Deploying…"
                      : "Choose an EPUB or PDF to upload to your vault"}
                </label>
                {vaultPhase === "upload" && (
                  <div className="vault-progress" aria-hidden="true">
                    <span style={{ width: `${vaultPct}%` }} />
                  </div>
                )}
                {vaultNote && <p className="vault-note">{vaultNote}</p>}
                <p className="modal-hint">
                  Files go to your private vault ({vaultStatus.repo}) and are
                  published to every device after CI encrypts them. The Title
                  and Author fields above are saved for the uploaded file.
                </p>
                <div className="vault-meta-row">
                  <button
                    type="button"
                    className="secondary-action vault-disconnect"
                    onClick={() => {
                      vaultDisconnect();
                      setVaultNote("");
                      setShowVaultSetup(false);
                      setShowWatchSetup(false);
                      setWatchDone(false);
                    }}
                    title="Forget the vault token on this device"
                  >
                    Disconnect vault
                  </button>
                </div>
                {!canWatchDeploys() && !watchDone && (
                  <div className="vault-meta-row">
                    <button
                      type="button"
                      className="secondary-action vault-disconnect"
                      onClick={() => setShowWatchSetup((v) => !v)}
                      title="Live “Deploying…” status and auto-pin after each upload"
                    >
                      Add deploy watching
                    </button>
                  </div>
                )}
                {watchDone && !canWatchDeploys() && (
                  <p className="vault-note">
                    Deploy watching is on — uploads now show live
                    “Deploying…” status.
                  </p>
                )}
                {showWatchSetup && (
                  <div className="vault-connect">
                    <label className="field">
                      <span>Leaf repo (owner/name)</span>
                      <input
                        type="text"
                        value={watchLeafRepo}
                        onChange={(e) => setWatchLeafRepo(e.target.value)}
                        placeholder="your-name/leaf"
                        autoComplete="off"
                      />
                    </label>
                    <label className="field">
                      <span>Token with Actions: Read on the Leaf repo</span>
                      <input
                        type="password"
                        value={watchToken}
                        onChange={(e) => {
                          setWatchToken(e.target.value);
                          if (watchError) setWatchError("");
                        }}
                        placeholder="github_pat_…"
                        autoComplete="off"
                      />
                    </label>
                    {watchError && <p className="article-error">{watchError}</p>}
                    <button
                      type="button"
                      className="add-article-btn"
                      onClick={() => void enableWatch()}
                      disabled={watchBusy}
                    >
                      {watchBusy ? (
                        <Loader2 className="spin" size={15} />
                      ) : (
                        <CloudUpload size={15} />
                      )}
                      {watchBusy ? "Checking…" : "Enable deploy watching"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="modal-file-btn"
                  onClick={() => setShowVaultSetup((v) => !v)}
                >
                  <CloudUpload size={16} />
                  Set up vault uploads
                </button>
                <p className="modal-hint">
                  Uploads go to your private GitHub vault; once the deploy
                  finishes, the book shows up under Browse everywhere you use
                  Leaf.
                </p>
                {showVaultSetup && (
                  <div className="vault-connect">
                    <label className="field">
                      <span>Fine-grained token (Contents: Read and write)</span>
                      <input
                        type="password"
                        value={vaultToken}
                        onChange={(e) => {
                          setVaultToken(e.target.value);
                          if (vaultError) setVaultError("");
                        }}
                        placeholder="github_pat_…"
                        autoComplete="off"
                      />
                    </label>
                    <label className="field">
                      <span>Vault repo (owner/name)</span>
                      <input
                        type="text"
                        value={vaultRepo}
                        onChange={(e) => setVaultRepo(e.target.value)}
                        placeholder="your-name/book-vault"
                        autoComplete="off"
                      />
                    </label>
                    <details className="vault-advanced">
                      <summary>Also watch the Leaf deploy (optional)</summary>
                      <label className="field">
                        <span>Leaf repo (owner/name)</span>
                        <input
                          type="text"
                          value={leafRepo}
                          onChange={(e) => setLeafRepo(e.target.value)}
                          placeholder="your-name/leaf"
                          autoComplete="off"
                        />
                      </label>
                      <label className="field">
                        <span>Token with Actions: Read on the Leaf repo</span>
                        <input
                          type="password"
                          value={vaultLeafToken}
                          onChange={(e) => setVaultLeafToken(e.target.value)}
                          placeholder="github_pat_… (leave blank to skip)"
                          autoComplete="off"
                        />
                      </label>
                    </details>
                    {vaultError && (
                      <p className="article-error">{vaultError}</p>
                    )}
                    <button
                      type="button"
                      className="add-article-btn"
                      onClick={() => void connectVault()}
                      disabled={vaultBusy}
                    >
                      {vaultBusy ? (
                        <Loader2 className="spin" size={15} />
                      ) : (
                        <CloudUpload size={15} />
                      )}
                      {vaultBusy ? "Connecting…" : "Connect vault"}
                    </button>
                  </div>
                )}
              </>
            )}

            {addError && <p className="article-error">{addError}</p>}

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-action"
                onClick={() => setShowAdd(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="add-article-btn"
                disabled={addBusy}
              >
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
