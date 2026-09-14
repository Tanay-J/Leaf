import { useEffect, useState } from "react";

/* ---------- hash routing (works on GitHub Pages without server config) ---------- */

export function useHashRoute(): string {
  const [hash, setHash] = useState<string>(
    () => window.location.hash || "#/"
  );
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export function navigate(hash: string): void {
  window.location.hash = hash;
}

/* ---------- theme (light / sepia / dark) ---------- */

export type Theme = "light" | "sepia" | "dark";

const THEME_CYCLE: Theme[] = ["light", "sepia", "dark"];

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem("reader-theme");
    if (stored && THEME_CYCLE.includes(stored as Theme)) {
      return stored as Theme;
    }
  } catch {
    /* private mode */
  }
  return "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark-theme", theme === "dark");
    root.classList.toggle("sepia-theme", theme === "sepia");
    try {
      localStorage.setItem("reader-theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  return {
    theme,
    cycleTheme: () =>
      setTheme(
        (t) => THEME_CYCLE[(THEME_CYCLE.indexOf(t) + 1) % THEME_CYCLE.length]
      ),
  };
}

/* ---------- reader sidebar (collapsible left pane) ---------- */

const sidebarKey = "reader-sidebar-open";

export function useSidebarOpen() {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(sidebarKey);
      if (stored !== null) return stored === "1";
    } catch {
      /* private mode */
    }
    return typeof window === "undefined" || window.innerWidth > 720;
  });

  useEffect(() => {
    try {
      localStorage.setItem(sidebarKey, open ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, [open]);

  return { sidebarOpen: open, toggleSidebar: () => setOpen((o) => !o) };
}

/* ---------- library view mode (grid / list) ---------- */

export type LibraryView = "grid" | "list";

export function useLibraryView() {
  const [view, setView] = useState<LibraryView>(() => {
    try {
      return localStorage.getItem("library-view") === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("library-view", view);
    } catch {
      /* storage unavailable */
    }
  }, [view]);

  return { view, setView };
}

/* ---------- reading progress (per browser, via localStorage) ---------- */

export interface BookProgress {
  cfi?: string;
  chapter?: string;
  fontSize?: number;
  fontFamily?: string;
  /** Line-spacing multiplier applied in the reader (undefined = book's own). */
  lineHeight?: number;
  page?: number;
  total?: number;
  /** Reading position as 0..1 (EPUBs; PDFs derive it from page/total). */
  pct?: number;
  zoom?: number;
  /** Last time the position itself moved (not a font tweak) — sync LWW. */
  lastReadAt?: number | null;
  /** First time the book was read to the end. */
  finishedAt?: number | null;
  /** Last time any field changed — sync LWW. */
  updatedAt?: number;
}

/** Fired by saveProgress; the state sync engine listens to schedule pushes. */
export const PROGRESS_SAVED_EVENT = "leaf:progress-changed";

const progressKey = (id: string) => `reader:${id}`;
const PROGRESS_PREFIX = "reader:";

export function loadProgress(id: string): BookProgress {
  try {
    return JSON.parse(localStorage.getItem(progressKey(id)) ?? "{}");
  } catch {
    return {};
  }
}

/** Every progress record, keyed by book id — for the state sync engine. */
export function loadAllProgress(): Record<string, BookProgress> {
  const out: Record<string, BookProgress> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PROGRESS_PREFIX)) continue;
      try {
        out[key.slice(PROGRESS_PREFIX.length)] = JSON.parse(
          localStorage.getItem(key) ?? "{}"
        ) as BookProgress;
      } catch {
        /* skip malformed entries */
      }
    }
  } catch {
    /* storage unavailable */
  }
  return out;
}

/** Writes a full progress map — used by the state sync engine after a pull. */
export function replaceProgress(map: Record<string, BookProgress>): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PROGRESS_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
    for (const [id, data] of Object.entries(map)) {
      localStorage.setItem(progressKey(id), JSON.stringify(data));
    }
  } catch {
    /* storage unavailable */
  }
}

export function saveProgress(id: string, data: BookProgress): void {
  try {
    localStorage.setItem(progressKey(id), JSON.stringify(data));
  } catch {
    /* storage unavailable */
  }
  if (data.lastReadAt) markReadDay();
  try {
    window.dispatchEvent(new CustomEvent(PROGRESS_SAVED_EVENT));
  } catch {
    /* SSR / unavailable */
  }
}

/* ---------- reading activity days (drives streaks) ---------- */

const READ_DAYS_KEY = "leaf:read-days";

/** Local calendar day as YYYY-MM-DD (en-CA formats exactly that). */
export function dayKey(d = new Date()): string {
  return d.toLocaleDateString("en-CA");
}

export function readDays(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(READ_DAYS_KEY) ?? "{}") as Record<
      string,
      boolean
    >;
  } catch {
    return {};
  }
}

function markReadDay(): void {
  try {
    localStorage.setItem(
      READ_DAYS_KEY,
      JSON.stringify({ ...readDays(), [dayKey()]: true })
    );
  } catch {
    /* storage unavailable */
  }
}

/** Union-writes the activity map — used by the state sync engine. */
export function replaceReadDays(map: Record<string, boolean>): void {
  try {
    localStorage.setItem(
      READ_DAYS_KEY,
      JSON.stringify({ ...readDays(), ...map })
    );
  } catch {
    /* storage unavailable */
  }
}

/* ---------- reading time (seconds per day + per book) ---------- */

const READ_SECONDS_KEY = "leaf:read-seconds";
const BOOK_SECONDS_KEY = "leaf:book-seconds";

/** Fired after a reading-time flush; the stats UI listens to refresh. */
export const READING_TIME_EVENT = "leaf:reading-time";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Seconds read per local day (YYYY-MM-DD → seconds). */
export function readSecondsMap(): Record<string, number> {
  return readJson<Record<string, number>>(READ_SECONDS_KEY, {});
}

/** Cumulative seconds per book id. */
export function bookSecondsMap(): Record<string, number> {
  return readJson<Record<string, number>>(BOOK_SECONDS_KEY, {});
}

/**
 * Adds reading time for the current day and the given book. Deliberately does
 * NOT fire PROGRESS_SAVED_EVENT — time rides along on the next progress push
 * instead of triggering one every few seconds while a reader is open.
 */
export function addReadingSeconds(bookId: string, seconds: number): void {
  if (!(seconds > 0)) return;
  const day = dayKey();
  try {
    const perDay = readSecondsMap();
    perDay[day] = (perDay[day] ?? 0) + seconds;
    localStorage.setItem(READ_SECONDS_KEY, JSON.stringify(perDay));
    const perBook = bookSecondsMap();
    perBook[bookId] = (perBook[bookId] ?? 0) + seconds;
    localStorage.setItem(BOOK_SECONDS_KEY, JSON.stringify(perBook));
  } catch {
    /* storage unavailable */
  }
  try {
    window.dispatchEvent(new CustomEvent(READING_TIME_EVENT));
  } catch {
    /* unavailable */
  }
}

/**
 * Max-merges remote per-day seconds into local (clock-skew tolerant) —
 * used by the state sync engine after a pull.
 */
export function replaceReadSeconds(map: Record<string, number>): void {
  try {
    const local = readSecondsMap();
    const merged: Record<string, number> = { ...local };
    for (const [day, secs] of Object.entries(map)) {
      merged[day] = Math.max(merged[day] ?? 0, secs ?? 0);
    }
    localStorage.setItem(READ_SECONDS_KEY, JSON.stringify(merged));
  } catch {
    /* storage unavailable */
  }
}