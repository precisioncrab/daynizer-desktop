import { useRef, useState } from "react";
import { AddressBook } from "../types";
import { createThunderbirdBook, isThunderbirdId } from "../thunderbirdBooks";

interface Props {
  addressBooks: AddressBook[];
  /** Add-on: Thunderbird's address books add-ons can write to ("tb:<book>"). */
  thunderbirdBooks?: { id: string; name: string }[];
  /** Books hidden in the sidebar (still offered, marked). */
  hiddenBooks?: Set<string>;
  defaultBookId: string | null;
  onClose: () => void;
  /** After an import; `bookId` is the address book they went into, when it's new. */
  onImported: (bookId?: string) => void;
}

type Summary = { canceled?: boolean; total?: number; labeled?: number; matched?: number; created?: number; skipped?: number; bookName?: string };

// "New address book…" in Daynizer, or in Thunderbird (add-on).
const NEW_DAYNIZER = "new";
const NEW_THUNDERBIRD = "tb-new";

/** The vCard with a label added to its CATEGORIES (unless it has it already, in any case). */
function withLabel(vcf: string, label: string): string {
  const escaped = label.replace(/([,;\\])/g, "\\$1");
  const line = /^CATEGORIES([;:][^\r\n]*)$/im.exec(vcf);
  if (!line) return vcf.replace(/END:VCARD/i, `CATEGORIES:${escaped}\r\nEND:VCARD`);
  const have = line[1].slice(line[1].indexOf(":") + 1).split(/(?<!\\),/).map((l) => l.replace(/\\(.)/g, "$1").trim().toLowerCase());
  return have.includes(label.toLowerCase()) ? vcf : vcf.replace(line[0], `${line[0]},${escaped}`);
}

/** Splits a .vcf file into its vCards. */
const splitVCards = (text: string) => String(text).match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) ?? [];

/** Import contacts from a .vcf file into any address book, or a new one,
 *  optionally stamping a label onto every contact in the file. In Daynizer's
 *  books, contacts already there are matched (by CardDAV UID, then by name +
 *  shared email) and updated in place rather than duplicated -- the
 *  workaround for Synology labels that don't travel over CardDAV. In
 *  Thunderbird's (add-on), each card is added as a new contact, as Contacts
 *  Cleanup's import does. */
