// List selections and saved views, shared by the Tasks and Calendar tabs.
//
// Each tab keeps its own selection: Tasks can be "all", "today" (Today &
// Overdue) or a set of lists; the Calendar can be "all" or a set of lists.
// Click a list to show only it, Ctrl/Cmd+click to add or remove it.
//
// Saved views are one list usable from either tab. A view always carries its
// lists and category; it also carries the filters of the tab it was saved
// from, which only apply when it's opened in that same tab.

export type TaskScope = "all" | "today" | string[];
export type CalendarLists = "all" | string[];
export type DueFilter = "all" | "today" | "week" | "month";
export type CalendarShow = "both" | "tasks" | "events";
export type TaskDisplayMode = "range" | "due" | "start";
export type EventDisplayMode = "range" | "start" | "end";
export type CalView = "dayGridMonth" | "timeGridWeek" | "timeGridDay";
export type SortMode = "priority" | "due" | "title" | "manual";

/** The toolbar filters each tab has. Any of them can be hidden from the
 *  toolbar (View > Filters); a hidden filter keeps applying its value. */
export type CalendarFilterKey = "calView" | "show" | "taskDisplay" | "eventDisplay" | "lists" | "category";
export type TasksFilterKey = "due" | "category" | "sort" | "hideCompleted" | "showScheduled";
export interface HiddenFilters {
  calendar: CalendarFilterKey[];
  tasks: TasksFilterKey[];
}

export interface SavedView {
  id: string;
  name: string;
  /** Tab the view was saved from; its own filters apply only there. */
  origin: "tasks" | "calendar";
  lists: TaskScope;
  categoryFilter: string;
  // sortMode/calView/hidden are optional: views saved before they existed
  // leave the current sort, Month/Week/Day and toolbar as they are.
  tasks?: {
    search: string;
    dueFilter: DueFilter;
    hideCompleted: boolean;
    showScheduled: boolean;
    sortMode?: SortMode;
    hidden?: TasksFilterKey[];
  };
  calendar?: {
    show: CalendarShow;
    taskDisplayMode: TaskDisplayMode;
    eventDisplayMode: EventDisplayMode;
    calView?: CalView;
    hidden?: CalendarFilterKey[];
  };
}

/** Saved views from localStorage. Views saved before multi-list selection
 *  (the old "smart filter" shape, one `scope` string) are converted. */
export function loadSavedViews(): SavedView[] {
  let raw: any[];
  try {
    raw = JSON.parse(localStorage.getItem("smartFilters") || "[]");
    if (!Array.isArray(raw)) return [];
  } catch {
    return [];
  }
  return raw.filter((v) => v && typeof v.id === "string").map((v): SavedView => {
    if (v.origin) return v as SavedView;
    const scope: string = v.scope ?? "all";
    return {
      id: v.id,
      name: v.name ?? "Untitled view",
      origin: "tasks",
      lists: scope === "all" || scope === "today" ? scope : [scope],
      categoryFilter: v.categoryFilter ?? "all",
      tasks: {
        search: v.search ?? "",
        dueFilter: v.dueFilter ?? "all",
        hideCompleted: !!v.hideCompleted,
        showScheduled: !!v.showScheduled
      }
    };
  });
}

export function saveSavedViews(views: SavedView[]): void {
  try { localStorage.setItem("smartFilters", JSON.stringify(views)); } catch { /* storage unavailable */ }
}

/** Plain click selects only `id`; additive (Ctrl/Cmd) click adds or removes a
 *  list. "all"/"today" are always single. Removing the last list falls back to
 *  "all". The first list chosen stays first, since new items go there. */
export function nextSelection(prev: TaskScope, id: string, additive: boolean): TaskScope {
  if (id === "all" || id === "today") return id;
  if (!additive || !Array.isArray(prev)) return [id];
  if (prev.includes(id)) {
    const rest = prev.filter((x) => x !== id);
    return rest.length ? rest : "all";
  }
  return [...prev, id];
}

/** Drops list ids that no longer exist (deleted lists); empty becomes "all". */
export function pruneSelection<T extends TaskScope>(sel: T, listIds: Set<string>): T | "all" {
  if (!Array.isArray(sel)) return sel;
  const kept = sel.filter((id) => listIds.has(id));
  if (kept.length === sel.length) return sel;
  return kept.length ? (kept as T) : "all";
}

/** "Groceries", "Groceries, Lowes", "Groceries, Lowes, Walmart", "Groceries + 3". */
export function selectionLabel(sel: string[], nameOf: (id: string) => string | undefined): string {
  const names = sel.map(nameOf).filter((n): n is string => !!n);
  if (!names.length) return "";
  if (names.length <= 3) return names.join(", ");
  return `${names[0]} + ${names.length - 1}`;
}

/** Short form for tight spots like the calendar's List: button:
 *  "Groceries", "Groceries + 1", "Groceries + 2". */
export function compactSelectionLabel(sel: string[], nameOf: (id: string) => string | undefined): string {
  const names = sel.map(nameOf).filter((n): n is string => !!n);
  if (!names.length) return "";
  return names.length === 1 ? names[0] : `${names[0]} + ${names.length - 1}`;
}

/** Calendar selection persisted between sessions. Accepts the old format
 *  (a bare "all" or single list id) as well as a JSON array. */
export function loadCalendarLists(): CalendarLists {
  const raw = localStorage.getItem("calendarListFilter");
  if (!raw || raw === "all") return "all";
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) && arr.length ? arr.map(String) : "all";
    } catch {
      return "all";
    }
  }
  return [raw];
}

export function storeCalendarLists(sel: CalendarLists): void {
  try { localStorage.setItem("calendarListFilter", sel === "all" ? "all" : JSON.stringify(sel)); } catch { /* ignore */ }
}

/** Which toolbar filters are hidden, per tab (View > Filters). */
export function loadHiddenFilters(): HiddenFilters {
  try {
    const v = JSON.parse(localStorage.getItem("hiddenFilters") || "{}");
    return {
      calendar: Array.isArray(v.calendar) ? v.calendar : [],
      tasks: Array.isArray(v.tasks) ? v.tasks : []
    };
  } catch {
    return { calendar: [], tasks: [] };
  }
}

export function storeHiddenFilters(h: HiddenFilters): void {
  try { localStorage.setItem("hiddenFilters", JSON.stringify(h)); } catch { /* ignore */ }
}

/** Settings → default views. "" = built-in default (All Tasks / last used). */
export const DEFAULT_TASKS_VIEW_KEY = "defaultTasksView";
export const DEFAULT_CALENDAR_VIEW_KEY = "defaultCalendarView";
export function readDefaultView(key: string): string {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}
export function writeDefaultView(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
