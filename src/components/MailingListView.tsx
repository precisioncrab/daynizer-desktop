import React, { useMemo, useState } from "react";
import { Contact } from "../types";
import { initials, avatarColor } from "../contactUtils";

interface Props {
  /** One of Thunderbird's mailing lists; parentId is its book ("tb:<book>"). */
  list: { id: string; name: string; parentId: string };
  bookName: string;
  /** The contacts shown in the Contacts tab (the list's book's are picked out here). */
  contacts: Contact[];
  /** Contact ids on the list ("tb:<book>»<UID>"). */
  members: Set<string>;
  /** Copies add-ons can't change, card id -> the other book with the same contact ID. */
  locked?: Map<string, string>;
  selectedContactId: string | null;
  onSelect: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent, c: Contact) => void;
  /** Puts these contacts on the list or takes them off, as one change; true when it was done. */
  onApply: (changes: { id: string; add: boolean; name: string }[]) => Promise<boolean>;
}

const hasEmail = (c: Contact) => {
  try {
    return (JSON.parse(c.emails || "[]") as { value?: string }[]).some((e) => String(e?.value ?? "").trim());
  } catch { return false; }
};

const firstEmail = (c: Contact) => {
  try { return String(JSON.parse(c.emails || "[]")[0]?.value ?? ""); } catch { return ""; }
};

/**
 * A mailing list's page (Contacts Cleanup 0.1.27): everyone in its address
 * book with a checkbox, members ticked, and a search over the whole book.
 * Ticks wait for Apply, which puts the ticked ones on and takes the unticked
 * ones off. Thunderbird only puts contacts with an email address on a list,
 * so the others can't be ticked (a member can always come off).
 */
export default function MailingListView({ list, bookName, contacts, members, locked, selectedContactId, onSelect, onContextMenu, onApply }: Props) {
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<"all" | "on" | "off">("all");
  const [ticks, setTicks] = useState<Map<string, boolean>>(new Map());
  const [busy, setBusy] = useState(false);

  const people = useMemo(
    () => contacts.filter((c) => !c.deleted && c.address_book_id === list.parentId).sort((a, b) => (a.fn || "").localeCompare(b.fn || "")),
    [contacts, list.parentId]
  );
  const on = (c: Contact) => members.has(c.id);
  const canJoin = (c: Contact) => hasEmail(c) && !locked?.has(c.id);
  const ticked = (c: Contact) => (ticks.has(c.id) ? ticks.get(c.id)! : on(c));
  // A tick that matches the list now (applied, or changed in Thunderbird) is no change any more.
  const pending = [...ticks].filter(([id, want]) => {
    const c = people.find((p) => p.id === id);
    return c && on(c) !== want;
  });
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people
      .filter((c) => show === "all" || (show === "on") === members.has(c.id))
      .filter((c) => !q || [c.fn, c.first_name, c.last_name, c.nickname, c.org, c.emails, c.phones, c.categories].some((v) => (v || "").toLowerCase().includes(q)));
  }, [people, members, search, show]);
  const tickable = shown.filter((c) => canJoin(c) || (on(c) && !locked?.has(c.id)));

  const tick = (next: Map<string, boolean>, c: Contact, want: boolean) => {
    if (want === on(c)) next.delete(c.id); else next.set(c.id, want);
  };
  const setOne = (c: Contact, want: boolean) => setTicks((was) => {
    const next = new Map(was);
    tick(next, c, want);
    return next;
  });
  const allShown = tickable.length > 0 && tickable.every(ticked);
  const someShown = tickable.some(ticked);
  const adding = pending.filter(([, want]) => want).length;
  const removing = pending.length - adding;
  const what = [
    adding ? `put ${adding} contact${adding > 1 ? "s" : ""} on` : "",
    removing ? `take ${removing} contact${removing > 1 ? "s" : ""} off` : ""
  ].filter(Boolean).join(" and ");

  async function apply() {
    setBusy(true);
    const done = await onApply(pending.map(([id, add]) => ({ id, add, name: people.find((p) => p.id === id)?.fn || "Contact" })));
    setBusy(false);
    if (done) setTicks(new Map());
  }

  return (
    <>
      <div className="toolbar">
        <h2>☰ {list.name}</h2>
        <input
          className="search-box"
          placeholder={`Search everyone in ${bookName}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={show} onChange={(e) => setShow(e.target.value as "all" | "on" | "off")} aria-label="Show">
          <option value="all">Everyone</option>
          <option value="on">On the list</option>
          <option value="off">Not on it</option>
        </select>
      </div>
      <div className="list-page-filters">
        <label>
          <input
            type="checkbox"
            checked={allShown}
            ref={(el) => { if (el) el.indeterminate = someShown && !allShown; }}
            disabled={!tickable.length || busy}
            onChange={(e) => setTicks((was) => {
              const next = new Map(was);
              for (const c of tickable) if (!e.target.checked || canJoin(c)) tick(next, c, e.target.checked);
              return next;
            })}
          />
          All shown
        </label>
        <span className="hint">
          In {bookName}: {members.size} member{members.size === 1 ? "" : "s"} of {people.length} contact{people.length === 1 ? "" : "s"}. Tick to put on, untick to take off, then Apply.
        </span>
      </div>
      <div className="task-table">
        {shown.length === 0 ? (
          <div className="empty-state">
            {search.trim() ? `Nothing in ${bookName} matches the search.`
              : !people.length ? `${bookName} has no contacts yet. A mailing list holds contacts of its own address book.`
                : show === "on" ? "No one on this mailing list yet." : "Everyone is on it."}
          </div>
        ) : shown.map((c) => {
          const member = on(c);
          const why = locked?.has(c.id) ? `Also in ${locked.get(c.id)}: Thunderbird doesn't let add-ons change this copy.`
            : !hasEmail(c) ? "No email address: Thunderbird only puts contacts with one on a mailing list." : undefined;
          const change = ticks.has(c.id) && ticks.get(c.id) !== member;
          return (
            <div
              key={c.id}
              className={`task-row ${c.id === selectedContactId ? "selected" : ""} ${!member && !canJoin(c) ? "muted" : ""}`}
              onClick={() => onSelect(c.id)}
              onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(e, c); } : undefined}
            >
              <input
                type="checkbox"
                checked={ticked(c)}
                disabled={busy || Boolean(locked?.has(c.id)) || (!member && !canJoin(c))}
                title={why ?? (member ? "On the list" : "Put on the list")}
                aria-label={why ?? (member ? "On the list" : "Put on the list")}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setOne(c, e.target.checked)}
              />
              <div style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, flexShrink: 0, background: avatarColor(c), color: "#1e1f22" }}>
                {initials(c)}
              </div>
              <div className="title-col">
                <div className="title">
                  {c.fn || "Unnamed"}
                  {change && <span className="contact-source-tag">{ticks.get(c.id) ? "goes on" : "comes off"}</span>}
                </div>
                <div className="meta">{firstEmail(c) || "no email address"}</div>
              </div>
            </div>
          );
        })}
      </div>
      {pending.length > 0 && (
        <div className="list-page-bar" role="status">
          <span>Apply to {what}.</span>
          <button disabled={busy} onClick={() => setTicks(new Map())}>Clear</button>
          <button className="primary" disabled={busy} onClick={apply}>{busy ? "Applying…" : "Apply"}</button>
        </div>
      )}
    </>
  );
}