export default function ImportVCardModal({ addressBooks, thunderbirdBooks = [], hiddenBooks, defaultBookId, onClose, onImported }: Props) {
  const [label, setLabel] = useState("");
  const [bookId, setBookId] = useState(defaultBookId || addressBooks[0]?.id || thunderbirdBooks[0]?.id || NEW_DAYNIZER);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const toThunderbird = bookId === NEW_THUNDERBIRD || isThunderbirdId(bookId);
  const isNew = bookId === NEW_DAYNIZER || bookId === NEW_THUNDERBIRD;
  const marked = (b: { id: string; name: string }) => (hiddenBooks?.has(b.id) ? `${b.name} (hidden in the sidebar)` : b.name);

  async function run() {
    setError(""); setResult(null); setBusy(true);
    try {
      const r = await window.api.contacts?.import({
        label: label.trim(), bookId: isNew ? "" : bookId, createNew: true,
        ...(bookId === NEW_DAYNIZER ? { newBook: newName.trim() } : {})
      });
      if (!r || r.canceled) { setBusy(false); return; } // dialog dismissed
      setResult(r);
      onImported(bookId === NEW_DAYNIZER ? r.bookId : undefined);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Into one of Thunderbird's books: the file is read here (the picker opens straight from the click). */
  async function importToThunderbird(file: File) {
    setError(""); setResult(null); setBusy(true);
    try {
      const cards = splitVCards(await file.text());
      if (!cards.length) throw new Error(`${file.name} has no contacts in it.`);
      const name = newName.trim() || file.name.replace(/\.(vcf|vcard)$/i, "").trim() || "Imported contacts";
      const target = bookId === NEW_THUNDERBIRD ? await createThunderbirdBook(name) : bookId;
      const extra = label.trim();
      let created = 0;
      for (const card of cards) {
        // Without its UID: one a contact in any of Thunderbird's books uses would be refused.
        let vcf = `${card.replace(/\r?\nUID[;:][^\r\n]*/gi, "").trim()}\r\n`;
        if (extra) vcf = withLabel(vcf, extra);
        await window.api.contacts?.createVCard(target, vcf);
        created++;
      }
      setResult({ total: cards.length, matched: 0, created, labeled: extra ? created : 0, bookName: bookId === NEW_THUNDERBIRD ? name : undefined });
      onImported(bookId === NEW_THUNDERBIRD ? target : undefined);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="settings-modal" style={{ position: "relative", maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>Import from vCard</h2>

        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 0 }}>
          Pick a <code>.vcf</code> file. {toThunderbird
            ? "Each contact in it is added to the Thunderbird address book you pick."
            : "Contacts already here are matched and updated (not duplicated)."} Any label below is added to every contact in the file.
        </p>

        <label>Add label to all imported contacts (optional)</label>
        <input
          type="text"
          value={label}
          placeholder="e.g. Google contacts"
          onChange={(e) => setLabel(e.target.value)}
          disabled={busy}
        />

        <label style={{ marginTop: 10 }}>{toThunderbird ? "Contacts are added to" : "Contacts not already here are added to"}</label>
        <select value={bookId} onChange={(e) => setBookId(e.target.value)} disabled={busy}>
          {thunderbirdBooks.length ? (
            <>
              <optgroup label="Daynizer">
                {addressBooks.map((b) => (
                  <option key={b.id} value={b.id}>{marked(b)}{b.carddav_addressbook_url ? " (synced)" : ""}</option>
                ))}
                <option value={NEW_DAYNIZER}>New address book…</option>
              </optgroup>
              <optgroup label="Thunderbird">
                {thunderbirdBooks.map((b) => <option key={b.id} value={b.id}>{marked(b)}</option>)}
                <option value={NEW_THUNDERBIRD}>New address book in Thunderbird…</option>
              </optgroup>
            </>
          ) : (
            <>
              {addressBooks.map((b) => (
                <option key={b.id} value={b.id}>{marked(b)}{b.carddav_addressbook_url ? " (synced)" : ""}</option>
              ))}
              <option value={NEW_DAYNIZER}>New address book…</option>
            </>
          )}
        </select>

        {isNew && (
          <>
            <label style={{ marginTop: 10 }}>Name of the new address book</label>
            <input type="text" value={newName} placeholder="The file's name" onChange={(e) => setNewName(e.target.value)} disabled={busy} />
            <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 6 }}>
              {bookId === NEW_THUNDERBIRD
                ? "A local Thunderbird address book, like Personal Address Book, so it can hold mailing lists. A synced one is set up in Thunderbird."
                : "On this computer. Settings > Contacts can link it to a server address book later."}
            </div>
          </>
        )}

        {error && <div style={{ color: "var(--danger)", marginTop: 12, fontSize: 13 }}>{error}</div>}

        {result && !result.canceled && (
          <div style={{ marginTop: 14, background: "var(--bg-field)", borderRadius: 6, padding: "10px 12px", fontSize: 13, color: "var(--text-2)" }}>
            Read {result.total} contact(s): matched {result.matched}, labeled {result.labeled}, added {result.created}{result.bookName ? ` to the new address book ${result.bookName}` : ""}.
            {!toThunderbird && (
              <div style={{ color: "var(--text-muted)", marginTop: 6 }}>
                Labels are added as a change to sync: they'll push to your server on the next sync.
              </div>
            )}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".vcf,.vcard,text/vcard,text/x-vcard"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) importToThunderbird(file);
          }}
        />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose}>{result ? "Done" : "Cancel"}</button>
          <button className="primary" onClick={toThunderbird ? () => fileRef.current?.click() : run} disabled={busy || !bookId}>
            {busy ? "Importing…" : "Choose file & import"}
          </button>
        </div>
      </div>
    </div>
  );
}
