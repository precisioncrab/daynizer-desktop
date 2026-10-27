import { useEffect, useRef, useState } from "react";
import { TaskList } from "../types";
import { CalendarLists } from "../views";
import { selectWidth } from "../selectWidth";
import { FitLevel, clip } from "../filters";

interface Props {
  lists: TaskList[];
  value: CalendarLists;
  /** additive = tick a checkbox or Ctrl/Cmd+click a name; plain click on a
   *  name shows only that list. id "all" clears the selection. */
  onChange: (id: string, additive: boolean) => void;
  /** Shorter button label when the toolbar is squeezed (see useFitLevel). */
  level?: FitLevel;
}

/** "List: Groceries + 1", shortened as the toolbar squeezes. */
function pickerLabel(value: CalendarLists, lists: TaskList[], level: FitLevel): string {
  const names = value === "all"
    ? []
    : value.map((id) => lists.find((l) => l.id === id)?.name).filter((n): n is string => !!n);
  if (!names.length) return ["List: All", "All lists", "All lists"][level];
  const more = names.length > 1 ? ` + ${names.length - 1}` : "";
  if (level === 0) return `List: ${names[0]}${more}`;
  return `${clip(names[0], level === 1 ? 16 : 10)}${more}`;
}

/** The calendar's "List:" filter. A native <select> can only hold one value,
 *  so this is a small dropdown of checkboxes: tick to add/remove a list,
 *  click a name to show only that list. */
export default function ListPicker({ lists, value, onChange, level = 0 }: Props) {
  const [open, setOpen] = useState(false);
  // The menu is position: fixed at the button's corner, so a toolbar that
  // scrolls sideways (overflow) can't clip it.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = value === "all" ? [] : value;
  const label = pickerLabel(value, lists, level);

  return (
    <div ref={rootRef} className="list-picker">
      <button
        type="button"
        className="due-filter-select"
        style={{ width: selectWidth(label) }}
        title="Choose which lists the calendar shows. Tick to add a list, click a name to show only that list."
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenuPos({ top: r.bottom + 4, left: r.left });
          setOpen((o) => !o);
        }}
      >
        {label} ▾
      </button>
      {open && (
        <div className="list-picker-menu" style={menuPos ? { position: "fixed", top: menuPos.top, left: menuPos.left } : undefined}>
          <div
            className={`list-picker-item ${value === "all" ? "active" : ""}`}
            onClick={() => { onChange("all", false); setOpen(false); }}
          >
            <span className="list-picker-check" />
            <span>All lists</span>
          </div>
          {lists.map((l) => {
            const on = selected.includes(l.id);
            return (
              <div key={l.id} className={`list-picker-item ${on ? "active" : ""}`}>
                <input
                  type="checkbox"
                  className="list-picker-check"
                  checked={on}
                  onChange={() => onChange(l.id, true)}
                />
                <span className="sidebar-dot" style={{ background: l.color }} />
                <span
                  className="list-picker-name"
                  onClick={(e) => {
                    const additive = e.ctrlKey || e.metaKey;
                    onChange(l.id, additive);
                    if (!additive) setOpen(false);
                  }}
                >
                  {l.name}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
