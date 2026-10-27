import { useState } from "react";
import { selectWidth } from "../selectWidth";
import { FitLevel, Labels } from "../filters";

interface Props<T extends string> {
  value: T;
  labels: Labels<T>;
  onChange: (v: T) => void;
  /** Toolbar squeeze level for the closed label (see useFitLevel). */
  level?: FitLevel;
  /** Always show the full labels (the View > Filters window). */
  full?: boolean;
  title?: string;
  disabled?: boolean;
}

/** A filter <select> whose closed box is sized to a short label for the
 *  toolbar's squeeze level, and whose open list shows the full labels. */
export default function FitSelect<T extends string>({ value, labels, onChange, level = 0, full, title, disabled }: Props<T>) {
  const [focused, setFocused] = useState(false);
  const text = (v: T) => (full || focused ? labels[v].full : labels[v].fit[level]);
  return (
    <select
      className="due-filter-select"
      value={value}
      title={title}
      disabled={disabled}
      style={{ width: selectWidth(text(value)) }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {(Object.keys(labels) as T[]).map((v) => <option key={v} value={v}>{text(v)}</option>)}
    </select>
  );
}
