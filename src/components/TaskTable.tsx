import React, { useEffect, useState } from "react";
import { Task, PRIORITY_COLORS } from "../types";
import { capitalize, isAllDayValue, readStoredDate, relativeDayLabel, sameLocalDay, shortDateLabel, timeLabel } from "../dates";

interface Props {
  tasks: Task[]; // already filtered to the current scope, includes subtasks
  selectedTaskId: string | null;
  onSelect: (id: string) => void;
  onToggleComplete: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, taskId: string) => void;
  /** Manual sort mode only: rows become draggable. */
  dragEnabled?: boolean;
  onReorder?: (draggedId: string, targetId: string) => void;
  /** Ignore collapsed state (e.g. while searching, so matching subtasks show). */
  forceExpand?: boolean;
}

function formatDue(due: string | null): { text: string; overdue: boolean } | null {
  // readStoredDate keeps an all-day due date on its own local day (see dates.ts).
  const when = due ? readStoredDate(due) : null;
  if (!due || !when) return null;
  const now = new Date();
  const allDay = isAllDayValue(due);
  const dueToday = sameLocalDay(when, now);
  // An all-day task is overdue from the day after it's due; a timed one as
  // soon as its time has passed.
  const overdue = allDay ? !dueToday && when.getTime() < now.getTime() : when.getTime() < now.getTime();
  // The word for "today" comes from the locale too, so it matches the dates.
  const day = dueToday ? capitalize(relativeDayLabel(0)) : shortDateLabel(when);
  return { text: allDay ? day : `${day} ${timeLabel(when)}`, overdue };
}

export default function TaskTable({ tasks, selectedTaskId, onSelect, onToggleComplete, onContextMenu, dragEnabled = false, onReorder, forceExpand = false }: Props) {
  const topLevel = tasks.filter((t) => !t.parent_id);
  const childrenOf = (id: string) => tasks.filter((t) => t.parent_id === id);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Parents whose subtasks are collapsed (hidden). Persisted so the layout
  // survives reloads and list switches.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("collapsedSubtasks") || "[]")); } catch { return new Set(); }
  });
  useEffect(() => {
    localStorage.setItem("collapsedSubtasks", JSON.stringify([...collapsed]));
  }, [collapsed]);
  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (topLevel.length === 0) {
    return <div className="empty-state">No tasks here. Press Ctrl+N to add one.</div>;
  }

  function renderRow(t: Task, depth: number) {
    const due = formatDue(t.due_date);
    const children = childrenOf(t.id);
    const isCollapsed = !forceExpand && collapsed.has(t.id);
    return (
      <React.Fragment key={t.id}>
        <div
          className={`task-row ${depth > 0 ? "subtask" : ""} ${t.completed ? "completed" : ""} ${selectedTaskId === t.id ? "selected" : ""} ${dragOverId === t.id ? "drag-over" : ""}`}
          onClick={() => onSelect(t.id)}
          onContextMenu={(e) => onContextMenu(e, t.id)}
          draggable={dragEnabled}
          onDragStart={(e) => {
            if (!dragEnabled) return;
            e.dataTransfer.setData("text/task-id", t.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            if (!dragEnabled) return;
            e.preventDefault(); // required to allow dropping
            setDragOverId(t.id);
          }}
          onDragLeave={() => setDragOverId((cur) => (cur === t.id ? null : cur))}
          onDrop={(e) => {
            if (!dragEnabled) return;
            e.preventDefault();
            setDragOverId(null);
            const draggedId = e.dataTransfer.getData("text/task-id");
            if (draggedId && draggedId !== t.id) onReorder?.(draggedId, t.id);
          }}
          onDragEnd={() => setDragOverId(null)}
        >
          {children.length > 0 ? (
            <span
              className="subtask-toggle"
              title={isCollapsed ? "Expand subtasks" : "Collapse subtasks"}
              onClick={(e) => { e.stopPropagation(); toggleCollapsed(t.id); }}
            >{isCollapsed ? "▸" : "▾"}</span>
          ) : (
            <span className="subtask-toggle spacer" />
          )}
          <span
            className={`checkbox ${t.completed ? "done" : ""}`}
            onClick={(e) => { e.stopPropagation(); onToggleComplete(t.id); }}
          />
          {!t.completed && t.priority !== 0 && (
            <span className="priority-dot" style={{ background: PRIORITY_COLORS[t.priority] }} />
          )}
          <div className="title-col">
            <div className="title">{t.title}</div>
            <div className="meta">
              {due && <span className={due.overdue ? "overdue" : ""}>{due.overdue ? "Overdue · " : "Due "}{due.text}</span>}
              {t.recurrence && <span>↻ repeats</span>}
              {t.tags && <span>{t.tags}</span>}
              {children.length > 0 && <span>{children.filter((c) => c.completed).length}/{children.length} subtasks</span>}
            </div>
          </div>
        </div>
        {!isCollapsed && children.map((c) => renderRow(c, depth + 1))}
      </React.Fragment>
    );
  }

  return <div className="task-table">{topLevel.map((t) => renderRow(t, 0))}</div>;
}
