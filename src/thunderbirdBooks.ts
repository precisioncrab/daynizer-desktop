/**
 * Thunderbird's own address books in the add-on's Contacts tab (Settings >
 * Contacts, "Show Thunderbird's address books", on by default). Add-on only:
 * the desktop app has no Thunderbird to ask.
 *
 * Why the add-on is Manifest V2 (since 0.9.0): in Thunderbird 158
 * (ext-addressBook.js) a Manifest V3 contacts.create(parentId, vCard) or
 * contacts.update(id, vCard) also hands the vCard *string* to
 * addProperties(), which stores each character as its own custom property
 * ("0", "1", ...), and every later update copies them forward (Thunderbird
 * bug 2085594, filed 2026-10-24; Contacts Cleanup ran into it first). In
 * Manifest V2 the API is browser.contacts / browser.mailingLists, a contact's
 * vCard is properties.vCard, and a write passes { vCard }, which Thunderbird
 * keeps out of the custom properties. Up to 0.8.x (Manifest V3) these books
 * were read-only in Daynizer.
 *
 * Reading happens here, in the tab. Writes go through the background like
 * every other contact change (window.api.contacts.update/delete/saveVCard/
 * createVCard with a "tb:" id; thunderbird-addon/background/thunderbird.ts).
 *
 * Ids are prefixed so they never collide with Daynizer's own: a book is
 * "tb:<book id>", a contact "tb:<book id>»<UID>". Thunderbird names a contact
 * by its UID only, and one UID can be in two books (a book imported from
 * another); Thunderbird then lets add-ons reach only one of the copies, so a
 * write checks it reaches the copy it names and refuses otherwise.
 */
import type { AddressBook, Contact } from "./types";
import { cardModel, modelToVCard, readDate } from "./cleanup/core/card-model.js";

const KEY = "showThunderbirdBooks";
const SEP = "»";
export const TB_PREFIX = "tb:";

/** Why a change to one copy of a contact that's in two Thunderbird books with one ID was refused. */
export const THUNDERBIRD_OTHER_COPY =
  "This contact is in two of Thunderbird's address books with the same ID, and Thunderbird only lets " +
  "add-ons change the copy in the other one. Nothing was changed.";

export const isThunderbirdId = (id: string | null | undefined) => typeof id === "string" && id.startsWith(TB_PREFIX);

/** Thunderbird's address book API, when this is the add-on and has the addressBooks permission. */
function addressBooks(): any {
  const b = (globalThis as any).browser ?? (globalThis as any).messenger;
  return b?.addressBooks?.list ? b.addressBooks : null;
}

// Manifest V2 has the contacts and mailing lists APIs at the top level;
// Manifest V3 put them under addressBooks.
const tbApi = () => (globalThis as any).browser ?? (globalThis as any).messenger;
export const thunderbirdContactsApi = (): any => tbApi()?.contacts ?? addressBooks()?.contacts ?? null;
const mailingListsApi = (): any => tbApi()?.mailingLists ?? addressBooks()?.mailingLists ?? null;

/** A contact node's vCard (Manifest V2 keeps it in properties). */
export const vCardOf = (node: any): string | undefined => {
  const v = node?.vCard ?? node?.properties?.vCard;
  return typeof v === "string" ? v : undefined;
};

/** "tb:<book>»<UID>" as { book, uid } (book without the prefix), or null for another id. */
export function splitThunderbirdId(id: string): { book: string; uid: string } | null {
  if (!isThunderbirdId(id)) return null;
  const at = id.indexOf(SEP);
  if (at < 0) return null;
  return { book: id.slice(TB_PREFIX.length, at), uid: id.slice(at + SEP.length) };
}

export const thunderbirdCardId = (book: string, uid: string) => `${TB_PREFIX}${book}${SEP}${uid}`;

