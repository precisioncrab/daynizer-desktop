import { useState, useRef } from "react";
import { Contact, AddressBook } from "../types";
import ContextMenu from "./ContextMenu";
import { ContactFilter, LabelColors, contactLabels } from "../contactUtils";

const PALETTE: { name: string; color: string }[] = [
  { name: "Blue", color: "#4a90d9" },
  { name: "Red", color: "#e5484d" },
  { name: "Amber", color: "#e8a23d" },
  { name: "Green", color: "#3fb950" },
  { name: "Purple", color: "#a371f7" },
  { name: "Pink", color: "#db61a2" },
  { name: "Gray", color: "#6f7378" }
];
const randomSwatch = () => PALETTE[Math.floor(Math.random() * PALETTE.length)].color;

/** One clean-up page in the sidebar (Contacts Cleanup's pages, src/cleanup/). */
export interface CleanupItem { id: string; title: string; dot: string; count: number | null }

/** The clean-up part of the sidebar: Clean up, Chat and More, with the page open (null: the contact list). */
export interface CleanupNav {
  view: string | null;
  cleanup: CleanupItem[];
  chat: CleanupItem[];
  more: CleanupItem[];
  onOpen: (view: string) => void;
  /** Under Chat, in the Thunderbird add-on only: getting OMEMO for Thunderbird, or its settings. */
  omemoLink: { text: string; title: string; icon: string; onClick: () => void } | null;
}

// Categories folded away, remembered on this computer.
const FOLDED_KEY = "contactsSidebarFolded";
function readFolded(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FOLDED_KEY) || "[]")); } catch { return new Set(); }
}

interface Props {
  addressBooks: AddressBook[];
  contacts: Contact[];
  accounts: { id: string; label: string }[];
  filter: ContactFilter;
  onSelect: (f: ContactFilter) => void;
  onCreateBook: (name: string, color?: string) => void;
  onCreateServerBook: (name: string, accountId: string, color?: string) => Promise<void>;
  onSetBookColor: (id: string, color: string) => void;
  onRenameBook: (id: string, name: string) => void;
  labelColors: LabelColors;
  onSetLabelColor: (label: string, color: string | null) => void;
  onDeleteLabel: (label: string) => void;
  onDisconnectBook: (b: AddressBook) => void;
  onDeleteBook: (b: AddressBook) => void;
  onSync: () => void;
  syncing: boolean;
  onOpenSettings: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  nav: CleanupNav;
}

