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
  page?: number;
  total?: number;
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