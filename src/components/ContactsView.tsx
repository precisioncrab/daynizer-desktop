import React, { useMemo, useState } from "react";
import { Contact } from "../types";
import { ContactFilter, LabelColors, ListMembers, matchesFilter, contactLabels, initials, avatarColor } from "../contactUtils";
import { isThunderbirdId } from "../thunderbirdBooks";

interface Props {
  contacts: Contact[];
  filter: ContactFilter;
  /** Add-on: Thunderbird's mailing lists' members, for a list picked in the sidebar. */
  listMembers?: ListMembers;
  labelColors: LabelColors;
  selectedContactId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onFindDuplicates: () => void;
  duplicateCount: number;
  /** Add-on: Thunderbird's book names by id, for the Thunderbird tag. */
  thunderbirdBookNames?: Record<string, string>;
  /** Add-on, with Thunderbird's books shown: Daynizer's own book names by id, for a Daynizer tag. */
  daynizerBookNames?: Record<string, string>;
  /** Add-on: Thunderbird copies add-ons can't change, card id -> the other book that has the same contact ID. */
  locked?: Map<string, string>;
  /** Right-click on a contact (its labels and mailing lists). */
  onContactMenu?: (e: React.MouseEvent, c: Contact) => void;
}

/** First value out of a JSON-text typed-value column ([{type,value}, ...]). */
function firstValue(json: string): string {
  try {
    const a = JSON.parse(json || "[]");
    return Array.isArray(a) && a[0] && a[0].value ? String(a[0].value) : "";
  } catch { return ""; }
}

const avatarBase = {
  width: 30, height: 30, borderRadius: "50%",
  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600,
  flexShrink: 0, marginTop: 1, overflow: "hidden",
  backgroundSize: "cover", backgroundPosition: "center"
} as const;

/** Avatar for a contact: the synced photo if present, else a colored ring +
 *  initials keyed off the contact's name. */
function ContactAvatar({ contact }: { contact: Contact }) {
  const photo =
    contact.photo && (contact.photo.startsWith("data:") || contact.photo.startsWith("http"))
      ? contact.photo
      : "";
  if (photo) {
    return <div style={{ ...avatarBase, backgroundImage: `url("${photo}")` }} aria-label={contact.fn} />;
  }
  return (
    <div style={{ ...avatarBase, background: avatarColor(contact), color: "#1e1f22" }}>
      {initials(contact)}
    </div>
  );
}

export default function ContactsView({ contacts, filter, labelColors, selectedContactId, onSelect, onCreate, onImport, onFindDuplicates, duplicateCount, thunderbirdBookNames = {}, daynizerBookNames, locked, listMembers, onContactMenu }: Props) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    let base = contacts.filter((c) => !c.deleted && matchesFilter(c, filter, listMembers));
    const q = search.trim().toLowerCase();
    if (q) {
      base = base.filter((c) =>
        c.fn.toLowerCase().includes(q) ||
        c.first_name.toLowerCase().includes(q) ||
        c.last_name.toLowerCase().includes(q) ||
        c.nickname.toLowerCase().includes(q) ||
        c.org.toLowerCase().includes(q) ||
        c.emails.toLowerCase().includes(q) ||
        c.phones.toLowerCase().includes(q) ||
        c.categories.toLowerCase().includes(q) ||
        (c.group_labels || "").toLowerCase().includes(q)
      );
    }
    return [...base].sort((a, b) => (a.fn || "").localeCompare(b.fn || ""));
  }, [contacts, filter, search, listMembers]);

  return (
    <>
      <div className="toolbar">
        <h2>Contacts</h2>
        <input
          className="search-box"
          placeholder="Search name, nickname, phone, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {duplicateCount > 0 && (
          <button onClick={onFindDuplicates} title="Review possible duplicate contacts">
            Merge duplicates ({duplicateCount})
          </button>
        )}
        <button onClick={onImport}>Import vCard…</button>
        <button className="primary" onClick={onCreate}>+ New contact</button>
      </div>
      <div className="task-table">
        {visible.length === 0 ? (
          <div className="empty-state">
            {filter.kind === "multi" && (filter.lists ?? []).length && !search.trim()
              ? "No one on these mailing lists yet. Click one list on its own to put contacts on it."
              : "No contacts here yet."}
          </div>
        ) : (
          visible.map((c) => {
            const sub = c.org || firstValue(c.emails) || firstValue(c.phones);
            const labels = contactLabels(c);
            return (
              <div
                key={c.id}
                className={`task-row ${c.id === selectedContactId ? "selected" : ""}`}
                onClick={() => onSelect(c.id)}
                onContextMenu={onContactMenu ? (e) => { e.preventDefault(); onContactMenu(e, c); } : undefined}
              >
                <ContactAvatar contact={c} />
                <div className="title-col">
                  <div className="title">
                    {c.fn || "Unnamed"}
                    {isThunderbirdId(c.id) ? (
                      <span className="contact-source-tag" title="In Thunderbird's address book">
                        Thunderbird{thunderbirdBookNames[c.address_book_id] ? `: ${thunderbirdBookNames[c.address_book_id]}` : ""}
                      </span>
                    ) : daynizerBookNames && (
                      <span className="contact-source-tag" title="In Daynizer's own address book (Daynizer syncs it with your server)">
                        Daynizer{daynizerBookNames[c.address_book_id] ? `: ${daynizerBookNames[c.address_book_id]}` : ""}
                      </span>
                    )}
                    {locked?.has(c.id) && (
                      <span className="contact-source-tag warn" title={`The same contact ID is also in ${locked.get(c.id)}. Thunderbird only lets add-ons change that copy; this one can't be changed here. Sort it out under Clean up > In several books.`}>
                        can't change: also in {locked.get(c.id)}
                      </span>
                    )}
                  </div>
                  {sub && <div className="meta">{sub}</div>}
                  {labels.length > 0 && (
                    <div className="meta" style={{ gap: 5 }}>
                      {labels.slice(0, 5).map((l) => (
                        <span
                          key={l}
                          title={l}
                          style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: labelColors[l] || "#6f7378" }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