/** The book ("tb:<book>") a Thunderbird contact id is in, or null for another id. */
export function thunderbirdBookOf(id: string | null | undefined): string | null {
  const at = typeof id === "string" ? splitThunderbirdId(id) : null;
  return at ? `${TB_PREFIX}${at.book}` : null;
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
export interface ThunderbirdCard { id: string; uid: string; parentId: string; vCard: string; readOnly: boolean }
/** A mailing list of a Thunderbird book; `members` are UIDs (a list holds cards of its own book). */
export interface ThunderbirdList { id: string; parentId: string; name: string; nickName: string; description: string; members: string[] }
export interface ThunderbirdBook {
  id: string; name: string; readOnly: boolean; cards: ThunderbirdCard[]; lists: ThunderbirdList[];
  /** The Daynizer address book this one is the same server book as (see sameAsDaynizer), or null. */
  sameAs: string | null;
}

const listOf = (node: any, book: string): ThunderbirdList => ({
  id: node.id, parentId: `${TB_PREFIX}${book}`, name: node.name ?? "", nickName: node.nickName ?? "",
  description: node.description ?? "", members: (node.contacts ?? []).map((c: any) => c.id)
});

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
      readOnly: Boolean(b.readOnly),
      cards: (b.contacts ?? [])
        .filter((c: any) => vCardOf(c) !== undefined)
        .map((c: any) => ({
          id: thunderbirdCardId(b.id, c.id), uid: c.id, parentId: `${TB_PREFIX}${b.id}`, vCard: vCardOf(c)!,
          readOnly: Boolean(b.readOnly || c.readOnly)
        })),
      lists: (b.mailingLists ?? []).map((l: any) => listOf(l, b.id)),
      sameAs: null as string | null
    }));
}

/**
 * Marks each Thunderbird book that's the same server address book as one of
 * Daynizer's own (`sameAs`: that book's name): when Thunderbird and Daynizer
 * both sync one CardDAV book (Synology Contacts and My Contacts, say), every
 * contact would show twice. Thunderbird's API doesn't give a book's server
 * address, so it's told by contact IDs: at least 80% of the book's contacts
 * have an ID that's in one Daynizer book.
 */
export async function sameAsDaynizer(books: ThunderbirdBook[]): Promise<ThunderbirdBook[]> {
  const api = (globalThis as any).window?.api;
  if (!books.length || !api?.contacts?.vcards || !api?.addressbooks?.all) return books;
  const [ours, rows] = await Promise.all([api.addressbooks.all(), api.contacts.vcards()]);
  const bookOfUid = new Map<string, string>();
  for (const r of rows as { uid: string; address_book_id: string }[]) if (r.uid) bookOfUid.set(r.uid, r.address_book_id);
  return books.map((b) => {
    if (!b.cards.length) return b;
    const counts = new Map<string, number>();
    for (const c of b.cards) {
      const ourBook = bookOfUid.get(c.uid);
      if (ourBook) counts.set(ourBook, (counts.get(ourBook) ?? 0) + 1);
    }
    const [best, n] = [...counts].sort((x, y) => y[1] - x[1])[0] ?? [null, 0];
    const name = best ? (ours as { id: string; name: string }[]).find((o) => o.id === best)?.name : null;
    return name && n >= b.cards.length * 0.8 ? { ...b, sameAs: name } : b;
  });
}

const SAME_KEY = "showThunderbirdSameBooks";
/** Thunderbird books shown although they're the same as one of Daynizer's (per computer). */
function sameShownIds(): string[] {
  try { return JSON.parse(localStorage.getItem(SAME_KEY) || "[]"); } catch { return []; }
}
export function setThunderbirdSameShown(id: string, on: boolean) {
  const ids = sameShownIds().filter((x) => x !== id);
  try { localStorage.setItem(SAME_KEY, JSON.stringify(on ? [...ids, id] : ids)); } catch { /* not remembered */ }
}
/** The books to show: a book that's the same as one of Daynizer's stays hidden unless shown on purpose. */
export function shownThunderbirdBooks(books: ThunderbirdBook[]): ThunderbirdBook[] {
  const shown = new Set(sameShownIds());
  return books.filter((b) => !b.sameAs || shown.has(b.id));
}

/** One contact's current vCard, or null when it's gone. */
export async function readThunderbirdCard(id: string): Promise<ThunderbirdCard | null> {
  const api = thunderbirdContactsApi();
  const at = splitThunderbirdId(id);
  if (!api || !at) return null;
  try {
    const node = await api.get(at.uid);
    // Thunderbird finds a contact by UID only: make sure it's this book's copy.
    const vCard = vCardOf(node);
    if (!node || node.parentId !== at.book || vCard === undefined) return null;
    return { id, uid: at.uid, parentId: `${TB_PREFIX}${at.book}`, vCard, readOnly: Boolean(node.readOnly) };
  } catch {
    return null;
  }
}

/**
 * The copy Thunderbird reaches for a bare UID, or null. Clean up > In several
 * books sorts a contact's copies one at a time this way (Contacts Cleanup's
 * sortCopies in src/cleanup/core/history.js).
 */
export async function readThunderbirdByUid(uid: string): Promise<ThunderbirdCard | null> {
  try {
    const node = await thunderbirdContactsApi()?.get(uid);
    const vCard = vCardOf(node);
    if (!node?.parentId || vCard === undefined) return null;
    return { id: thunderbirdCardId(node.parentId, uid), uid, parentId: `${TB_PREFIX}${node.parentId}`, vCard, readOnly: Boolean(node.readOnly) };
  } catch {
    return null;
  }
}

