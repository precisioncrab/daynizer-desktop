import { useLayoutEffect, useRef, useState } from "react";

type Props = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string;
  /** Max pixel height before the field scrolls internally (default 320). */
  maxHeight?: number;
  /** Pass the current record id so switching records re-fits and re-expands. */
  resetKey?: string | number;
};

/**
 * A notes textarea that auto-grows to fit what you type (up to maxHeight, then
 * scrolls). A small corner button collapses it back to one line and expands it
 * to the full view. Collapse resets to expanded when the record changes.
 */
export default function AutoGrowTextarea({ value, maxHeight = 320, resetKey, className, onInput, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  function apply() {
    const el = ref.current;
    if (!el) return;
    if (collapsed) {
      // Back to the one-line CSS min-height; hide the overflow (no
      // scrollbar/steppers) -- expand to read the rest.
      el.style.height = "";
      el.style.overflowY = "hidden";
      return;
    }
    // Expanded: grow to fit content. Collapse to measure, then set. border-box
    // height must include the border (scrollHeight omits it) or the last line clips.
    el.style.height = "auto";
    const cs = getComputedStyle(el);
    const borderY = parseFloat(cs.borderTopWidth || "0") + parseFloat(cs.borderBottomWidth || "0");
    const full = el.scrollHeight + borderY;
    el.style.height = Math.min(full, maxHeight) + "px";
    el.style.overflowY = full > maxHeight ? "auto" : "hidden";
  }

  useLayoutEffect(apply, [value, maxHeight, resetKey, collapsed]);
  // Switching records starts fresh (expanded).
  useLayoutEffect(() => { setCollapsed(false); }, [resetKey]);

  const cls = ["autogrow-textarea", className].filter(Boolean).join(" ");
  return (
    <div className="autogrow-wrap">
      <textarea
        {...rest}
        ref={ref}
        value={value}
        rows={1}
        className={cls}
        onInput={(e) => { apply(); onInput?.(e); }}
      />
      <button
        type="button"
        className="autogrow-toggle"
        title={collapsed ? "Expand notes" : "Collapse notes"}
        aria-label={collapsed ? "Expand notes" : "Collapse notes"}
        onClick={() => setCollapsed((c) => !c)}
      >
        <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"
             style={{ transform: collapsed ? "none" : "rotate(180deg)" }}>
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
