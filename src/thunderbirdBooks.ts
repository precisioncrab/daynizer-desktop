/**
 * Thunderbird's own address books in the add-on's Contacts tab (Settings >
 * Contacts, "Show Thunderbird's address books", on by default). Add-on only:
 * the desktop app has no Thunderbird to ask.
 *
 * READ-ONLY for now. Daynizer's add-on is Manifest V3, and in Thunderbird
 * 158 (ext-addressBook.js) a Manifest V3 contacts.create(parentId, vCard) or
 * contacts.update(id, vCard) also hands the vCard *string* to
 * addProperties(), which stores each character as its own custom property
 * ("0", "1", ...), and every later update copies them forward. Contacts
 * Cleanup ran into it (Manifest V2 avoids it). Reading and listing are safe,
 * so Thunderbird's contacts show, can be searched, and the clean-up pages
 * point out what they'd fix, but nothing here writes to them. Reported as
 * Thunderbird bug 2085594; the plan is to move the add-on to Manifest V2 as its
 * own step (or drop this once Thunderbird fixes it).
 *
 * Ids are prefixed so they never collide with Daynizer's own: a book is
 * "tb:<book id>", a contact "tb:<book id>»<UID>" (a UID can be in two books).
 */
import type { AddressBook, Contact } from "./types";
import { cardModel } from "./cleanup/core/card-model.js";

const KEY = "showThunderbirdBooks";
const SEP = "»";
export const TB_PREFIX = "tb:";

/** Why Daynizer doesn't change Thunderbird's contacts yet, for messages and the editor. */
export const THUNDERBIRD_READ_ONLY =
  "Contacts in Thunderbird's address books are read-only in Daynizer for now: a Thunderbird bug would " +
  "store each saved contact letter by letter. Change them in Thunderbird's Address Book, or with the " +
  "Contacts Cleanup add-on.";

export const isThunderbirdId = (id: string | null | undefined) => typeof id === "string" && id.startsWith(TB_PREFIX);

/** Thunderbird's address book API, when this is the add-on and has the addressBooks permission. */
function addressBooks(): any {
  const b = (globalThis as any).browser ?? (globalThis as any).messenger;
  return b?.addressBooks?.list ? b.addressBooks : null;
}

export const thunderbirdBooksAvailable = () => Boolean(addressBooks());

/** The setting: on unless turned off (per computer). */
export function thunderbirdBooksShown(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}
export function setThunderbirdBooksShown(on: boolean) {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* not remembered */ }
}

/** A Thunderbird contact as the clean-up pages read it. */
export interface ThunderbirdCard { id: string; uid: string; parentId: string; vCard: string }
export interface ThunderbirdBook { id: string; name: string; cards: ThunderbirdCard[] }

/** Thunderbird's address books with their contacts (none when the setting is off or there's no Thunderbird). */
export async function readThunderbirdBooks(): Promise<ThunderbirdBook[]> {
  const api = addressBooks();
  if (!api || !thunderbirdBooksShown()) return [];
  const books: any[] = await api.list(true);
  return books
    // Remote books are search-only directories (LDAP): nothing to list.
    .filter((b) => !b.remote)
    .map((b) => ({
      id: `${TB_PREFIX}${b.id}`,
      name: b.name,
      cards: (b.contacts ?? [])
        .filter((c: any) => typeof c.vCard === "string")
        .map((c: any) => ({ id: `${TB_PREFIX}${b.id}${SEP}${c.id}`, uid: c.id, parentId: `${TB_PREFIX}${b.id}`, vCard: c.vCard }))
    }));
}

/** One contact's current vCard, or null when it's gone. */
export async function readThunderbirdCard(id: string): Promise<ThunderbirdCard | null> {
  const api = addressBooks();
  if (!api) return null;
  const at = id.indexOf(SEP);
  const book = id.slice(TB_PREFIX.length, at);
  const uid = id.slice(at + SEP.length);
  try {
    const node = await api.contacts.get(uid);
    // Thunderbird finds a contact by UID only: make sure it's this book's copy.
    if (!node || node.parentId !== book || typeof node.vCard !== "string") return null;
    return { id, uid, parentId: `${TB_PREFIX}${book}`, vCard: node.vCard };
  } catch {
    return null;
  }
}

/** Calls `listener` (debounced) whenever a Thunderbird contact or address book changes. */
export function onThunderbirdChange(listener: () => void, wait = 600): () => void {
  const api = addressBooks();
  if (!api) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(listener, wait);
  };
  const events = [
    api.contacts?.onCreated, api.contacts?.onUpdated, api.contacts?.onDeleted, api.contacts?.onManyCreated,
    api.onCreated, api.onUpdated, api.onDeleted,
    api.mailingLists?.onMemberAdded, api.mailingLists?.onMemberRemoved
  ].filter(Boolean);
  for (const e of events) e.addListener(fire);
  return () => events.forEach((e) => e.removeListener(fire));
}

/** Thunderbird's books as Daynizer's sidebar lists them (grey, never synced by Daynizer). */
export function thunderbirdAddressBooks(books: ThunderbirdBook[]): AddressBook[] {
  return books.map((b, i) => ({
    id: b.id, name: b.name, color: "#8a8d93", sort_order: 1000 + i,
    carddav_account_id: null, carddav_addressbook_url: null, carddav_ctag: null, created_at: "", updated_at: ""
  }));
}

/** Thunderbird's contacts as Daynizer's contact rows (for the list, labels, birthdays and the read-only editor). */
export function thunderbirdContacts(books: ThunderbirdBook[]): Contact[] {
  const out: Contact[] = [];
  for (const b of books) {
    for (const c of b.cards) {
      let m: ReturnType<typeof cardModel>;
      try { m = cardModel(c.vCard); } catch { continue; }
      const date = (d: string, noYear: boolean) => (!d ? null : noYear ? `--${d.slice(5, 7)}-${d.slice(8, 10)}` : d);
      out.push({
        id: c.id, address_book_id: b.id,
        fn: m.fn || [m.given, m.family].filter(Boolean).join(" ") || m.org || "",
        prefix: "", first_name: m.given, middle_name: "", last_name: m.family, suffix: "",
        nickname: m.nickname, org: m.org, title: m.title,
        bday: date(m.bday, m.bdayNoYear), anniversary: date(m.anniversary, m.anniversaryNoYear),
        notes: m.note, categories: m.categories, photo: "",
        phones: JSON.stringify(m.phones.map((p: any) => ({ type: p.type === "other" ? "" : p.type, value: p.value }))),
        emails: JSON.stringify(m.emails.map((e: any) => ({ type: e.type === "other" ? "" : e.type, value: e.value }))),
        addresses: JSON.stringify(m.addresses.map((a: any) => ({
          type: a.type === "other" ? "" : a.type, street: a.parts[2], city: a.parts[3], region: a.parts[4], postal: a.parts[5], country: a.parts[6]
        }))),
        urls: JSON.stringify(m.urls.map((u: any) => ({ type: "", value: u.value }))),
        impps: JSON.stringify(m.chats.map((x: any) => ({ type: "", value: x.value }))),
        related: "[]", raw_vcard: c.vCard,
        carddav_uid: null, carddav_href: null, carddav_etag: null, deleted: 0, sequence: 0, created_at: "", updated_at: ""
      });
    }
  }
  return out;
}
