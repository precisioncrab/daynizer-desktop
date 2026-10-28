import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

interface ActionItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** true or false puts a tick column in front of the label. */
  checked?: boolean;
  title?: string;
}

/** A row of color dots in the real colors (as in Contacts Cleanup's menu); `current` is ringed.
 *  With `onNone`, a dashed dot at the end is "No color". */
interface ColorsItem {
  colors: { name: string; color: string }[];
  current?: string | null;
  onPick: (color: string) => void;
  onNone?: () => void;
}

interface SeparatorItem {
  separator: true;
}

/** Items that open beside this one on hover (as in Contacts Cleanup's menu). */
interface SubmenuItem {
  label: string;
  submenu: (ActionItem | SeparatorItem)[];
}

export type Item = ActionItem | ColorsItem | SeparatorItem | SubmenuItem;

interface Props {
  x: number;
  y: number;
  items: Item[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Start at the click point, then shift up/left after measuring so the whole
  // menu stays on screen (a right-click near the bottom edge was clipping the
  // last items -- e.g. "Delete list" -- off the window). Runs before paint to
  // avoid a visible jump.
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const nx = x + width > window.innerWidth - margin
      ? Math.max(margin, window.innerWidth - width - margin) : x;
    const ny = y + height > window.innerHeight - margin
      ? Math.max(margin, window.innerHeight - height - margin) : y;
    setPos({ x: nx, y: ny });
  }, [x, y, items.length]);
  // The submenu open (its item's index); a submenu that won't fit on the right opens on the left.
  const [openSub, setOpenSub] = useState<number | null>(null);
  const [subLeft, setSubLeft] = useState(false);

  useEffect(() => {
    // Only close on a subsequent click outside the menu. We deliberately do NOT
    // listen for "contextmenu" here: that's the same event type that just opened
    // this menu, and React can flush this effect while that very event is still
    // bubbling up to document — which would close the menu instantly on open.
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  const action = (item: ActionItem, key: React.Key, onMouseEnter?: () => void) => (
    <div
      key={key}
      className={`item ${item.danger ? "danger" : ""} ${item.disabled ? "disabled" : ""}`}
      title={item.title}
      role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={item.checked === undefined ? undefined : item.checked}
      onMouseEnter={onMouseEnter}
      onClick={item.disabled ? undefined : () => { item.onClick(); onClose(); }}
    >
      {item.checked !== undefined && <span className="tick" aria-hidden="true">{item.checked ? "✓" : ""}</span>}
      {item.label}
    </div>
  );

  return (
    <div className="context-menu" style={{ left: pos.x, top: pos.y }} ref={ref}>
      {items.map((item, i) => ("separator" in item ? (
        <div key={`sep-${i}`} className="separator" />
      ) : "submenu" in item ? (
        <div
          key={item.label}
          className="item has-sub"
          aria-haspopup="true"
          onMouseEnter={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setSubLeft(r.right + 240 > window.innerWidth);
            setOpenSub(i);
          }}
          onClick={() => setOpenSub(i)}
        >
          <span>{item.label}</span>
          <span className="sub-arrow" aria-hidden="true">▸</span>
          {openSub === i && (
            <div className={`context-menu sub${subLeft ? " left" : ""}`} onClick={(e) => e.stopPropagation()}>
              {item.submenu.map((s, k) => ("separator" in s ? <div key={`sep-${k}`} className="separator" /> : action(s, k)))}
            </div>
          )}
        </div>
      ) : "colors" in item ? (
        <div key="colors" className="colors" onMouseEnter={() => setOpenSub(null)}>
          {item.colors.map((c) => (
            <button
              key={c.color}
              type="button"
              className={`swatch${item.current?.toLowerCase() === c.color.toLowerCase() ? " on" : ""}`}
              title={c.name}
              aria-label={c.name}
              style={{ background: c.color }}
              onClick={() => { item.onPick(c.color); onClose(); }}
            />
          ))}
          {item.onNone && (
            <button
              type="button"
              className={`swatch none${item.current ? "" : " on"}`}
              title="No color"
              aria-label="No color"
              onClick={() => { item.onNone!(); onClose(); }}
            />
          )}
        </div>
      ) : (
        action(item, item.label, () => setOpenSub(null))
      )))}
    </div>
  );
}
