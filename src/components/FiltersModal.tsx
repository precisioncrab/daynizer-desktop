import { useEffect } from "react";
import { TaskList } from "../types";
import {
  CalView, CalendarShow, TaskDisplayMode, EventDisplayMode, CalendarLists, DueFilter, SortMode, HiddenFilters,
  CalendarFilterKey, TasksFilterKey
} from "../views";
import {
  CALENDAR_FILTERS, TASKS_FILTERS, CAL_VIEW_LABELS, SHOW_LABELS, TASK_DISPLAY_LABELS, EVENT_DISPLAY_LABELS,
  DUE_LABELS, SORT_LABELS
} from "../filters";
import FitSelect from "./FitSelect";
import ListPicker from "./ListPicker";
import { selectWidth } from "../selectWidth";

interface Props {
  /** The tab you opened it from; its section comes first. */
  firstTab: "tasks" | "calendar";
  hidden: HiddenFilters;
  onSetShown: (tab: keyof HiddenFilters, key: string, shown: boolean) => void;
  lists: TaskList[];
  calendar: {
    calView: CalView; onCalView: (v: CalView) => void;
    show: CalendarShow; onShow: (v: CalendarShow) => void;
    taskDisplay: TaskDisplayMode; onTaskDisplay: (v: TaskDisplayMode) => void;
    eventDisplay: EventDisplayMode; onEventDisplay: (v: EventDisplayMode) => void;
    lists: CalendarLists; onLists: (id: string, additive: boolean) => void;
    category: string; onCategory: (v: string) => void; categories: string[];
  };
  tasks: {
    due: DueFilter; onDue: (v: DueFilter) => void;
    category: string; onCategory: (v: string) => void; categories: string[];
    sort: SortMode; onSort: (v: SortMode) => void;
    hideCompleted: boolean; onHideCompleted: (v: boolean) => void;
    showScheduled: boolean; onShowScheduled: (v: boolean) => void;
  };
  onClose: () => void;
}

function CategorySelect({ value, categories, onChange }: { value: string; categories: string[]; onChange: (v: string) => void }) {
  const label = value === "all" ? "Category: All" : `Category: ${value}`;
  return (
    <select className="due-filter-select" value={value} style={{ width: selectWidth(label) }} onChange={(e) => onChange(e.target.value)}>
      <option value="all">Category: All</option>
      {categories.map((c) => <option key={c} value={c}>{`Category: ${c}`}</option>)}
    </select>
  );
}

/** View > Filters: tick a filter to show it on the toolbar, untick to hide
 *  it. A hidden filter keeps applying, so its setting can be changed here. */
export default function FiltersModal({ firstTab, hidden, onSetShown, lists, calendar: c, tasks: t, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function calendarControl(key: CalendarFilterKey) {
    switch (key) {
      case "calView": return <FitSelect full value={c.calView} labels={CAL_VIEW_LABELS} onChange={c.onCalView} />;
      case "show": return <FitSelect full value={c.show} labels={SHOW_LABELS} onChange={c.onShow} />;
      case "taskDisplay": return <FitSelect full value={c.taskDisplay} labels={TASK_DISPLAY_LABELS} onChange={c.onTaskDisplay} />;
      case "eventDisplay": return <FitSelect full value={c.eventDisplay} labels={EVENT_DISPLAY_LABELS} onChange={c.onEventDisplay} />;
      case "lists": return <ListPicker lists={lists} value={c.lists} onChange={c.onLists} />;
      case "category": return <CategorySelect value={c.category} categories={c.categories} onChange={c.onCategory} />;
    }
  }

  function tasksControl(key: TasksFilterKey) {
    switch (key) {
      case "due": return <FitSelect full value={t.due} labels={DUE_LABELS} onChange={t.onDue} />;
      case "category": return <CategorySelect value={t.category} categories={t.categories} onChange={t.onCategory} />;
      case "sort": return <FitSelect full value={t.sort} labels={SORT_LABELS} onChange={t.onSort} />;
      case "hideCompleted":
        return <input type="checkbox" checked={t.hideCompleted} onChange={(e) => t.onHideCompleted(e.target.checked)} />;
      case "showScheduled":
        return <input type="checkbox" checked={t.showScheduled} onChange={(e) => t.onShowScheduled(e.target.checked)} />;
    }
  }

  const calendarSection = (
    <section key="calendar">
      <h3>Calendar</h3>
      {CALENDAR_FILTERS.map((f) => (
        <div className="filters-row" key={f.key}>
          <label className="filters-show">
            <input
              type="checkbox"
              checked={!hidden.calendar.includes(f.key)}
              onChange={(e) => onSetShown("calendar", f.key, e.target.checked)}
            />
            {f.name}
          </label>
          <div className="filters-control">{calendarControl(f.key)}</div>
        </div>
      ))}
    </section>
  );

  const tasksSection = (
    <section key="tasks">
      <h3>Tasks</h3>
      {TASKS_FILTERS.map((f) => (
        <div className="filters-row" key={f.key}>
          <label className="filters-show">
            <input
              type="checkbox"
              checked={!hidden.tasks.includes(f.key)}
              onChange={(e) => onSetShown("tasks", f.key, e.target.checked)}
            />
            {f.name}
          </label>
          <div className="filters-control">{tasksControl(f.key)}</div>
        </div>
      ))}
    </section>
  );

  return (
    <div className="overlay" onClick={onClose}>
      <div className="settings-modal filters-modal" style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>Filters</h2>
        <p className="filters-hint">
          Ticked filters show on the toolbar. Unticked ones are hidden but still apply; change them here.
          Saved views remember both.
        </p>
        {firstTab === "calendar" ? [calendarSection, tasksSection] : [tasksSection, calendarSection]}
      </div>
    </div>
  );
}
