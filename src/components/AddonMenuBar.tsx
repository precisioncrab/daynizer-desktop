import { useEffect, useRef, useState } from "react";
import { SavedView } from "../views";

interface MenuItem {
  label: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Opens to the side on hover (View > Saved Views). */
  submenu?: MenuItem[];
  separator?: boolean;
}
interface Menu {
  title: string;
  items: MenuItem[];
}

interface Props {
  onNewTask: () => void;
  onNewList: () => void;
  onUndo: () => void;
  onSettings: () => void;
  onSearch: () => void;
  onAbout: () => void;
  onSync: () => void;
  onSetView: (v: "tasks" | "calendar" | "contacts") => void;
  onFilters: () => void;
  savedViews: SavedView[];
  onApplyView: (v: SavedView) => void;
  onSaveView: () => void;
  syncing: boolean;
}

/** File / Edit / View / Account / Sync menu bar for the Thunderbird add-on,
 *  which has no native application menu (that was Electron-only). Every item
 *  calls a function already living in App.tsx, mirroring electron/main.ts's
 *  buildMenu(). Rendered only in the add-on (see isAddon in App.tsx). */
export default function AddonMenuBar(props: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  useEffect(() => { setOpenSub(null); }, [open]);

  const savedViewItems: MenuItem[] = [
    { label: "Save Current View…", onClick: props.onSaveView },
    { label: "", separator: true },
    ...(props.savedViews.length
      ? props.savedViews.map((v) => ({ label: v.name, onClick: () => props.onApplyView(v) }))
      : [{ label: "No saved views yet", disabled: true }])
  ];

  const menus: Menu[] = [
    {
      title: "File",
      items: [
        { label: "New Task", hint: "Ctrl+N", onClick: props.onNewTask },
        { label: "New List", hint: "Ctrl+Shift+N", onClick: props.onNewList }
      ]
    },
    {
      title: "Edit",
      items: [
        { label: "Undo", hint: "Ctrl+Z", onClick: props.onUndo },
        { label: "Cut", hint: "Ctrl+X", onClick: () => { try { document.execCommand("cut"); } catch { /* ignore */ } } },
        { label: "Copy", hint: "Ctrl+C", onClick: () => { try { document.execCommand("copy"); } catch { /* ignore */ } } },
        { label: "Paste", hint: "Ctrl+V", onClick: () => { try { document.execCommand("paste"); } catch { /* ignore */ } } },
        { label: "Select All", hint: "Ctrl+A", onClick: () => { try { document.execCommand("selectAll"); } catch { /* ignore */ } } },
        { label: "Settings…", hint: "Ctrl+,", onClick: props.onSettings }
      ]
    },
    {
      title: "View",
      items: [
        { label: "Tasks", onClick: () => props.onSetView("tasks") },
        { label: "Calendar", onClick: () => props.onSetView("calendar") },
        { label: "Contacts", onClick: () => props.onSetView("contacts") },
        { label: "", separator: true },
        { label: "Filters…", onClick: props.onFilters },
        { label: "Saved Views", submenu: savedViewItems },
        { label: "", separator: true },
        { label: "Find / Search", hint: "Ctrl+F", onClick: props.onSearch },
        { label: "About", onClick: props.onAbout }
      ]
    },
    {
      title: "Account",
      items: [{ label: "CalDAV / CardDAV Accounts…", onClick: props.onSettings }]
    },
    {
      title: "Sync",
      items: [{ label: props.syncing ? "Syncing…" : "Sync Now", hint: "Ctrl+R", onClick: props.onSync }]
    }
  ];

  function renderItems(items: MenuItem[], keyPrefix: string, nested = false) {
    return items.map((item, i) => {
      const key = `${keyPrefix}-${i}`;
      if (item.separator) return <div key={key} className="menu-separator" />;
      if (item.submenu) {
        return (
          <div
            key={key}
            className="menu-dropdown-item has-submenu"
            onMouseEnter={() => setOpenSub(item.label)}
            onClick={() => setOpenSub(openSub === item.label ? null : item.label)}
          >
            <span>{item.label}</span>
            <span className="menu-hint">▸</span>
            {openSub === item.label && (
              <div className="menu-dropdown menu-submenu" onClick={(e) => e.stopPropagation()}>
                {renderItems(item.submenu, key, true)}
              </div>
            )}
          </div>
        );
      }
      return (
        <div
          key={key}
          className={`menu-dropdown-item ${item.disabled ? "disabled" : ""}`}
          onMouseEnter={nested ? undefined : () => setOpenSub(null)}
          onClick={() => { if (item.disabled) return; item.onClick?.(); setOpen(null); }}
        >
          <span>{item.label}</span>
          {item.hint && <span className="menu-hint">{item.hint}</span>}
        </div>
      );
    });
  }

  return (
    <div className="menu-bar" ref={barRef}>
      {menus.map((menu) => (
        <div className="menu-bar-item" key={menu.title}>
          <button
            className={`menu-bar-title ${open === menu.title ? "active" : ""}`}
            onClick={() => setOpen(open === menu.title ? null : menu.title)}
            onMouseEnter={() => { if (open) setOpen(menu.title); }}
          >
            {menu.title}
          </button>
          {open === menu.title && (
            <div className="menu-dropdown">{renderItems(menu.items, menu.title)}</div>
          )}
        </div>
      ))}
    </div>
  );
}
