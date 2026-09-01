import { useLayoutEffect, useRef } from "react";

type Props = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string;
  /** Max pixel height before the field scrolls internally (default 320). */
  maxHeight?: number;
  /** Pass the current record id so switching records re-fits the field. */
  resetKey?: string | number;
};

/**
 * A textarea that starts at one line and grows to fit what you type, up to
 * maxHeight (after which it scrolls). Height is driven entirely by JS so the
 * behavior is predictable across engines.
 */
export default function AutoGrowTextarea({ value, maxHeight = 320, resetKey, className, onInput, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const el = ref.current;
    if (!el) return;
    // Collapse first so scrollHeight reflects the true content height, then
    // grow to fit. border-box height must include the border (scrollHeight
    // does not) or the last line clips.
    el.style.height = "auto";
    const cs = getComputedStyle(el);
    const borderY = parseFloat(cs.borderTopWidth || "0") + parseFloat(cs.borderBottomWidth || "0");
    const full = el.scrollHeight + borderY;
    el.style.height = Math.min(full, maxHeight) + "px";
    el.style.overflowY = full > maxHeight ? "auto" : "hidden";
  }

  // Re-fit on external changes: typing (value), switching records (resetKey),
  // or a different cap.
  useLayoutEffect(resize, [value, maxHeight, resetKey]);

  return (
    <textarea
      {...rest}
      ref={ref}
      value={value}
      rows={1}
      className={["autogrow-textarea", className].filter(Boolean).join(" ")}
      onInput={(e) => { resize(); onInput?.(e); }}
    />
  );
}
