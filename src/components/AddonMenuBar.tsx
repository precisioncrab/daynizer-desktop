import { useEffect, useRef, useState } from "react";

interface MenuItem {
  label: string;
  hint?: string;
  onClick: () => void;
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
  syncing: boolean;
}

/** File / Edit / View / Account / Sync menu bar for the Thunderbird add-on,
 *  which has no native application menu (that was Electron-only). Every item
 *  calls a function already living in App.tsx, mirroring electron/main.ts's
 *  buildMenu(). Rendered only in the add-on (see isAddon in App.tsx). */
export default function AddonMenuBar(props: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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
        { label: "Settings…", hint: "Ctrl+,", onClick: props.onSettings }
      ]
    },
    {
      title: "View",
      items: [
        { label: "Tasks", onClick: () => props.onSetView("tasks") },
        { label: "Calendar", onClick: () => props.onSetView("calendar") },
        { label: "Contacts", onClick: () => props.onSetView("contacts") },
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
            <div className="menu-dropdown">
              {menu.items.map((item) => (
                <div
                  key={item.label}
                  className="menu-dropdown-item"
                  onClick={() => { item.onClick(); setOpen(null); }}
                >
                  <span>{item.label}</span>
                  {item.hint && <span className="menu-hint">{item.hint}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