/** The mailing lists (ids) of its own book a Thunderbird contact is in. */
export async function thunderbirdListsOf(id: string): Promise<string[]> {
  const at = splitThunderbirdId(id);
  const lists = mailingListsApi();
  if (!at || !lists) return [];
  const ids: string[] = [];
  for (const list of await lists.list(at.book).catch(() => [])) {
    const members = await lists.listMembers(list.id).catch(() => []);
    if (members.some((m: any) => m.id === at.uid)) ids.push(list.id);
  }
  return ids;
}

/** Adds a Thunderbird contact to a mailing list of its book; false when the list is gone. */
export async function addToThunderbirdList(listId: string, id: string): Promise<boolean> {
  const at = splitThunderbirdId(id);
  const lists = mailingListsApi();
  if (!at || !lists) return false;
  try {
    await lists.get(listId);
  } catch {
    return false;
  }
  await lists.addMember(listId, at.uid);
  return true;
}

/** A mailing list with its members as card ids ("tb:<book>»<UID>"), for undo; null when it's gone. */
export async function readThunderbirdList(id: string): Promise<ThunderbirdList | null> {
  const lists = mailingListsApi();
  if (!lists) return null;
  try {
    const node = await lists.get(id);
    const members = await lists.listMembers(id);
    return { ...listOf(node, node.parentId), members: members.map((m: any) => thunderbirdCardId(node.parentId, m.id)) };
  } catch {
    return null;
  }
}

/** Makes a mailing list in a Thunderbird book ("tb:<book>"); its id. */
export async function createThunderbirdList(parentId: string, list: { name: string; nickName?: string; description?: string }): Promise<string> {
  const lists = mailingListsApi();
  if (!lists || !isThunderbirdId(parentId)) throw new Error("Only Thunderbird's address books have mailing lists.");
  return lists.create(parentId.slice(TB_PREFIX.length), { name: list.name, nickName: list.nickName ?? "", description: list.description ?? "" });
}

/** Deletes a Thunderbird mailing list (its contacts stay). */
export async function deleteThunderbirdList(id: string): Promise<void> {
  const lists = mailingListsApi();
  if (!lists) throw new Error("Only Thunderbird's address books have mailing lists.");
  await lists.delete(id);
}

/** Which book's copy Thunderbird reaches for this UID (the one add-ons can change), as "tb:<book>", or null. */
export async function reachableThunderbirdBook(uid: string): Promise<string | null> {
  try {
    const node = await thunderbirdContactsApi()?.get(uid);
    return node?.parentId ? `${TB_PREFIX}${node.parentId}` : null;
  } catch {
    return null;
  }
}

/**
 * Thunderbird's copies add-ons can't change: card id -> the name of the book
 * whose copy Thunderbird reaches instead ("<name> (Thunderbird)"). One UID in
 * two of Thunderbird's books: Thunderbird finds a contact by UID only, so
 * add-ons reach just one of the copies (Contacts Cleanup's markShadowed).
 * Used by the contact list and editor (App) and the clean-up pages.
 */
export async function thunderbirdShadowed(books: ThunderbirdBook[]): Promise<Map<string, string>> {
  const byUid = new Map<string, ThunderbirdCard[]>();
  for (const book of books.filter((b) => !b.readOnly)) {
    for (const card of book.cards) byUid.set(card.uid, [...(byUid.get(card.uid) ?? []), card]);
  }
  const nameOf = (id: string) => {
    const book = books.find((b) => b.id === id);
    return book ? `${book.name} (Thunderbird)` : "another address book";
  };
  const shadowed = new Map<string, string>();
  for (const [uid, copies] of byUid) {
    if (copies.length < 2) continue;
    const target = await reachableThunderbirdBook(uid);
    for (const card of copies) {
      if (target && target !== card.parentId) shadowed.set(card.id, nameOf(target));
    }
  }
  return shadowed;
}

/** Whether a Thunderbird book ("tb:<book>") is still there (true when Thunderbird can't be asked). */
export async function thunderbirdBookExists(id: string): Promise<boolean> {
  const api = addressBooks();
  if (!api?.get || !isThunderbirdId(id)) return true;
  try {
    return Boolean(await api.get(id.slice(TB_PREFIX.length)));
  } catch {
    return false;
  }
}

/** Renames a Thunderbird book ("tb:<book>"). */
export async function renameThunderbirdBook(id: string, name: string): Promise<void> {
  const api = addressBooks();
  if (!api?.update || !isThunderbirdId(id)) throw new Error("Only Thunderbird's address books can be renamed here.");
  await api.update(id.slice(TB_PREFIX.length), { name });
}

