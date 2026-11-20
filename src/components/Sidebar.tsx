import React, { useState, useEffect, useRef } from "react";
import { TaskList, Task } from "../types";
import ContextMenu from "./ContextMenu";
import { TaskScope } from "../views";
import { syncPlace } from "../syncPlace";

import { PALETTE, randomSwatch } from "../palette";

export interface SidebarSmartFilter {
  id: string;
  name: string;
}

interface Props {
  lists: TaskList[];
  tasks: Task[];
  accounts: { id: string; label: string }[];
  /** Which tab the sidebar is driving. Tasks and Calendar keep separate list
   *  selections; the calendar has no Today & Overdue. */
  mode: "tasks" | "calendar";
  /** The current tab's selection: "all", "today" (tasks only) or list ids. */
  selection: TaskScope;
  /** Plain click selects only `id`; Ctrl/Cmd+click (additive) adds/removes it. */
  onSelect: (id: string, additive: boolean) => void;
  onCreateList: (name: string, color?: string) => void;
  onCreateServerList: (name: string, accountId: string, color?: string) => Promise<void>;
  onSetListColor: (id: string, color: string) => void;
  onOpenSettings: () => void;
  onSync: () => void;
  syncing: boolean;
  syncMsg?: string | null;
  forceAdding?: boolean;
  onForceAddingHandled?: () => void;
  onDeleteList: (id: string) => void;
  onRemoveList: (id: string) => void;
  onRenameList: (id: string, name: string) => void;
  onExportList: (id: string) => void;
  /** Right-click, Merge into…: move every task and event into another list, then remove this one. */
  onMergeList: (sourceId: string, targetId: string) => void;
  /** Right-click a local list, Sync to server…: new calendar on that account, linked to this list. */
  onSyncListToServer: (listId: string, accountId: string) => void;
  onSyncList: (accountId: string) => void;
  /** Right-click a server list, Copy to…: copy its items to another account (CopyToModal). */
  onCopyList?: (listId: string) => void;
  /** Lists hidden on this computer (right-click > Hide): left out of the sidebar, tasks and calendar. */
  hiddenLists?: TaskList[];
  onHideList?: (listId: string) => void;
  onShowList?: (listId: string) => void;
  smartFilters?: SidebarSmartFilter[];
  onApplyFilter?: (f: any) => void;
  onDeleteFilter?: (id: string) => void;
  /** Experimental: when collapsed, only a thin "›" re-expand tab renders,
   *  freeing up width for the calendar/task table (mirrors the Today pane's
   *  collapse toggle on the other side of the window). */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export default function Sidebar({
  lists,
  tasks,
  accounts,
  mode,
  selection,
  onSelect,
  onCreateList,
  onCreateServerList,
  onSetListColor,
  onOpenSettings,
  onSync,
  syncing,
  syncMsg,
  forceAdding,
  onForceAddingHandled,
  onDeleteList,
  onRemoveList,
  onRenameList,
  onExportList,
  onMergeList,
  onSyncListToServer,
  onSyncList,
  onCopyList,
  hiddenLists = [],
  onHideList,
  onShowList,
  smartFilters = [],
  onApplyFilter,
  onDeleteFilter,
  collapsed,
  onToggleCollapsed
}: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [newColor, setNewColor] = useState(randomSwatch()); // color for the list being created
  const [listTarget, setListTarget] = useState("local"); // "local" or accountId
  const [listMenu, setListMenu] = useState<{ x: number; y: number; list: TaskList } | null>(null);
  const [hiddenMenu, setHiddenMenu] = useState<{ x: number; y: number } | null>(null);
  // Inline rename: the list whose name is being edited, plus the working text.
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Set when the user presses Escape, so the input's onBlur (which fires as the
  // field unmounts) cancels instead of saving. Without this, Esc "cancel" was
  // immediately overridden by blur-saves.
  const renameCancelRef = useRef(false);
  function submitRename(l: TaskList) {
    if (renameCancelRef.current) {
      renameCancelRef.current = false;
      setEditingListId(null);
      setEditName("");
      return;
    }
    const n = editName.trim();
    if (n && n !== l.name) onRenameList(l.id, n);
    setEditingListId(null);
    setEditName("");
  }

  /** Open the "new list" form, defaulting its destination to the first CalDAV
   *  account so new lists sync by default -- "Local only" stays a deliberate
   *  choice in the dropdown rather than the silent default. */
  function openAddList() {
    setListTarget(accounts.length > 0 ? accounts[0].id : "local");
    setName("");
    setNewColor(randomSwatch());
    setAdding(true);
  }

  useEffect(() => {
    if (forceAdding) {
      openAddList();
      onForceAddingHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceAdding]);

  // Must come after all hooks above (Rules of Hooks) -- an early return
  // before a hook call crashes the component the moment `collapsed` flips.
  if (collapsed) {
    return (
      <div className="sidebar sidebar-collapsed">
        <button className="rail-toggle" onClick={onToggleCollapsed} title="Show Calendar/List">›</button>
      </div>
    );
  }

  const isSelected = (id: string) => (Array.isArray(selection) ? selection.includes(id) : selection === id);
  const additive = (e: React.MouseEvent) => e.ctrlKey || e.metaKey;
  const showsOnly = (id: string) => Array.isArray(selection) && selection.length === 1 && selection[0] === id;

  const openCount = (listId: string) => tasks.filter((t) => t.list_id === listId && !t.completed && !t.parent_id).length;
  const todayCount = tasks.filter((t) => {
    if (t.completed || !t.due_date) return false;
    const due = new Date(t.due_date);
    const now = new Date();
    return due.toDateString() === now.toDateString() || due < now;
  }).length;

  async function submitNewList() {
    const trimmed = name.trim();
    const target = listTarget;
    // Close and clear the form IMMEDIATELY -- creating a server list awaits a
    // round-trip + sync (seconds), and leaving the form open + filled let an
    // impatient second click create a duplicate calendar. Reset first, then work.
    const color = newColor;
    setName("");
    setListTarget("local");
    setAdding(false);
    if (trimmed) {
      if (target !== "local") {
        await onCreateServerList(trimmed, target, color);
      } else {
        onCreateList(trimmed, color);
      }
    }
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>Calendar/List</span>
        <button className="today-pane-collapse-btn" onClick={onToggleCollapsed} title="Hide panel">‹</button>
      </div>
      <div className="sidebar-list">
        {mode === "tasks" && (
          <div className={`sidebar-item ${isSelected("today") ? "active" : ""}`} onClick={() => onSelect("today", false)}>
            <span className="sidebar-dot" style={{ background: "#e8a23d" }} />
            <span>Today &amp; Overdue</span>
            {todayCount > 0 && <span className="count">{todayCount}</span>}
          </div>
        )}
        <div className={`sidebar-item ${isSelected("all") ? "active" : ""}`} onClick={() => onSelect("all", false)}>
          <span className="sidebar-dot" style={{ background: "#888" }} />
          <span>{mode === "calendar" ? "All lists" : "All Tasks"}</span>
        </div>
        {smartFilters.length > 0 && (
          <>
            <div style={{ height: 8 }} />
            <div className="sidebar-section-label">Saved views</div>
            {smartFilters.map((f) => (
              <div key={f.id} className="sidebar-item smart-filter" onClick={() => onApplyFilter?.(f)} title="Apply this saved view">
                <span className="sidebar-dot" style={{ background: "#7c6fd0" }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</span>
                <button
                  className="smart-filter-delete"
                  title="Delete view"
                  onClick={(e) => { e.stopPropagation(); onDeleteFilter?.(f.id); }}
                >×</button>
              </div>
            ))}
          </>
        )}
        <div style={{ height: 8 }} />
        {lists.map((l) => (
          editingListId === l.id ? (
            <div key={l.id} className="sidebar-item" style={{ "--accent": l.color } as any}>
              <span className="sidebar-dot" style={{ background: l.color }} />
              <input
                autoFocus
                style={{ flex: 1, minWidth: 0, background: "var(--bg-field)", border: "1px solid var(--border-strong)", borderRadius: 6, color: "var(--text-strong)", padding: "2px 6px" }}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitRename(l);
                  if (e.key === "Escape") { renameCancelRef.current = true; setEditingListId(null); setEditName(""); }
                }}
                onBlur={() => submitRename(l)}
              />
            </div>
          ) : (
            <div
              key={l.id}
              className={`sidebar-item ${isSelected(l.id) ? "active" : ""}`}
              style={{ "--accent": l.color } as any}
              title="Click to show this list. Ctrl+click to add it to the selection."
              onClick={(e) => onSelect(l.id, additive(e))}
              onContextMenu={(e) => {
                e.preventDefault();
                setListMenu({ x: e.clientX, y: e.clientY, list: l });
              }}
            >
              <span className="sidebar-dot" style={{ background: l.color }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {l.name}{l.caldav_calendar_url ? " ⇄" : ""}
              </span>
              {openCount(l.id) > 0 && <span className="count">{openCount(l.id)}</span>}
            </div>
          )
        ))}
        {hiddenLists.length > 0 && (
          <div
            className="sidebar-hidden-note"
            role="button"
            tabIndex={0}
            title="Show a hidden list again"
            onClick={(e) => setHiddenMenu({ x: e.clientX, y: e.clientY })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setHiddenMenu({ x: r.left, y: r.bottom });
              }
            }}
          >{hiddenLists.length} hidden</div>
        )}
        {adding ? (
          <div style={{ padding: "6px 14px" }}>
            <input
              autoFocus
              style={{ width: "100%", background: "var(--bg-field)", border: "1px solid var(--border-strong)", borderRadius: 6, color: "var(--text-strong)", padding: "4px 6px" }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNewList();
                if (e.key === "Escape") { setAdding(false); setName(""); setListTarget("local"); }
              }}
              onBlur={accounts.length === 0 ? submitNewList : undefined}
            />
            <div style={{ display: "flex", gap: 5, marginTop: 6, alignItems: "center" }}>
              {PALETTE.map((p) => (
                <button
                  key={p.color}
                  type="button"
                  title={p.name}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setNewColor(p.color)}
                  style={{
                    width: 16, height: 16, borderRadius: "50%", background: p.color, cursor: "pointer", padding: 0,
                    border: newColor === p.color ? "2px solid var(--text-strong)" : "2px solid transparent"
                  }}
                />
              ))}
            </div>
            {accounts.length > 0 && (
              <div style={{ display: "flex", gap: 4, marginTop: 4, alignItems: "center" }}>
                <select
                  style={{ flex: 1, background: "var(--bg-field)", border: "1px solid var(--border-strong)", borderRadius: 4, color: "var(--text-strong)", fontSize: 11, padding: "2px 4px" }}
                  value={listTarget}
                  onChange={(e) => setListTarget(e.target.value)}
                >
                  <option value="local">Local only</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>On server: {a.label}</option>
                  ))}
                </select>
                <button style={{ fontSize: 11, padding: "2px 8px" }} onClick={submitNewList}>Create</button>
              </div>
            )}
          </div>
        ) : (
          <button className="sidebar-add" onClick={openAddList}>+ New list/calendar</button>
        )}
      </div>
      <div className="sidebar-footer">
        <button onClick={onSync} disabled={syncing}>{syncing ? "Syncing…" : "Sync now (Ctrl+R)"}</button>
        {syncMsg && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>{syncMsg}</div>}
        <div style={{ height: 6 }} />
        <button onClick={onOpenSettings}>CalDAV accounts…</button>
      </div>

      {listMenu && (
        <ContextMenu
          x={listMenu.x}
          y={listMenu.y}
          onClose={() => setListMenu(null)}
          items={[
            {
              info: syncPlace(listMenu.list.caldav_account_id, listMenu.list.caldav_calendar_url, accounts),
              title: listMenu.list.caldav_calendar_url ?? undefined
            },
            { separator: true as const },
            ...(listMenu.list.caldav_account_id
              ? [{ label: "Sync now", onClick: () => onSyncList(listMenu.list.caldav_account_id!) }]
              : []),
            // Acts on the tab you're on (Tasks or Calendar).
            showsOnly(listMenu.list.id)
              ? { label: "Show all lists", onClick: () => onSelect("all", false) }
              : { label: `Show only "${listMenu.list.name}"`, onClick: () => onSelect(listMenu.list.id, false) },
            {
              label: "Rename",
              onClick: () => { setEditingListId(listMenu.list.id); setEditName(listMenu.list.name); }
            },
            { colors: PALETTE, current: listMenu.list.color, onPick: (color: string) => onSetListColor(listMenu.list.id, color) },
            ...(lists.length > 1
              ? [{
                  label: "Merge into…",
                  submenu: lists
                    .filter((l) => l.id !== listMenu.list.id)
                    .map((l) => ({
                      label: l.caldav_account_id ? l.name : `${l.name} (local)`,
                      onClick: () => {
                        const src = listMenu.list;
                        const msg = src.caldav_account_id
                          ? `Move every task and event from "${src.name}" into "${l.name}", then delete "${src.name}" here and its calendar on the server?`
                          : `Move every task and event from "${src.name}" into "${l.name}", then delete "${src.name}"?`;
                        if (confirm(msg)) onMergeList(src.id, l.id);
                      }
                    }))
                }]
              : []),
            // Sync to server…: only for a local list, and only with a CalDAV account.
            ...(!listMenu.list.caldav_account_id && accounts.length === 1
              ? [{ label: `Sync to ${accounts[0].label}`, onClick: () => onSyncListToServer(listMenu.list.id, accounts[0].id) }]
              : []),
            ...(!listMenu.list.caldav_account_id && accounts.length > 1
              ? [{
                  label: "Sync to server…",
                  submenu: accounts.map((a) => ({ label: a.label, onClick: () => onSyncListToServer(listMenu.list.id, a.id) }))
                }]
              : []),
            // Copy to…: only a list on a server has raw items to copy.
            ...(listMenu.list.caldav_account_id && onCopyList
              ? [{ label: "Copy to…", onClick: () => onCopyList(listMenu.list.id) }]
              : []),
            ...(onHideList
              ? [{ label: "Hide", onClick: () => onHideList(listMenu.list.id) }]
              : []),
            {
              label: "Export to .ics…",
              onClick: () => onExportList(listMenu.list.id)
            },
            // Unlink: only meaningful for a linked list -- makes it local-only,
            // keeping both the local and server copies but stopping sync.
            ...(listMenu.list.caldav_account_id
              ? [{
                  label: "Unlink",
                  danger: true,
                  onClick: () => {
                    if (confirm(`Unlink "${listMenu.list.name}"? It becomes a local-only list. Its tasks stay here and on the server, but they stop syncing.`)) {
                      onRemoveList(listMenu.list.id);
                    }
                  }
                }]
              : []),
            // Delete: removes the list + its tasks here, and on the server too
            // when it's linked (App.tsx handles the server collection DELETE and
            // warns if the server refuses it).
            {
              label: "Delete",
              danger: true,
              onClick: () => {
                const msg = listMenu.list.caldav_account_id
                  ? `Delete "${listMenu.list.name}"? This removes the list and its tasks from Daynizer and from the server. This can't be undone.`
                  : `Delete "${listMenu.list.name}"? This removes the list and its tasks from Daynizer. This can't be undone.`;
                if (confirm(msg)) {
                  onDeleteList(listMenu.list.id);
                }
              }
            }
          ]}
        />
      )}
      {hiddenMenu && (
        <ContextMenu
          x={hiddenMenu.x}
          y={hiddenMenu.y}
          onClose={() => setHiddenMenu(null)}
          items={[
            { info: "Hidden on this computer" },
            { separator: true as const },
            ...hiddenLists.map((l) => ({ label: `Show "${l.name}"`, onClick: () => onShowList?.(l.id) }))
          ]}
        />
      )}
    </div>
  );
}
