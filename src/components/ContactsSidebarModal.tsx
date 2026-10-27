import { useEffect } from "react";

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
  onClose: () => void;
}

/** View > Contacts Sidebar…: tick a part to show it in the Contacts tab's left
 *  pane, untick to hide it. Hiding only takes it off the pane: no contact,
 *  setting or server changes, and ticking it again brings it back as it was.
 *  The contact list itself always shows. */
export default function ContactsSidebarModal({ hidden, onSetShown, chatList, omemoLink, thunderbird, onClose }: Props) {
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
