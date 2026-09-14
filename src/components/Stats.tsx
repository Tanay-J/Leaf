import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Flame } from "lucide-react";
import {
  loadAllProgress,
  navigate,
  readDays,
  readSecondsMap,
  READING_TIME_EVENT,
  type Theme,
} from "../lib";
import ThemeButton from "./ThemeButton";

interface Props {
  theme: Theme;
  onCycleTheme: () => void;
}

const DAY_MS = 86_400_000;
/** Heatmap span: 26 full weeks ending today (inclusive). */
const HEAT_DAYS = 26 * 7;

function dayKeyOf(d: Date): string {
  return d.toLocaleDateString("en-CA");
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function fmtMinutes(total: number): string {
  const mins = Math.round(total / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hrs} h ${rest} min` : `${hrs} h`;
}

/** Intensity bucket for a day's minutes (0 = no reading). */
function heatLevel(seconds: number): 0 | 1 | 2 | 3 | 4 {
  const mins = seconds / 60;
  if (mins <= 0) return 0;
  if (mins < 10) return 1;
  if (mins < 25) return 2;
  if (mins < 60) return 3;
  return 4;
}

/** Reading stats dashboard: #/stats. */
export default function Stats({ theme, onCycleTheme }: Props) {
  // tick drives recomputation — the data lives in localStorage, not state.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onTime = () => setTick((t) => t + 1);
    window.addEventListener(READING_TIME_EVENT, onTime);
    return () => window.removeEventListener(READING_TIME_EVENT, onTime);
  }, []);

  const stats = useMemo(() => {
    const days = readDays();
    const seconds = readSecondsMap();
    const today = new Date();

    // Current streak (walks back from today; today counts once read).
    let current = 0;
    let cursor = addDays(today, 0);
    if (!days[dayKeyOf(cursor)]) cursor = addDays(cursor, -1);
    while (days[dayKeyOf(cursor)]) {
      current++;
      cursor = addDays(cursor, -1);
    }

    // Longest streak over all recorded days.
    const keys = Object.keys(days).sort();
    let longest = 0;
    let run = 0;
    let prev: Date | null = null;
    for (const key of keys) {
      if (!days[key]) continue;
      const d = new Date(`${key}T12:00:00`);
      run = prev && Math.round((d.getTime() - prev.getTime()) / DAY_MS) === 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = d;
    }

    // Totals.
    let totalSeconds = 0;
    let weekSeconds = 0;
    const weekStart = addDays(today, -6);
    for (const [key, secs] of Object.entries(seconds)) {
      totalSeconds += secs ?? 0;
      const when = new Date(`${key}T12:00:00`);
      if (when >= weekStart && when <= today) weekSeconds += secs ?? 0;
    }

    // Heatmap cells laid out in week columns (Monday-first).
    const cells: {
      key: string;
      date: Date;
      level: 0 | 1 | 2 | 3 | 4;
      mins: number;
    }[] = [];
    const start = addDays(today, -(HEAT_DAYS - 1));
    const startDow = (start.getDay() + 6) % 7; // 0 = Monday
    const alignedStart = addDays(start, -startDow);
    for (let i = 0; i < HEAT_DAYS + startDow; i++) {
      const d = addDays(alignedStart, i);
      const key = dayKeyOf(d);
      const secs = seconds[key] ?? 0;
      cells.push({
        key,
        date: d,
        level: d > today ? 0 : heatLevel(secs),
        mins: secs / 60,
      });
    }

    // Per-book finished counts.
    let finished = 0;
    let inProgress = 0;
    for (const p of Object.values(loadAllProgress())) {
      if (p.finishedAt) finished++;
      else if (p.lastReadAt) inProgress++;
    }
    return { current, longest, totalSeconds, weekSeconds, cells, finished, inProgress };
    // Data is tiny and events rare — recompute whenever the tick changes.
  }, [tick]);

  const months = useMemo(() => {
    // Month label positions across the heatmap's week columns.
    const out: { col: number; label: string }[] = [];
    let last = "";
    stats.cells.forEach((c, i) => {
      const col = Math.floor(i / 7);
      const label = c.date.toLocaleDateString(undefined, { month: "short" });
      if (label !== last && col !== out[out.length - 1]?.col) {
        out.push({ col, label });
        last = label;
      }
    });
    return out;
  }, [stats.cells]);

  return (
    <div className="library">
      <header className="topbar">
        <div className="topbar-actions">
          <button className="secondary-action" onClick={() => navigate("#/")}>
            <ArrowLeft size={15} />
            Library
          </button>
        </div>
        <div className="reader-title">
          <strong>Reading stats</strong>
        </div>
        <div className="topbar-actions">
          <ThemeButton theme={theme} onCycleTheme={onCycleTheme} />
        </div>
      </header>

      <main className="content stats-page">
        <div className="stat-cards">
          <div className="stat-card">
            <Flame size={16} aria-hidden />
            <strong>{stats.current}</strong>
            <span>day streak now</span>
          </div>
          <div className="stat-card">
            <strong>{stats.longest}</strong>
            <span>longest streak</span>
          </div>
          <div className="stat-card">
            <strong>{fmtMinutes(stats.weekSeconds)}</strong>
            <span>read this week</span>
          </div>
          <div className="stat-card">
            <strong>{fmtMinutes(stats.totalSeconds)}</strong>
            <span>all-time reading</span>
          </div>
          <div className="stat-card">
            <BookOpen size={16} aria-hidden />
            <strong>{stats.finished}</strong>
            <span>finished · {stats.inProgress} in progress</span>
          </div>
        </div>

        <section className="stat-section">
          <h3>Last six months</h3>
          <div className="heatmap-scroll">
            <div className="heatmap">
              <div className="heatmap-months">
                {months.map((m) => (
                  <span
                    key={`${m.label}-${m.col}`}
                    style={{ gridColumn: m.col + 1 }}
                  >
                    {m.label}
                  </span>
                ))}
              </div>
              <div className="heatmap-grid">
                {stats.cells.map((c) => (
                  <span
                    key={c.key}
                    className={`heat-cell heat-${c.level}`}
                    title={`${c.key}${
                      c.mins >= 1 ? ` · ${Math.round(c.mins)} min` : ""
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
          <p className="heatmap-legend">
            less
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className={`heat-cell heat-${l}`} />
            ))}
            more
          </p>
        </section>

        <p className="footnote">
          Reading time accumulates while a book is open in the foreground, and
          syncs with your progress when the vault is connected.
        </p>
      </main>
    </div>
  );
}