export default function ContactsSidebar({
  addressBooks, contacts, accounts, filter, onSelect, onCreateBook, onCreateServerBook, onSetBookColor, onRenameBook, labelColors, onSetLabelColor, onDeleteLabel,
  onDisconnectBook, onDeleteBook, onSync, syncing, onOpenSettings, collapsed, onToggleCollapsed, nav
}: Props) {
  const [folded, setFolded] = useState(readFolded);
  function toggleFold(id: string) {
    const next = new Set(folded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFolded(next);
    try { localStorage.setItem(FOLDED_KEY, JSON.stringify([...next])); } catch { /* not remembered */ }
  }
  /** A category heading that folds its items away (click the name). */
  const heading = (id: string, title: string) => (
    <div
      className="sidebar-section-label sidebar-toggle"
      role="button"
      tabIndex={0}
      aria-expanded={!folded.has(id)}
      title={folded.has(id) ? `Show ${title}` : `Fold ${title} away`}
      onClick={() => toggleFold(id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFold(id); } }}
    >
      <span className="chevron" aria-hidden="true">{folded.has(id) ? "▸" : "▾"}</span>
      {title}
    </div>
  );
  const pageItem = (item: CleanupItem) => (
    <div
      key={item.id}
      className={`sidebar-item ${nav.view === item.id ? "active" : ""}`}
      onClick={() => nav.onOpen(item.id)}
    >
      <span className="sidebar-dot" style={{ background: item.dot }} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</span>
      {item.count ? <span className="count has">{item.count}</span> : null}
    </div>
  );
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [newColor, setNewColor] = useState(randomSwatch()); // color for the book being created
  const [bookTarget, setBookTarget] = useState("local"); // "local" or accountId
  const [labelMenu, setLabelMenu] = useState<{ x: number; y: number; label: string } | null>(null);
  const [bookMenu, setBookMenu] = useState<{ x: number; y: number; book: AddressBook } | null>(null);
  // Inline rename of an address book, mirroring the Calendar/List sidebar.
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const renameCancelRef = useRef(false);
  function submitRename(b: AddressBook) {
    if (renameCancelRef.current) { renameCancelRef.current = false; setEditingBookId(null); setEditName(""); return; }
    const n = editName.trim();
    if (n && n !== b.name) onRenameBook(b.id, n);
    setEditingBookId(null); setEditName("");
  }

  /** Open the "new address book" form, defaulting its destination to the first
   *  account so new books sync by default -- "Local only" stays a deliberate
   *  choice in the dropdown, mirroring the Calendar/List sidebar. */
  function openAddBook() {
    setBookTarget(accounts.length > 0 ? accounts[0].id : "local");
    setName("");
    setNewColor(randomSwatch());
    setAdding(true);
  }

  if (collapsed) {
    return (
      <div className="sidebar sidebar-collapsed">
        <button className="rail-toggle" onClick={onToggleCollapsed} title="Show Contacts">›</button>
      </div>
    );
  }

  // A filter is active only while the contact list shows (not a clean-up page).
  const active = (f: ContactFilter) => nav.view === null && JSON.stringify(f) === JSON.stringify(filter);
  const live = contacts.filter((c) => !c.deleted);
  const bookCount = (id: string) => live.filter((c) => c.address_book_id === id).length;
  const labels = (() => {
    const set = new Set<string>();
    for (const c of live) for (const l of contactLabels(c)) set.add(l);
    return [...set].sort((a, b) => a.localeCompare(b));
  })();

  async function submitNewBook() {
    const trimmed = name.trim();
    const target = bookTarget;
    // Close + clear immediately (creating a server book awaits a round-trip);
    // reset first, then work -- mirrors the Calendar/List sidebar.
    const color = newColor;
    setName(""); setBookTarget("local"); setAdding(false);
    if (trimmed) {
      if (target !== "local") await onCreateServerBook(trimmed, target, color);
      else onCreateBook(trimmed, color);
    }
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>Contacts</span>
        <button className="today-pane-collapse-btn" onClick={onToggleCollapsed} title="Hide panel">‹</button>
      </div>
      <div className="sidebar-list">
        <div className={`sidebar-item ${active({ kind: "all" }) ? "active" : ""}`} onClick={() => onSelect({ kind: "all" })}>
          <span className="sidebar-dot" style={{ background: "#888" }} />
          <span style={{ flex: 1 }}>All contacts</span>
          {live.length > 0 && <span className="count">{live.length}</span>}
        </div>

        <div style={{ height: 8 }} />
        {heading("books", "Address books")}
        {!folded.has("books") && (<>
        {addressBooks.map((b) => (
          editingBookId === b.id ? (
            <div key={b.id} className="sidebar-item" style={{ "--accent": b.color } as any}>
              <span className="sidebar-dot" style={{ background: b.color }} />
              <input
                autoFocus
                style={{ flex: 1, minWidth: 0, background: "var(--bg-field)", border: "1px solid var(--border-strong)", borderRadius: 6, color: "var(--text-strong)", padding: "2px 6px" }}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitRename(b);
                  if (e.key === "Escape") { renameCancelRef.current = true; setEditingBookId(null); setEditName(""); }
                }}
                onBlur={() => submitRename(b)}
              />
            </div>
          ) : (
            <div
              key={b.id}
              className={`sidebar-item ${active({ kind: "book", value: b.id }) ? "active" : ""}`}
              style={{ "--accent": b.color } as any}
              onClick={() => onSelect({ kind: "book", value: b.id })}
              onContextMenu={(e) => { e.preventDefault(); setBookMenu({ x: e.clientX, y: e.clientY, book: b }); }}
              title={b.carddav_addressbook_url ? "Right-click to rename, disconnect or delete" : "Right-click to rename or delete"}
            >
              <span className="sidebar-dot" style={{ background: b.color }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {b.name}{b.carddav_addressbook_url ? " ⇄" : ""}
              </span>
              {bookCount(b.id) > 0 && <span className="count">{bookCount(b.id)}</span>}
            </div>
          )
        ))}
        {adding ? (
          <div style={{ padding: "6px 14px" }}>
            <input
              autoFocus
              style={{ width: "100%", background: "var(--bg-field)", border: "1px solid var(--border-strong)", borderRadius: 6, color: "var(--text-strong)", padding: "4px 6px" }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitNewBook(); if (e.key === "Escape") { setAdding(false); setName(""); setBookTarget("local"); } }}
              onBlur={accounts.length === 0 ? submitNewBook : undefined}
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
                  value={bookTarget}
                  onChange={(e) => setBookTarget(e.target.value)}
                >
                  <option value="local">Local only</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>On server: {a.label}</option>
                  ))}
                </select>
                <button style={{ fontSize: 11, padding: "2px 8px" }} onClick={submitNewBook}>Create</button>
              </div>
            )}
          </div>
        ) : (
          <button className="sidebar-add" onClick={openAddBook}>+ New address book</button>
        )}
        </>)}

        {labels.length > 0 && (
          <>
            <div style={{ height: 8 }} />
            {heading("labels", "Labels")}
            {!folded.has("labels") && labels.map((l) => (
              <div
                key={l}
                className={`sidebar-item ${active({ kind: "label", value: l }) ? "active" : ""}`}
                onClick={() => onSelect({ kind: "label", value: l })}
                onContextMenu={(e) => { e.preventDefault(); setLabelMenu({ x: e.clientX, y: e.clientY, label: l }); }}
                title="Right-click to set a color"
              >
                <span className="sidebar-dot" style={{ background: labelColors[l] || "#6f7378" }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{l}</span>
              </div>
            ))}
          </>
        )}

        {nav.cleanup.length > 0 && (<>
          <div style={{ height: 8 }} />
          {heading("cleanup", "Clean up")}
          {!folded.has("cleanup") && nav.cleanup.map(pageItem)}
        </>)}
        {(nav.chat.length > 0 || nav.omemoLink) && (<>
          <div style={{ height: 8 }} />
          {heading("chat", "Chat")}
          {!folded.has("chat") && (<>
            {nav.chat.map(pageItem)}
            {nav.omemoLink && (
              <div
                className="sidebar-item sidebar-link"
                role="button"
                tabIndex={0}
                title={nav.omemoLink.title}
                onClick={nav.omemoLink.onClick}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); nav.omemoLink!.onClick(); } }}
              >
                <span className="sidebar-icon" aria-hidden="true">{nav.omemoLink.icon}</span>
                <span className="name">{nav.omemoLink.text}</span>
              </div>
            )}
          </>)}
        </>)}
        {nav.more.length > 0 && (<>
          <div style={{ height: 8 }} />
          {heading("more", "More")}
          {!folded.has("more") && nav.more.map(pageItem)}
        </>)}
      </div>
      <div className="sidebar-footer">
        <button onClick={onSync} disabled={syncing}>{syncing ? "Syncing…" : "Sync now (Ctrl+R)"}</button>
        <div style={{ height: 6 }} />
        <button onClick={onOpenSettings}>CardDAV accounts…</button>
      </div>

      {labelMenu && (
        <ContextMenu
          x={labelMenu.x}
          y={labelMenu.y}
          onClose={() => setLabelMenu(null)}
          items={[
            ...PALETTE.map((p) => ({ label: `● ${p.name}`, onClick: () => onSetLabelColor(labelMenu.label, p.color) })),
            { label: "No color", onClick: () => onSetLabelColor(labelMenu.label, null) },
            { label: "Delete label", danger: true, onClick: () => onDeleteLabel(labelMenu.label) }
          ]}
        />
      )}

      {bookMenu && (
        <ContextMenu
          x={bookMenu.x}
          y={bookMenu.y}
          onClose={() => setBookMenu(null)}
          items={[
            { label: "Rename", onClick: () => { setEditingBookId(bookMenu.book.id); setEditName(bookMenu.book.name); } },
            ...PALETTE.map((p) => ({ label: `● ${p.name}`, onClick: () => onSetBookColor(bookMenu.book.id, p.color) })),
            ...(bookMenu.book.carddav_addressbook_url
              ? [{ label: "Disconnect from CardDAV", onClick: () => onDisconnectBook(bookMenu.book) }]
              : []),
            { label: "Delete address book", danger: true, onClick: () => onDeleteBook(bookMenu.book) }
          ]}
        />
      )}
    </div>
  );
}