/** Renames a Thunderbird mailing list (its nickname and description stay). */
export async function renameThunderbirdList(id: string, name: string): Promise<void> {
  const lists = mailingListsApi();
  if (!lists) throw new Error("Only Thunderbird's address books have mailing lists.");
  const node = await lists.get(id);
  await lists.update(id, { name, nickName: node.nickName ?? "", description: node.description ?? "" });
}

/** Deletes a Thunderbird book ("tb:<book>") with its contacts and mailing lists; can't be undone. */
export async function deleteThunderbirdBook(id: string): Promise<void> {
  const api = addressBooks();
  if (!api?.delete || !isThunderbirdId(id)) throw new Error("Only Thunderbird's address books can be deleted here.");
  await api.delete(id.slice(TB_PREFIX.length));
}

/** A contact's photo as Thunderbird keeps it (outside the vCard), or null. */
export async function thunderbirdPhoto(id: string): Promise<File | null> {
  const at = splitThunderbirdId(id);
  if (!at) return null;
  try {
    return (await thunderbirdContactsApi()?.getPhoto(at.uid)) ?? null;
  } catch {
    return null;
  }
}

/** Sets a contact's photo (a File); refuses when Thunderbird would reach another book's copy. */
export async function setThunderbirdPhoto(id: string, file: File): Promise<void> {
  const at = splitThunderbirdId(id);
  const api = thunderbirdContactsApi();
  if (!at || !api) return;
  if ((await reachableThunderbirdBook(at.uid)) !== `${TB_PREFIX}${at.book}`) throw new Error(THUNDERBIRD_OTHER_COPY);
  await api.setPhoto(at.uid, file);
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
  const contacts = thunderbirdContactsApi();
  const lists = mailingListsApi();
  const events = [
    contacts?.onCreated, contacts?.onUpdated, contacts?.onDeleted, contacts?.onManyCreated,
    api.onCreated, api.onUpdated, api.onDeleted,
    lists?.onMemberAdded, lists?.onMemberRemoved
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

/**
 * One Thunderbird contact as a Daynizer contact row (null when its vCard
 * can't be read). The background builds the same row to tell which fields
 * an edit really changed (thunderbird-addon/background/thunderbird.ts), so
 * the two must never differ.
 */
export function thunderbirdContactRow(card: { id: string; parentId: string; vCard: string }): Contact | null {
  let m: ReturnType<typeof cardModel>;
  try { m = cardModel(card.vCard); } catch { return null; }
  const date = (d: string, noYear: boolean) => (!d ? null : noYear ? `--${d.slice(5, 7)}-${d.slice(8, 10)}` : d);
  return {
    id: card.id, address_book_id: card.parentId,
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
    related: "[]", raw_vcard: card.vCard,
    carddav_uid: null, carddav_href: null, carddav_etag: null, deleted: 0, sequence: 0, created_at: "", updated_at: ""
  };
}

/** ContactDetailPanel's first/last name from a display name, for a card with no N (keep the two the same). */
function splitFullName(fn: string): { first: string; last: string } {
  const parts = fn.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

const jsonList = (s: unknown): any[] => {
  try { const v = JSON.parse(String(s || "[]")); return Array.isArray(v) ? v : []; } catch { return []; }
};
const modelType = (t: unknown) => (t && t !== "other" ? String(t) : "other");
const addressParts = (a: any) => [a.street, a.city, a.region, a.postal, a.country].map((p) => String(p ?? "").trim());

/**
 * A phone, email or address list from the editor as the card model's items.
 * A value the card already has keeps its line (`at`), and so do the PO box
 * and extended part of an address, which the editor doesn't show; a value
 * edited in place keeps the line it replaces.
 */
function modelItems(edited: any[], was: any[], key: (item: any) => string, make: (item: any, from: any | null) => any) {
  const used = new Set<number>();
  const keys = edited.map(key);
  return edited.map((item, i) => {
    let k = was.findIndex((w, j) => !used.has(j) && key(w) === keys[i]);
    if (k < 0 && i < was.length && !used.has(i) && !keys.includes(key(was[i]))) k = i;
    if (k >= 0) used.add(k);
    return make(item, k >= 0 ? was[k] : null);
  });
}

/**
 * A Thunderbird card's vCard with an edit from Daynizer's contact editor
 * written in, or null when nothing really changed. `patch` is row-shaped, as
 * ContactDetailPanel sends it (every field it shows), or a few fields (the
 * label tools send only categories).
 *
 * Written with Contacts Cleanup's line-level writer (modelToVCard), not
 * contactToVCard: Thunderbird keeps vCard 4.0 and contactToVCard writes 3.0,
 * and here every line nobody changed stays exactly as written. Each field is
 * compared with the row the editor started from (thunderbirdContactRow), the
 * same way the editor reads it, so a card saved without a real change is
 * left alone. Display name: rewritten only when the name or (for a card
 * named after its organization) the organization changed.
 */
export function thunderbirdPatchedVCard(vCard: string, patch: Partial<Contact>): string | null {
  const was = cardModel(vCard);
  const before = thunderbirdContactRow({ id: "", parentId: "", vCard });
  if (!before) return null;
  const has = (k: keyof Contact) => Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined;
  const str = (v: unknown) => String(v ?? "").trim();
  const model: any = { ...was };

  // Names, as the editor shows them: a card with no N gets first/last split from its display name.
  const orgOnly = !before.first_name && !before.last_name && str(before.fn) === str(before.org);
  const shown = !before.first_name && !before.last_name && str(before.fn) && !orgOnly
    ? splitFullName(before.fn) : { first: before.first_name, last: before.last_name };
  const nameChanged = (has("first_name") && str(patch.first_name) !== str(shown.first))
    || (has("last_name") && str(patch.last_name) !== str(shown.last));
  const orgChanged = has("org") && str(patch.org) !== str(before.org);
  if (nameChanged) {
    model.given = has("first_name") ? str(patch.first_name) : str(shown.first);
    model.family = has("last_name") ? str(patch.last_name) : str(shown.last);
  }
  if (orgChanged) model.org = str(patch.org);
  if ((nameChanged || (orgChanged && orgOnly)) && has("fn")) model.fn = str(patch.fn);

  if (has("nickname")) model.nickname = str(patch.nickname);
  if (has("title")) model.title = str(patch.title);
  if (has("categories")) model.categories = String(patch.categories ?? "");
  if (has("notes")) model.note = String(patch.notes ?? "");
  for (const [key, field] of [["bday", "bday"], ["anniversary", "anniversary"]] as const) {
    if (!has(key)) continue; // null clears it
    const d = readDate(patch[key]);
    model[field] = d.date;
    model[`${field}NoYear`] = d.noYear;
  }

  // Phones and emails: compared as the editor saves them (empty values dropped).
  for (const [key, field] of [["phones", "phones"], ["emails", "emails"]] as const) {
    if (!has(key)) continue;
    const edited = jsonList(patch[key]).filter((v) => str(v?.value));
    const shownList = jsonList(before[key]).filter((v) => str(v?.value));
    const flat = (l: any[]) => JSON.stringify(l.map((v) => [modelType(v.type), str(v.value)]));
    if (flat(edited) === flat(shownList)) continue;
    model[field] = modelItems(edited, was[field], (v) => str(v.value),
      (v, from) => ({ type: modelType(v.type), value: str(v.value), at: from ? from.at : null }));
  }

  // Addresses: an address with none of the shown parts (only a PO box, say) isn't
  // in the editor's list at all, so it always stays.
  if (has("addresses")) {
    const edited = jsonList(patch.addresses).filter((a) => addressParts(a).some(Boolean));
    const shownList = jsonList(before.addresses).filter((a) => addressParts(a).some(Boolean));
    const flat = (l: any[]) => JSON.stringify(l.map((a) => [modelType(a.type), ...addressParts(a)]));
    if (flat(edited) !== flat(shownList)) {
      const visible = was.addresses.filter((a: any) => a.parts.slice(2).some((p: string) => str(p)));
      const hidden = was.addresses.filter((a: any) => !a.parts.slice(2).some((p: string) => str(p)));
      const items = modelItems(edited, visible, (a) => JSON.stringify(a.parts ? a.parts.slice(2).map(str) : addressParts(a)),
        (a, from) => ({
          type: modelType(a.type),
          parts: [from ? from.parts[0] : "", from ? from.parts[1] : "", ...addressParts(a)],
          at: from ? from.at : null
        }));
      model.addresses = [...items, ...hidden];
    }
  }

  const next = modelToVCard(vCard, model);
  return JSON.stringify(cardModel(next)) === JSON.stringify(was) ? null : next;
}

/** Thunderbird's contacts as Daynizer's contact rows (for the list, labels, birthdays and the editor). */
export function thunderbirdContacts(books: ThunderbirdBook[]): Contact[] {
  const out: Contact[] = [];
  for (const b of books) {
    for (const c of b.cards) {
      const row = thunderbirdContactRow(c);
      if (row) out.push(row);
    }
  }
  return out;
}
