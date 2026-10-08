// Toolbar filters shared by the Tasks and Calendar toolbars and the
// View > Filters window: their names, their labels at each squeeze level,
// and the hook that keeps a toolbar on one line by shortening labels.
import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CalView, CalendarShow, TaskDisplayMode, EventDisplayMode, DueFilter, SortMode,
  CalendarFilterKey, TasksFilterKey
} from "./views";

/** How squeezed a toolbar is: 0 = normal labels, 1 = shorter, 2 = shortest. */
export type FitLevel = 0 | 1 | 2;

export const CALENDAR_FILTERS: { key: CalendarFilterKey; name: string }[] = [
  { key: "calView", name: "Month / Week / Day" },
  { key: "show", name: "Show tasks / events" },
  { key: "taskDisplay", name: "Task dates" },
  { key: "eventDisplay", name: "Event dates" },
  { key: "lists", name: "Lists" },
  { key: "category", name: "Category" }
];

export const TASKS_FILTERS: { key: TasksFilterKey; name: string }[] = [
  { key: "due", name: "Due" },
  { key: "category", name: "Category" },
  { key: "sort", name: "Sort" },
  { key: "hideCompleted", name: "Hide completed" },
  { key: "showScheduled", name: "Show scheduled" }
];

/** `full` is shown in an open dropdown and the Filters window; `fit` is the
 *  closed label at each FitLevel. */
export type Labels<T extends string> = Record<T, { full: string; fit: [string, string, string] }>;

export const CAL_VIEW_LABELS: Labels<CalView> = {
  dayGridMonth: { full: "Month", fit: ["Month", "Month", "Mo"] },
  timeGridWeek: { full: "Week", fit: ["Week", "Week", "Wk"] },
  timeGridDay: { full: "Day", fit: ["Day", "Day", "Day"] }
};

export const SHOW_LABELS: Labels<CalendarShow> = {
  both: { full: "Show both", fit: ["Show both", "Both", "Both"] },
  tasks: { full: "Show tasks", fit: ["Show tasks", "Tasks", "Tasks"] },
  events: { full: "Show events", fit: ["Show events", "Events", "Events"] }
};

export const TASK_DISPLAY_LABELS: Labels<TaskDisplayMode> = {
  due: { full: "Tasks: Due date only", fit: ["Tasks: Due", "T: Due", "T: D"] },
  start: { full: "Tasks: Start date only", fit: ["Tasks: Start", "T: Start", "T: S"] },
  range: { full: "Tasks: Start–due range", fit: ["Tasks: Start–Due", "T: Start–Due", "T: S–D"] }
};

export const EVENT_DISPLAY_LABELS: Labels<EventDisplayMode> = {
  end: { full: "Events: End date only", fit: ["Events: End", "E: End", "E: E"] },
  start: { full: "Events: Start date only", fit: ["Events: Start", "E: Start", "E: S"] },
  range: { full: "Events: Start–end range", fit: ["Events: Start–End", "E: Start–End", "E: S–E"] }
};

export const DUE_LABELS: Labels<DueFilter> = {
  all: { full: "Due: All", fit: ["Due: All", "Due: All", "All"] },
  today: { full: "Due: Today", fit: ["Due: Today", "Due: Today", "Today"] },
  week: { full: "Due: This week", fit: ["Due: Week", "Due: Wk", "Wk"] },
  month: { full: "Due: This month", fit: ["Due: Month", "Due: Mo", "Mo"] }
};

export const SORT_LABELS: Labels<SortMode> = {
  priority: { full: "Sort: Priority", fit: ["Sort: Pri", "↕ Pri", "↕ Pri"] },
  due: { full: "Sort: Due date", fit: ["Sort: Due", "↕ Due", "↕ Due"] },
  title: { full: "Sort: Title", fit: ["Sort: Title", "↕ Title", "↕ A–Z"] },
  manual: { full: "Sort: Manual", fit: ["Sort: Man", "↕ Man", "↕ Man"] }
};

export const HIDE_COMPLETED_FIT: [string, string, string] = ["Hide completed", "Hide done", "Hide done"];
export const SHOW_SCHEDULED_FIT: [string, string, string] = ["Show scheduled", "Scheduled", "Sched."];
export const SAVE_VIEW_FIT: [string, string, string] = ["☆ Save view", "☆ Save", "☆"];

/** Shortens a name (a category or list name) to `max` characters. */
export function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Keeps a one-line toolbar from overflowing: renders at level 0, and while
 *  the row is wider than its box, steps to shorter labels (up to level 2).
 *  Starts again from 0 when the toolbar's width or `contentKey` (its values
 *  and which filters show) changes. Past level 2 the row scrolls sideways.
 *  All of this runs in layout effects, so the steps never paint. */
export function useFitLevel(ref: RefObject<HTMLElement>, contentKey: string): FitLevel {
  const [level, setLevel] = useState<FitLevel>(0);
  const [width, setWidth] = useState(0);

  // Watch the toolbar's width. Re-checked every render because the toolbar can
  // unmount and come back (switching tabs) while the owner stays mounted.
  const observed = useRef<HTMLElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === observed.current) return;
    observer.current?.disconnect();
    observer.current = null;
    observed.current = el;
    if (!el || typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)));
    observer.current.observe(el);
  });
  useEffect(() => () => observer.current?.disconnect(), []);

  const measuredFor = useRef("");
  useLayoutEffect(() => {
    const key = `${width}|${contentKey}`;
    if (measuredFor.current !== key) {
      measuredFor.current = key;
      if (level !== 0) { setLevel(0); return; }
    }
    const el = ref.current;
    if (el && level < 2 && el.scrollWidth > el.clientWidth + 1) setLevel((level + 1) as FitLevel);
  });

  return level;
}
