import { useEffect, useRef, useState } from "react";
import { Minus, Plus, Type } from "lucide-react";
import { FONT_OPTIONS, LINE_HEIGHT_OPTIONS } from "../typography";
import type { EpubLayout } from "../lib";

interface Props {
  fontId: string;
  spacingId: string;
  fontSize: number;
  layout?: EpubLayout;
  onFont: (id: string) => void;
  onSpacing: (id: string) => void;
  /** Size change in %, e.g. ±10. */
  onSize: (delta: number) => void;
  onLayout?: (layout: EpubLayout) => void;
}

const LAYOUT_OPTIONS: { id: EpubLayout; label: string }[] = [
  { id: "single", label: "1 Page" },
  { id: "spread", label: "2 Pages" },
  { id: "scroll", label: "Scroll" },
];

/**
 * The "Aa" typography popover shared by the EPUB and article readers:
 * font picker (rendered in each face), size stepper, line spacing, and
 * optional EPUB layout mode.
 * Closes on outside click or Escape and restores focus to its trigger.
 */
export default function TypographyMenu({
  fontId,
  spacingId,
  fontSize,
  layout,
  onFont,
  onSpacing,
  onSize,
  onLayout,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="typo-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        className={`mini-btn${open ? " active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Typography"
        aria-label="Typography options"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Type size={14} />
      </button>

      {open && (
        <div className="typo-pop" role="dialog" aria-label="Typography options">
          <div className="typo-group">
            <span className="typo-label">Font</span>
            <div className="typo-fonts">
              {FONT_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  className={`typo-font${fontId === o.id ? " active" : ""}`}
                  style={{ fontFamily: o.stack }}
                  onClick={() => onFont(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="typo-row">
            <span className="typo-label">Size</span>
            <button
              className="mini-btn"
              onClick={() => onSize(-10)}
              aria-label="Smaller text"
            >
              <Minus size={14} />
            </button>
            <span className="pos-label">{fontSize}%</span>
            <button
              className="mini-btn"
              onClick={() => onSize(10)}
              aria-label="Larger text"
            >
              <Plus size={14} />
            </button>
          </div>

          <div className="typo-group">
            <span className="typo-label">Line spacing</span>
            <div className="typo-spacing" role="group" aria-label="Line spacing">
              {LINE_HEIGHT_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  className={spacingId === o.id ? "active" : ""}
                  onClick={() => onSpacing(o.id)}
                >
                  {o.label.replace("Spacing: ", "")}
                </button>
              ))}
            </div>
          </div>

          {onLayout && layout && (
            <div className="typo-group">
              <span className="typo-label">Page layout</span>
              <div className="typo-layout" role="group" aria-label="Page layout">
                {LAYOUT_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    className={layout === o.id ? "active" : ""}
                    onClick={() => onLayout(o.id)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}