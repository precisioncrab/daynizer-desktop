import { useEffect } from "react";
import type { HiddenItems } from "../contactsHidden";

/** A part of the Contacts tab's left pane that can be hidden (View > Contacts Sidebar…). */
export type SidebarPart =
  | "books" | "tbbooks" | "labels"
  | "cleanup.duplicates" | "cleanup.copies" | "cleanup.phones" | "cleanup.names" | "cleanup.labels"
  | "chat" | "chat.chat" | "chat.list" | "chat.omemo"
  | "more";

const KEY = "contactsSidebarHidden";

/** The parts hidden, remembered on this computer like the filter choices. */
export function loadSidebarHidden(): SidebarPart[] {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}
export function storeSidebarHidden(hidden: SidebarPart[]) {
  try { localStorage.setItem(KEY, JSON.stringify(hidden)); } catch { /* not remembered */ }
}

interface Props {
  hidden: SidebarPart[];
  onSetShown: (part: SidebarPart, shown: boolean) => void;
  /** The Chat list tab is an option only in the add-on, with OMEMO for Thunderbird installed. */
  chatList: boolean;
  /** The OMEMO link is an option only where Daynizer shows one (the add-on). */
  omemoLink: string | null;
  /** Thunderbird's address books are an option only in the add-on, with them switched on in Settings. */
  thunderbird: boolean;
  /** Each address book and label, to hide one at a time (src/contactsHidden.ts). */
  books: { id: string; name: string; count: number }[];
  thunderbirdBooks: { id: string; name: string; count: number }[];
  labels: string[];
  hiddenItems: HiddenItems;
  onSetItemShown: (kind: "books" | "labels", id: string, shown: boolean) => void;
  onClose: () => void;
}

/** View > Contacts Sidebar…: tick a part to show it in the Contacts tab's left
 *  pane, untick to hide it. Hiding only takes it off the pane: no contact,
 *  setting or server changes, and ticking it again brings it back as it was.
 *  The contact list itself always shows. Below that, each address book and
 *  label: an unticked address book is hidden with its contacts. */
export default function ContactsSidebarModal({
  hidden, onSetShown, chatList, omemoLink, thunderbird, books, thunderbirdBooks, labels, hiddenItems, onSetItemShown, onClose
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chatOff = hidden.includes("chat");
  const row = (part: SidebarPart, name: string, disabled = false, indent = false) => (
    <div className="filters-row" key={part} style={indent ? { paddingLeft: 22 } : undefined}>
      <label className="filters-show" style={disabled ? { opacity: 0.5 } : undefined}>
        <input
          type="checkbox"
          checked={!hidden.includes(part)}
          disabled={disabled}
          onChange={(e) => onSetShown(part, e.target.checked)}
        />
        {name}
      </label>
    </div>
  );

  const item = (kind: "books" | "labels", id: string, name: string, count?: number) => (
    <div className="filters-row" key={`${kind}:${id}`}>
      <label className="filters-show">
        <input type="checkbox" checked={!hiddenItems[kind].includes(id)} onChange={(e) => onSetItemShown(kind, id, e.target.checked)} />
        {name}
        {count !== undefined && <span style={{ color: "var(--text-faint)", fontSize: 12 }}>({count})</span>}
      </label>
    </div>
  );

  return (
    <div className="overlay" onClick={onClose}>
      <div className="settings-modal filters-modal" style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>Contacts Sidebar</h2>
        <p className="filters-hint">
          Ticked parts show in the Contacts tab's left pane. Unticking one only hides it: nothing changes in your
          contacts, your settings or on the server, and ticking it again brings it back as it was. The contact list
          always shows.
        </p>
        <section>
          <h3>Contacts</h3>
          {row("books", thunderbird ? "Daynizer address books" : "Address books")}
          {thunderbird && row("tbbooks", "Thunderbird address books")}
          {row("labels", "Labels")}
        </section>
        <section>
          <h3>Address books and labels, one at a time</h3>
          <p className="filters-hint">
            An unticked address book is hidden with its contacts: they leave the contact list, the labels and the clean-up
            pages (birthdays still show). An unticked label only comes off the pane. Right-click one in the pane to hide it too.
          </p>
          {books.length > 0 && <h4 style={{ margin: "8px 0 2px", fontSize: 12, color: "var(--text-muted)" }}>{thunderbird ? "Daynizer address books" : "Address books"}</h4>}
          {books.map((b) => item("books", b.id, b.name, b.count))}
          {thunderbirdBooks.length > 0 && <h4 style={{ margin: "8px 0 2px", fontSize: 12, color: "var(--text-muted)" }}>Thunderbird address books</h4>}
          {thunderbirdBooks.map((b) => item("books", b.id, b.name, b.count))}
          {labels.length > 0 && <h4 style={{ margin: "8px 0 2px", fontSize: 12, color: "var(--text-muted)" }}>Labels</h4>}
          {labels.map((l) => item("labels", l, l))}
        </section>
        <section>
          <h3>Clean up</h3>
          {row("cleanup.duplicates", "Duplicates")}
          {row("cleanup.copies", "In several books")}
          {row("cleanup.phones", "Phone numbers")}
          {row("cleanup.names", "Missing names")}
          {row("cleanup.labels", "Lists to labels")}
        </section>
        <section>
          <h3>Chat</h3>
          {row("chat", "Chat (all of it, for people who don't use XMPP)")}
          {row("chat.chat", "Chat addresses", chatOff, true)}
          {chatList && row("chat.list", "Chat list (the tab on Chat addresses)", chatOff, true)}
          {omemoLink && row("chat.omemo", omemoLink, chatOff, true)}
        </section>
        <section>
          <h3>More</h3>
          {row("more", "More (Changes)")}
        </section>
      </div>
    </div>
  );
}
