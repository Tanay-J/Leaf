import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  Activity,
  Bookmark,
  BookOpen,
  Check,
  CloudUpload,
  Compass,
  Copy,
  FileText,
  FolderOpen,
  Highlighter,
  Info,
  LayoutGrid,
  Link,
  List,
  Loader2,
  Newspaper,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { getCatalog, loadCatalog, reloadCatalog, type Book } from "../books";
import { loadArticles } from "../articles";
import {
  bookSecondsMap,
  loadAllProgress,
  loadProgress,
  navigate,
  PROGRESS_SAVED_EVENT,
  readDays,
  saveProgress,
  useLibraryView,
  type BookmarkItem,
  type HighlightItem,
  type Theme,
} from "../lib";
import ThemeButton from "./ThemeButton";
import SyncCard from "./SyncCard";
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
  updateBookMeta,
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
  if (p.finishedAt) return { label: "Finished", pct: 1 };
  if (book.type === "pdf" && p.page && p.total) {
    return { label: `Page ${p.page} of ${p.total}`, pct: p.page / p.total };
  }
  // EPUBs store their position as 0..1 (see EpubReader) — show a %.
  if (book.type === "epub" && p.pct != null) {
    const pctLabel = `${Math.round(p.pct * 100)}%`;
    return {
      label: p.chapter ? `${pctLabel} · ${p.chapter}` : `${pctLabel} read`,
      pct: p.pct,
    };
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
      if (alive) {
        setCatalog(list);
        setBooks(getMyLibrary());
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  /* Browse renders the vault-published catalog, falling back to the static
     src/books.ts list until books/catalog.json is available. */
  const mineIds = useMemo(() => new Set(books.map((b) => b.id)), [books]);
  const catalogCoverMap = useMemo(
    () => new Map(catalog.map((b) => [b.id, b.cover])),
    [catalog]
  );
  const resolveCover = (b: Book): string | null =>
    covers[b.id] ?? b.cover ?? catalogCoverMap.get(b.id) ?? null;

  /* Per-tab, query-filtered lists — each tab badge shows its own live count
     (previously the trailing badge always mirrored whichever tab was open). */
  const catalogFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? catalog.filter((b) =>
          `${b.title} ${b.author ?? ""}`.toLowerCase().includes(q)
        )
      : catalog;
  }, [query, catalog]);

  /* Sort + status filter (status applies to My library only). */
  const [sort, setSort] = useState<string>(() => {
    try {
      const s = localStorage.getItem("library-sort");
      return s === "title" || s === "author" || s === "progress" ? s : "recent";
    } catch {
      return "recent";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("library-sort", sort);
    } catch {
      /* storage unavailable */
    }
  }, [sort]);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "reading" | "finished" | "unopened"
  >("all");

  const mineFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? books.filter((b) =>
          `${b.title} ${b.author ?? ""}`.toLowerCase().includes(q)
        )
      : books;
    if (statusFilter === "all") return list;
    return list.filter((b) => {
      const p = loadProgress(b.id);
      if (statusFilter === "finished") return !!p.finishedAt;
      if (statusFilter === "reading") return !p.finishedAt && !!p.lastReadAt;
      return !p.lastReadAt && !p.finishedAt; // unopened
    });
  }, [books, query, statusFilter]);

  const shown = useMemo(() => {
    const list = tab === "mine" ? mineFiltered : catalogFiltered;
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "author")
        return (a.author ?? "\uffff").localeCompare(b.author ?? "\uffff");
      if (sort === "progress")
        return (progressInfo(b).pct ?? -1) - (progressInfo(a).pct ?? -1);
      // recent: last opened first, then plain alphabetical
      const ra = loadProgress(a.id).lastReadAt ?? 0;
      const rb = loadProgress(b.id).lastReadAt ?? 0;
      return ra !== rb ? rb - ra : a.title.localeCompare(b.title);
    });
    return sorted;
  }, [tab, mineFiltered, catalogFiltered, sort]);

  /* Most recently read in-progress book for the "Continue reading" hero card. */
  const continueBook = useMemo(() => {
    const candidates = [...books, ...catalog.filter((b) => !mineIds.has(b.id))];
    let best: Book | null = null;
    let bestTs = 0;
    for (const b of candidates) {
      const p = loadProgress(b.id);
      if (!p.finishedAt && p.lastReadAt && p.lastReadAt > bestTs) {
        bestTs = p.lastReadAt;
        best = b;
      }
    }
    return best;
  }, [books, catalog, mineIds]);

  /* ---- "Add book" modal state ---- */
  const [showAdd, setShowAdd] = useState(false);
  const [addTab, setAddTab] = useState<"device" | "vault" | "link">("device");
  const [addUrl, setAddUrl] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addAuthor, setAddAuthor] = useState("");
  const [addType, setAddType] = useState<BookType>("epub");
  const [addError, setAddError] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const importLocalFiles = (files: File[]) => {
    if (files.length === 0) return;
    setAddError("");
    setAddBusy(true);
    (async () => {
      let added = 0;
      let skipped = 0;
      for (const file of files) {
        if (!/\.(epub|pdf)$/i.test(file.name)) continue;
        // Duplicate detection: identical content anywhere in the library?
        const sha = await hashBlob(file);
        const dupKey = sha ? await findKeyBySha(sha) : null;
        if (dupKey) {
          skipped++;
          continue; // already have it — skip in a batch
        }
        // Epub metadata & cover extraction (falls back to filename when absent).
        let meta: Awaited<ReturnType<typeof readEpubMeta>> = null;
        if (/\.epub$/i.test(file.name)) {
          meta = await readEpubMeta(file);
        }
        const { book } = await addLocalBook(file, sha ?? undefined, {
          title: (files.length === 1 && addTitle.trim()) || meta?.title,
          author: (files.length === 1 && addAuthor.trim()) || meta?.author,
        });
        if (meta?.cover) await saveCover(book.id, meta.cover);
        added++;
      }
      if (added === 0 && skipped === files.length) {
        setAddError("Those files are already in your library.");
        return;
      }
      if (added === 0 && files.length === 1) {
        setAddError("Could not add that file (only .epub and .pdf are supported).");
        return;
      }
      setAddUrl("");
      setAddTitle("");
      setAddAuthor("");
      setAddType("epub");
      setShowAdd(false);
      setTab("mine");
    })()
      .catch((err) => {
        setAddError(
          err instanceof Error ? err.message : "Could not add those files."
        );
      })
      .finally(() => setAddBusy(false));
  };

  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same files later
    importLocalFiles(files);
  };

  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
  };

  const onDragLeave = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []).filter((f) =>
      /\.(epub|pdf)$/i.test(f.name)
    );
    if (files.length > 0) {
      importLocalFiles(files);
    }
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

  /** Uploads one file to the vault without waiting on the deploy. */
  const uploadOneToVault = async (
    file: File,
    allowFieldOverride: boolean
  ): Promise<{ fileName: string; note: string; cover?: Blob } | null> => {
    // Epub metadata prefill so vault uploads carry title/author for CI, with
    // explicit Title/Author form fields overriding when uploading a single file.
    let title = allowFieldOverride ? addTitle.trim() : "";
    let author = allowFieldOverride ? addAuthor.trim() : "";
    let cover: Blob | undefined;
    if (/\.epub$/i.test(file.name)) {
      const meta = await readEpubMeta(file).catch(() => null);
      if (!title) title = meta?.title ?? "";
      if (!author) author = meta?.author ?? "";
      cover = meta?.cover;
    }
    const res = await uploadToVault(
      file,
      { title, author },
      (pct) => setVaultPct(pct)
    );
    if (!res.ok) throw new Error(res.error);
    if (res.skipped) return null;
    return {
      fileName: res.fileName,
      cover,
      note:
        (res.replaced
          ? `Replaced “${res.fileName}”.`
          : `Uploaded “${res.fileName}”.`) +
        (res.metaWarning ? ` ${res.metaWarning}` : ""),
    };
  };

  /** Uploads one or many files to the vault, waits for the deploy once, and
   *  pins every book that shows up in the freshly-published catalog. */
  const startVaultUploads = async (files: File[]) => {
    setAddError("");
    setVaultNote("");
    setAddBusy(false);
    setVaultBusy(true);
    const deployStartedAt = Date.now();
    try {
      setVaultPhase("upload");
      const uploaded: { fileName: string; note: string; cover?: Blob }[] = [];
      for (let i = 0; i < files.length; i++) {
        setVaultPct(0);
        if (files.length > 1) {
          setVaultNote(`Uploading ${i + 1} of ${files.length} to the vault…`);
        }
        const done = await uploadOneToVault(files[i], files.length === 1);
        if (done) uploaded.push(done);
      }
      if (uploaded.length === 0) {
        setVaultNote(
          files.length > 1
            ? "Those files are already in the vault (same name and size) — nothing to upload."
            : "That file is already in the vault (same name and size) — nothing to upload."
        );
        return;
      }

      // One deploy-watch for the whole batch, then a cache-busted catalog
      // reload — the catalog is the source of truth for “is it live yet”.
      setVaultPhase("deploy");
      const note = uploaded.map((u) => u.note).join(" ");
      if (canWatchDeploys()) {
        const watch = await waitForDeploy(deployStartedAt);
        const fresh = await reloadCatalog();
        setCatalog(fresh);
        const arrived = fresh.filter((b) =>
          uploaded.some((u) => b.url === `books/${u.fileName}`)
        );
        for (const b of arrived) {
          pinBook(b);
          const cover = uploaded.find(
            (u) => b.url === `books/${u.fileName}`
          )?.cover;
          if (cover) await saveCover(b.id, cover).catch(() => {});
        }
        if (arrived.length > 0) {
          setTab("browse");
          setVaultNote(
            `${note} ${arrived.length === 1 ? "It’s live and pinned" : "They’re live and pinned"} to My library.`
          );
          return;
        }
        if (watch.conclusion === "success") {
          // Watch says done but the book isn't in the catalog yet — the CDN
          // can briefly lag the payload; it'll show up (or on the next visit).
          setVaultNote(note + " The deploy finished — the book appears under Browse shortly.");
          return;
        }
        setVaultNote(
          note +
            (watch.conclusion
              ? ` But the deploy failed (${watch.conclusion}) — check the Actions tab.`
              : watch.error
                ? ` ${watch.error}`
                : " It appears under Browse once the deploy finishes (a few minutes).")
        );
      } else {
        setVaultNote(
          note + " It appears under Browse once the deploy finishes (a few minutes)."
        );
      }
    } catch (err) {
      setVaultNote(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setVaultPhase(null);
      setVaultPct(0);
      setVaultBusy(false);
    }
  };

  const onVaultFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same files later
    if (files.length === 0) return;
    void startVaultUploads(files);
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

  /* ---- 3-Pane Studio Inspector state ---- */
  const [, setProgressTick] = useState(0);
  useEffect(() => {
    const onProg = () => {
      setProgressTick((n) => n + 1);
      setStats(readingStats());
    };
    window.addEventListener(PROGRESS_SAVED_EVENT, onProg);
    return () => window.removeEventListener(PROGRESS_SAVED_EVENT, onProg);
  }, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedBook = useMemo<Book | null>(() => {
    const all = [...books, ...catalog.filter((b) => !mineIds.has(b.id))];
    if (selectedId) {
      const found = all.find((b) => b.id === selectedId);
      if (found) return found;
    }
    return shown[0] ?? continueBook ?? books[0] ?? catalog[0] ?? null;
  }, [selectedId, shown, continueBook, books, catalog, mineIds]);

  const [editingMeta, setEditingMeta] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [copiedNotes, setCopiedNotes] = useState(false);

  useEffect(() => {
    setEditingMeta(false);
    setCopiedNotes(false);
  }, [selectedBook?.id]);

  const statusCounts = useMemo(() => {
    let reading = 0;
    let finished = 0;
    let unopened = 0;
    for (const b of books) {
      const p = loadProgress(b.id);
      if (p.finishedAt) finished++;
      else if (p.lastReadAt) reading++;
      else unopened++;
    }
    return { all: books.length, reading, finished, unopened };
  }, [books]);

  const formatDuration = (sec: number): string => {
    if (!sec || sec < 60) return "Just started";
    const hrs = Math.floor(sec / 3600);
    const mins = Math.round((sec % 3600) / 60);
    if (hrs === 0) return `${mins}m`;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  };

  const jumpToBookmark = (book: Book, bm: BookmarkItem) => {
    if (bm.cfi) {
      saveProgress(book.id, { cfi: bm.cfi, chapter: bm.label });
    } else if (bm.page) {
      saveProgress(book.id, { page: bm.page });
    }
    navigate(`#/book/${encodeURIComponent(book.id)}`);
  };

  const jumpToHighlight = (book: Book, hl: HighlightItem) => {
    saveProgress(book.id, { cfi: hl.cfiRange, chapter: hl.chapter });
    navigate(`#/book/${encodeURIComponent(book.id)}`);
  };

  const deleteBookmarkItem = (book: Book, id: string) => {
    const p = loadProgress(book.id);
    const next = (p.bookmarks ?? []).filter((b) => b.id !== id);
    saveProgress(book.id, { bookmarks: next });
  };

  const deleteHighlightItem = (book: Book, id: string) => {
    const p = loadProgress(book.id);
    const next = (p.highlights ?? []).filter((h) => h.id !== id);
    saveProgress(book.id, { highlights: next });
  };

  const copySelectedNotesMarkdown = (book: Book) => {
    const p = loadProgress(book.id);
    const bms = p.bookmarks ?? [];
    const hls = p.highlights ?? [];
    const lines: string[] = [`# ${book.title}`];
    if (book.author) lines.push(`*by ${book.author}*`);
    lines.push("");
    if (hls.length > 0) {
      lines.push("## Highlights", "");
      for (const h of hls) {
        lines.push(`> ${h.text.replace(/\n+/g, " ")}`);
        if (h.chapter) lines.push(`> — *${h.chapter}*`);
        lines.push("");
      }
    }
    if (bms.length > 0) {
      lines.push("## Bookmarks", "");
      for (const bm of bms) {
        lines.push(`- ${bm.label}`);
      }
      lines.push("");
    }
    void navigator.clipboard?.writeText(lines.join("\n")).then(() => {
      setCopiedNotes(true);
      window.setTimeout(() => setCopiedNotes(false), 1800);
    });
  };

  return (
    <div
      className="library studio-library"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <FolderOpen size={32} />
            <strong>Drop EPUB or PDF files to add to your library</strong>
            <span>Stored privately in this browser</span>
          </div>
        </div>
      )}

      <div className="studio-shell">
        {/* LEFT RAIL: Workspace & Filters */}
        <aside className="studio-rail">
          <div className="studio-brand">
            <div className="brand-mark">
              <BookOpen size={18} />
            </div>
            <div className="brand-text">
              <span className="eyebrow">Personal Reader</span>
              <h1>Leaf</h1>
            </div>
          </div>

          <div className="studio-nav-group">
            <span className="studio-nav-label">Workspace</span>
            <button
              type="button"
              className={`studio-nav-btn${tab === "mine" ? " active" : ""}`}
              onClick={() => setTab("mine")}
            >
              <BookOpen size={15} />
              <span>My Shelf</span>
              <span className="studio-nav-count">{books.length}</span>
            </button>
            <button
              type="button"
              className={`studio-nav-btn${tab === "browse" ? " active" : ""}`}
              onClick={() => setTab("browse")}
            >
              <Compass size={15} />
              <span>Browse Vault</span>
              <span className="studio-nav-count">{catalog.length}</span>
            </button>
            <button
              type="button"
              className="studio-nav-btn"
              onClick={() => navigate("#/articles")}
            >
              <Newspaper size={15} />
              <span>Reading List</span>
              {unreadArticles > 0 && (
                <span className="studio-nav-count accent">{unreadArticles}</span>
              )}
            </button>
            <button
              type="button"
              className="studio-nav-btn"
              onClick={() => navigate("#/stats")}
            >
              <Activity size={15} />
              <span>Activity & Stats</span>
              {stats.streak > 0 && (
                <span className="studio-nav-count">🔥 {stats.streak}d</span>
              )}
            </button>
          </div>

          {tab === "mine" && (
            <div className="studio-nav-group">
              <span className="studio-nav-label">Status Filter</span>
              {(["all", "reading", "finished", "unopened"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`studio-nav-btn${statusFilter === f ? " active" : ""}`}
                  onClick={() => setStatusFilter(f)}
                >
                  <span className={`studio-dot dot-${f}`} />
                  <span>
                    {f === "all"
                      ? "All Books"
                      : f === "reading"
                        ? "In Progress"
                        : f === "finished"
                          ? "Finished"
                          : "Unopened"}
                  </span>
                  <span className="studio-nav-count">{statusCounts[f]}</span>
                </button>
              ))}
            </div>
          )}

          <div className="studio-rail-footer">
            <button
              type="button"
              className="studio-add-cta"
              onClick={() => setShowAdd(true)}
            >
              <Plus size={15} />
              Add or Drop Book
            </button>
            <div className="studio-sync-wrap">
              <SyncCard />
            </div>
          </div>
        </aside>

        {/* CENTER PANE: Command Bar & Shelf / Table */}
        <main className="studio-center">
          <header className="studio-cmdbar">
            <div className="studio-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  tab === "mine"
                    ? "Filter shelf by title or author…"
                    : "Search vault catalog…"
                }
              />
              {query && (
                <button
                  type="button"
                  className="studio-search-clear"
                  onClick={() => setQuery("")}
                  title="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div className="studio-cmd-actions">
              {tab === "browse" && shown.some((b) => !mineIds.has(b.id)) && (
                <button
                  type="button"
                  className="studio-open-btn"
                  onClick={() => {
                    for (const b of shown) {
                      if (!mineIds.has(b.id)) pinBook(b);
                    }
                  }}
                  title="Move all shown vault books to My Shelf"
                >
                  <Plus size={13} />
                  Pin All to Shelf
                </button>
              )}

              <select
                className="control-select sort-select"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                title="Sort order"
                aria-label="Sort order"
              >
                <option value="recent">Sort: Recent</option>
                <option value="title">Sort: Title</option>
                <option value="author">Sort: Author</option>
                <option value="progress">Sort: Progress</option>
              </select>

              <div className="view-toggle" role="group" aria-label="View mode">
                <button
                  type="button"
                  className={`view-btn${view === "list" ? " active" : ""}`}
                  onClick={() => setView("list")}
                  title="Table view"
                >
                  <List size={15} />
                </button>
                <button
                  type="button"
                  className={`view-btn${view === "grid" ? " active" : ""}`}
                  onClick={() => setView("grid")}
                  title="Cover grid view"
                >
                  <LayoutGrid size={15} />
                </button>
              </div>

              <ThemeButton theme={theme} onCycleTheme={onCycleTheme} />
            </div>
          </header>

          {/* Mobile quick navigation strip (visible when left rail collapses) */}
          <div className="studio-mobile-bar">
            <div className="studio-mobile-tabs">
              <button
                type="button"
                className={`filter-chip${tab === "mine" ? " active" : ""}`}
                onClick={() => setTab("mine")}
              >
                My Shelf ({books.length})
              </button>
              <button
                type="button"
                className={`filter-chip${tab === "browse" ? " active" : ""}`}
                onClick={() => setTab("browse")}
              >
                Vault ({catalog.length})
              </button>
              <button
                type="button"
                className="filter-chip"
                onClick={() => navigate("#/articles")}
              >
                Articles{unreadArticles > 0 ? ` (${unreadArticles})` : ""}
              </button>
              <button
                type="button"
                className="filter-chip"
                onClick={() => navigate("#/stats")}
              >
                Stats
              </button>
            </div>
            <button
              type="button"
              className="secondary-action"
              onClick={() => setShowAdd(true)}
            >
              <Plus size={14} /> Add
            </button>
          </div>

          <div className="studio-body">
            {tab === "mine" &&
              continueBook &&
              query.trim() === "" &&
              statusFilter === "all" && (() => {
                const cProg = progressInfo(continueBook);
                const cCover = resolveCover(continueBook);
                return (
                  <div className="studio-continue-banner">
                    <div
                      className="studio-continue-main"
                      onClick={() => setSelectedId(continueBook.id)}
                    >
                      <div className="studio-continue-cover">
                        {cCover ? (
                          <img src={cCover} alt="" className="book-cover-img" />
                        ) : continueBook.type === "epub" ? (
                          <BookOpen size={20} />
                        ) : (
                          <FileText size={20} />
                        )}
                      </div>
                      <div className="studio-continue-info">
                        <span className="continue-eyebrow">Continue Reading</span>
                        <strong>{continueBook.title}</strong>
                        <span className="studio-continue-sub">
                          {continueBook.author ? `${continueBook.author} · ` : ""}
                          {cProg.label || "In progress"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="continue-cta"
                      onClick={() =>
                        navigate(`#/book/${encodeURIComponent(continueBook.id)}`)
                      }
                    >
                      <Play size={13} />
                      Resume
                    </button>
                  </div>
                );
              })()}

            {shown.length === 0 ? (
              <div className="empty-state">
                <BookOpen size={28} />
                <p>
                  {query.trim() !== ""
                    ? "No books match your search."
                    : tab === "mine"
                      ? "Your shelf is empty — pin books from the vault or drop an EPUB/PDF anywhere."
                      : "No books match your search."}
                </p>
                {tab === "mine" && query.trim() === "" && (
                  <div className="empty-actions">
                    <button
                      type="button"
                      className="add-article-btn"
                      onClick={() => setTab("browse")}
                    >
                      <Compass size={15} />
                      Browse Vault Catalog
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => setShowAdd(true)}
                    >
                      <Plus size={15} />
                      Add Book
                    </button>
                  </div>
                )}
              </div>
            ) : view === "list" ? (
              <div className="studio-table" role="listbox" aria-label="Book list">
                <div className="studio-table-head">
                  <span>Book</span>
                  <span>Progress</span>
                  <span>Format</span>
                  <span style={{ textAlign: "right" }}>Action</span>
                </div>
                {shown.map((b) => {
                  const prog = progressInfo(b);
                  const isMine = mineIds.has(b.id);
                  const isSelected = selectedBook?.id === b.id;
                  const coverSrc = resolveCover(b);
                  const pctNum = prog.pct !== null ? Math.round(prog.pct * 100) : 0;
                  return (
                    <div
                      key={b.id}
                      role="option"
                      aria-selected={isSelected}
                      tabIndex={0}
                      className={`studio-row${isSelected ? " selected" : ""}`}
                      onClick={() => setSelectedId(b.id)}
                      onDoubleClick={() =>
                        navigate(`#/book/${encodeURIComponent(b.id)}`)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          navigate(`#/book/${encodeURIComponent(b.id)}`);
                        } else if (e.key === " ") {
                          e.preventDefault();
                          setSelectedId(b.id);
                        }
                      }}
                    >
                      <div className="studio-row-book">
                        <div className="studio-row-thumb">
                          {coverSrc ? (
                            <img src={coverSrc} alt="" />
                          ) : b.type === "epub" ? (
                            <BookOpen size={15} />
                          ) : (
                            <FileText size={15} />
                          )}
                        </div>
                        <div className="studio-row-meta">
                          <span className="studio-row-title">{b.title}</span>
                          <span className="studio-row-author">
                            {b.author || "Unknown author"}
                          </span>
                        </div>
                      </div>

                      <div className="studio-row-prog">
                        <div className="studio-mini-bar">
                          <span style={{ width: `${pctNum}%` }} />
                        </div>
                        <span className="studio-row-prog-text">
                          {prog.label || "Unopened"}
                        </span>
                      </div>

                      <div className="studio-row-badges">
                        <span className={`studio-badge badge-${b.type}`}>
                          {b.type}
                        </span>
                        {tab === "browse" && isMine && (
                          <span className="studio-badge badge-yours">Pinned</span>
                        )}
                      </div>

                      <div
                        className="studio-row-actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="studio-open-btn"
                          onClick={() =>
                            navigate(`#/book/${encodeURIComponent(b.id)}`)
                          }
                          title="Open in Reader"
                        >
                          <Play size={12} />
                          Read
                        </button>
                        {tab === "mine" ? (
                          isMine && (
                            <button
                              type="button"
                              className="mini-btn"
                              onClick={() => remove(b.id)}
                              title="Remove from your shelf"
                              aria-label={`Remove ${b.title}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            className={`mini-btn${isMine ? " active-pin" : ""}`}
                            onClick={() => togglePin(b)}
                            title={
                              isMine
                                ? "Remove from your shelf"
                                : "Pin to your shelf"
                            }
                          >
                            {isMine ? <Check size={14} /> : <Plus size={14} />}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="studio-grid">
                {shown.map((b) => {
                  const prog = progressInfo(b);
                  const isMine = mineIds.has(b.id);
                  const isSelected = selectedBook?.id === b.id;
                  const coverSrc = resolveCover(b);
                  return (
                    <div
                      key={b.id}
                      className={`studio-card${isSelected ? " selected" : ""}`}
                      onClick={() => setSelectedId(b.id)}
                      onDoubleClick={() =>
                        navigate(`#/book/${encodeURIComponent(b.id)}`)
                      }
                    >
                      <div className="studio-card-cover">
                        {coverSrc ? (
                          <img
                            className="book-cover-img"
                            src={coverSrc}
                            alt=""
                          />
                        ) : b.type === "epub" ? (
                          <BookOpen size={30} />
                        ) : (
                          <FileText size={30} />
                        )}
                        <span className={`pill pill-${b.type} studio-pill-left`}>
                          {b.type}
                        </span>
                        {tab === "browse" ? (
                          <button
                            type="button"
                            className={`studio-card-pin${isMine ? " pinned" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePin(b);
                            }}
                            title={
                              isMine
                                ? "Remove from My Shelf"
                                : "Move to My Shelf"
                            }
                          >
                            {isMine ? <Check size={12} /> : <Plus size={12} />}
                            {isMine ? "On Shelf" : "Shelf"}
                          </button>
                        ) : (
                          isMine && (
                            <button
                              type="button"
                              className="studio-card-remove"
                              onClick={(e) => {
                                e.stopPropagation();
                                remove(b.id);
                              }}
                              title="Remove from My Shelf"
                              aria-label={`Remove ${b.title}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          )
                        )}
                        {prog.pct !== null && prog.pct > 0 && (
                          <div className="studio-card-bar">
                            <span
                              style={{ width: `${Math.round(prog.pct * 100)}%` }}
                            />
                          </div>
                        )}
                        <button
                          type="button"
                          className="studio-card-play"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`#/book/${encodeURIComponent(b.id)}`);
                          }}
                          title="Open in Reader"
                        >
                          <Play size={14} />
                          Read
                        </button>
                      </div>
                      <div className="studio-card-body">
                        <h3>{b.title}</h3>
                        {b.author && <p>{b.author}</p>}
                        {prog.label && (
                          <span className="studio-card-prog">{prog.label}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        {/* RIGHT INSPECTOR PANE */}
        <aside className="studio-inspector">
          {selectedBook ? (() => {
            const selProg = progressInfo(selectedBook);
            const rawProg = loadProgress(selectedBook.id);
            const isMine = mineIds.has(selectedBook.id);
            const selCover = resolveCover(selectedBook);
            const secs = bookSecondsMap()[selectedBook.id] ?? 0;
            const bookmarks = rawProg.bookmarks ?? [];
            const highlights = rawProg.highlights ?? [];
            const pctVal =
              selProg.pct !== null ? Math.round(selProg.pct * 100) : 0;

            return (
              <div className="inspector-content">
                <div className="inspector-top">
                  <div className="inspector-cover">
                    {selCover ? (
                      <img src={selCover} alt="" className="book-cover-img" />
                    ) : selectedBook.type === "epub" ? (
                      <BookOpen size={28} />
                    ) : (
                      <FileText size={28} />
                    )}
                  </div>
                  <div className="inspector-title-col">
                    <div className="inspector-badges">
                      <span className={`studio-badge badge-${selectedBook.type}`}>
                        {selectedBook.type}
                      </span>
                      {isMine && (
                        <span className="studio-badge badge-yours">
                          On Shelf
                        </span>
                      )}
                    </div>

                    {editingMeta ? (
                      <form
                        className="inspector-edit-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!editTitle.trim()) return;
                          updateBookMeta(selectedBook, {
                            title: editTitle.trim(),
                            author: editAuthor.trim(),
                          });
                          setEditingMeta(false);
                        }}
                      >
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="Book title"
                          autoFocus
                          required
                        />
                        <input
                          type="text"
                          value={editAuthor}
                          onChange={(e) => setEditAuthor(e.target.value)}
                          placeholder="Author (optional)"
                        />
                        <div className="inspector-edit-btns">
                          <button type="submit" className="studio-open-btn">
                            <Check size={12} /> Save
                          </button>
                          <button
                            type="button"
                            className="secondary-action"
                            onClick={() => setEditingMeta(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="inspector-heading-row">
                          <h2>{selectedBook.title}</h2>
                          <button
                            type="button"
                            className="mini-btn"
                            onClick={() => {
                              setEditTitle(selectedBook.title);
                              setEditAuthor(selectedBook.author ?? "");
                              setEditingMeta(true);
                            }}
                            title="Edit title & author"
                          >
                            <Pencil size={13} />
                          </button>
                        </div>
                        <p className="inspector-author">
                          {selectedBook.author || "Unknown author"}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                <div className="inspector-cta-row">
                  <button
                    type="button"
                    className="inspector-primary-btn"
                    onClick={() =>
                      navigate(`#/book/${encodeURIComponent(selectedBook.id)}`)
                    }
                  >
                    <Play size={15} />
                    {rawProg.lastReadAt ? "Resume Reading" : "Open in Reader"}
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() =>
                      navigate(`#/detail/${encodeURIComponent(selectedBook.id)}`)
                    }
                    title="Full book detail page"
                  >
                    <Info size={14} />
                  </button>
                  {isMine ? (
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => remove(selectedBook.id)}
                      title="Remove from your shelf"
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => togglePin(selectedBook)}
                      title="Pin to your shelf"
                    >
                      <Plus size={14} />
                    </button>
                  )}
                </div>

                <div className="inspector-card">
                  <div className="inspector-card-row">
                    <span>Reading Progress</span>
                    <strong>{selProg.label || "Unopened"}</strong>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: `${pctVal}%` }} />
                  </div>
                  <div className="inspector-stats-grid">
                    <div>
                      <small>Time Read</small>
                      <strong>{formatDuration(secs)}</strong>
                    </div>
                    <div>
                      <small>Status</small>
                      <strong>
                        {rawProg.finishedAt
                          ? "Finished"
                          : rawProg.lastReadAt
                            ? "In Progress"
                            : "Unopened"}
                      </strong>
                    </div>
                  </div>
                  <div className="inspector-status-actions">
                    {rawProg.finishedAt ? (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() =>
                          saveProgress(selectedBook.id, {
                            finishedAt: undefined,
                          })
                        }
                      >
                        <RotateCcw size={12} /> Mark as reading
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() =>
                          saveProgress(selectedBook.id, {
                            finishedAt: Date.now(),
                            pct: 1,
                          })
                        }
                      >
                        <Check size={12} /> Mark as finished
                      </button>
                    )}
                  </div>
                </div>

                <div className="inspector-notes">
                  <div className="inspector-notes-head">
                    <span className="studio-nav-label">
                      Saved Highlights & Bookmarks (
                      {highlights.length + bookmarks.length})
                    </span>
                    {highlights.length + bookmarks.length > 0 && (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => copySelectedNotesMarkdown(selectedBook)}
                        title="Copy all as Markdown"
                      >
                        {copiedNotes ? <Check size={12} /> : <Copy size={12} />}
                        {copiedNotes ? "Copied" : "Markdown"}
                      </button>
                    )}
                  </div>

                  {highlights.length === 0 && bookmarks.length === 0 ? (
                    <p className="inspector-empty-notes">
                      Select text inside the reader to highlight passages, or
                      press <kbd>B</kbd> to bookmark a page.
                    </p>
                  ) : (
                    <div className="inspector-notes-list">
                      {highlights.map((hl) => (
                        <div key={hl.id} className="inspector-note-card">
                          <button
                            type="button"
                            className="inspector-note-jump"
                            onClick={() => jumpToHighlight(selectedBook, hl)}
                          >
                            <span className="inspector-note-tag">
                              <Highlighter size={11} />
                              {hl.chapter || "Highlight"}
                            </span>
                            <blockquote>“{hl.text}”</blockquote>
                          </button>
                          <button
                            type="button"
                            className="note-del-btn"
                            onClick={() =>
                              deleteHighlightItem(selectedBook, hl.id)
                            }
                            title="Delete highlight"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}

                      {bookmarks.map((bm) => (
                        <div key={bm.id} className="inspector-note-card">
                          <button
                            type="button"
                            className="inspector-note-jump"
                            onClick={() => jumpToBookmark(selectedBook, bm)}
                          >
                            <span className="inspector-note-tag">
                              <Bookmark size={11} />
                              Bookmark
                            </span>
                            <strong>{bm.label}</strong>
                          </button>
                          <button
                            type="button"
                            className="note-del-btn"
                            onClick={() =>
                              deleteBookmarkItem(selectedBook, bm.id)
                            }
                            title="Delete bookmark"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })() : (
            <div className="inspector-empty">
              <BookOpen size={24} />
              <p>Select any book to inspect its progress, metadata, and notes.</p>
            </div>
          )}
        </aside>
      </div>

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

            <div className="modal-tabs" role="tablist" aria-label="How to add book">
              <button
                type="button"
                role="tab"
                aria-selected={addTab === "device"}
                className={`modal-tab${addTab === "device" ? " active" : ""}`}
                onClick={() => {
                  setAddTab("device");
                  setAddError("");
                }}
              >
                <FolderOpen size={14} />
                From Device
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={addTab === "vault"}
                className={`modal-tab${addTab === "vault" ? " active" : ""}`}
                onClick={() => {
                  setAddTab("vault");
                  setAddError("");
                }}
              >
                <CloudUpload size={14} />
                To Vault
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={addTab === "link"}
                className={`modal-tab${addTab === "link" ? " active" : ""}`}
                onClick={() => {
                  setAddTab("link");
                  setAddError("");
                }}
              >
                <Link size={14} />
                By Link
              </button>
            </div>

            {addTab === "device" && (
              <>
                <label className="modal-file-btn modal-file-drop">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".epub,.pdf"
                    multiple
                    onChange={onFilePicked}
                    disabled={addBusy || vaultBusy}
                  />
                  <FolderOpen size={20} />
                  <span>
                    {addBusy
                      ? "Saving to this browser…"
                      : "Choose EPUB or PDF files from this device"}
                  </span>
                  <small>Or drag and drop files anywhere on the library page</small>
                </label>
                <p className="modal-hint">
                  Files you pick are stored in this browser only — nothing is
                  uploaded. EPUB titles, authors, and covers are extracted
                  automatically.
                </p>
              </>
            )}

            {addTab === "vault" && (
              <>
                <div className="field-row">
                  <label className="field">
                    <span>Title override (optional)</span>
                    <input
                      type="text"
                      value={addTitle}
                      onChange={(e) => setAddTitle(e.target.value)}
                      placeholder="Auto from EPUB/filename if blank"
                    />
                  </label>
                  <label className="field">
                    <span>Author override (optional)</span>
                    <input
                      type="text"
                      value={addAuthor}
                      onChange={(e) => setAddAuthor(e.target.value)}
                      placeholder="Author name"
                    />
                  </label>
                </div>

                {vaultStatus.state === "connected" ? (
                  <>
                    <label className="modal-file-btn modal-file-drop">
                      <input
                        ref={vaultFileRef}
                        type="file"
                        accept=".epub,.pdf"
                        multiple
                        onChange={onVaultFilePicked}
                        disabled={vaultBusy || addBusy}
                      />
                      {vaultPhase === "upload" ? (
                        <Loader2 className="spin" size={20} />
                      ) : (
                        <CloudUpload size={20} />
                      )}
                      <span>
                        {vaultPhase === "upload"
                          ? `Uploading ${vaultPct}%`
                          : vaultPhase === "deploy"
                            ? "Deploying…"
                            : "Choose EPUB/PDF files to upload to your vault"}
                      </span>
                    </label>
                    {vaultPhase === "upload" && (
                      <div className="vault-progress" aria-hidden="true">
                        <span style={{ width: `${vaultPct}%` }} />
                      </div>
                    )}
                    {vaultNote && <p className="vault-note">{vaultNote}</p>}
                    <p className="modal-hint">
                      Files go to your private vault ({vaultStatus.repo}) and are
                      published to every device after CI encrypts them.
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
                      {!canWatchDeploys() && !watchDone && (
                        <button
                          type="button"
                          className="secondary-action vault-disconnect"
                          onClick={() => setShowWatchSetup((v) => !v)}
                          title="Live “Deploying…” status and auto-pin after each upload"
                        >
                          Add deploy watching
                        </button>
                      )}
                    </div>
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
              </>
            )}

            {addTab === "link" && (
              <>
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
              </>
            )}

            {addError && <p className="article-error">{addError}</p>}

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-action"
                onClick={() => setShowAdd(false)}
              >
                Close
              </button>
              {addTab === "link" && (
                <button
                  type="submit"
                  className="add-article-btn"
                  disabled={addBusy}
                >
                  <Plus size={15} />
                  Add to library
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
