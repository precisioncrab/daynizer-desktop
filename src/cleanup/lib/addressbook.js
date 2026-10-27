/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Daynizer's contacts for the clean-up pages, in place of Contacts
 * Cleanup's src/lib/addressbook.js (Thunderbird's address books). The `api`
 * object is what src/core/history.js expects.
 *
 * A card's id is the contact's id in Daynizer. Daynizer reaches every copy
 * of a contact on its own, so nothing of Daynizer's is ever "shadowed", and
 * it has no mailing lists (CardDAV group cards show as labels). Thunderbird's
 * books do: listsOf and addToList answer for its contacts only, so a copy
 * made again under a new ID stays in its lists and undo puts a deleted card
 * back in them. (The books' `lists` stay empty, so the pages don't offer
 * Thunderbird's lists as labels yet; Contacts Cleanup does.)
 *
 * Thunderbird's own contacts (add-on only, src/thunderbirdBooks.ts) have
 * "tb:" ids. They're read here, in the tab, and written through the same
 * window.api calls as Daynizer's, which the add-on's background sends to
 * Thunderbird (thunderbird-addon/background/thunderbird.ts). One UID can be
 * in two of Thunderbird's books, and Thunderbird lets add-ons reach only one
 * of the copies, so the others are marked `shadowed` (as in Contacts
 * Cleanup's src/ui/tab.js) and never written; the background refuses such a
 * write too.
 *
 * Cards are read and saved as whole vCards (window.api.contacts.vcards,
 * saveVCard, createVCard): Daynizer keeps a saved card's lines as written
 * and pushes them to the server as they are.
 */

import {
  readThunderbirdBooks, readThunderbirdCard, readThunderbirdByUid, reachableThunderbirdBook, thunderbirdPhoto, setThunderbirdPhoto,
  thunderbirdListsOf, addToThunderbirdList, isThunderbirdId,
} from "../../thunderbirdBooks";

const contacts = () => window.api.contacts;

/** A contact as the clean-up pages use it: { id, uid, parentId, readOnly, vCard, tb }. */
const nodeOf = (c) => ({ id: c.id, uid: c.uid, parentId: c.address_book_id, readOnly: false, vCard: c.vcf, tb: false });

/**
 * Thunderbird's copies that add-ons can't change: card id -> the name of the
 * book whose copy Thunderbird reaches instead (Contacts Cleanup's markShadowed).
 */
async function shadowedCopies(tbBooks) {
  const byUid = new Map();
  for (const book of tbBooks.filter((b) => !b.readOnly)) {
    for (const card of book.cards) {
      byUid.set(card.uid, [...(byUid.get(card.uid) ?? []), card]);
    }
  }
  const nameOf = (id) => {
    const book = tbBooks.find((b) => b.id === id);
    return book ? `${book.name} (Thunderbird)` : "another address book";
  };
  const shadowed = new Map();
  for (const [uid, copies] of byUid) {
    if (copies.length < 2) {
      continue;
    }
    const target = await reachableThunderbirdBook(uid);
    for (const card of copies) {
      if (target && target !== card.parentId) {
        shadowed.set(card.id, nameOf(target));
      }
    }
  }
  return shadowed;
}

/**
 * Every address book with its cards: [{ id, name, readOnly, remote, synced,
 * thunderbird, contacts: [node], lists: [] }]. In the add-on, Thunderbird's
 * own address books come after Daynizer's (src/thunderbirdBooks.ts): marked
 * `thunderbird` and named "<name> (Thunderbird)"; `readOnly` is Thunderbird's
 * own (a read-only CardDAV book, say).
 */
export async function loadBooks() {
  const [books, cards, tbBooks] = await Promise.all([window.api.addressbooks.all(), contacts().vcards(), readThunderbirdBooks().catch(() => [])]);
  const shadowed = await shadowedCopies(tbBooks).catch(() => new Map());
  return [
    ...books.map((book) => ({
      id: book.id,
      name: book.name,
      readOnly: false,
      remote: false,
      synced: Boolean(book.carddav_addressbook_url),
      thunderbird: false,
      contacts: cards.filter((c) => c.address_book_id === book.id).map(nodeOf),
      lists: [],
    })),
    ...tbBooks.map((book) => ({
      id: book.id,
      name: `${book.name} (Thunderbird)`,
      readOnly: book.readOnly,
      remote: false,
      synced: false,
      thunderbird: true,
      contacts: book.cards.map((c) => ({
        id: c.id, uid: c.uid, parentId: c.parentId, readOnly: c.readOnly, vCard: c.vCard, tb: true, shadowed: shadowed.get(c.id) ?? null,
      })),
      lists: [],
    })),
  ];
}

/** A data URL from a File or Blob. */
function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Thunderbird's photos bigger than this aren't kept for undo (as in Contacts Cleanup).
const PHOTO_LIMIT = 2 * 1024 * 1024;

export const api = {
  async get(id) {
    try {
      if (isThunderbirdId(id)) {
        const c = await readThunderbirdCard(id);
        return c ? { ...c, tb: true } : null;
      }
      const [c] = await contacts().vcards([id]);
      if (c) {
        return nodeOf(c);
      }
      // A bare UID (history.js sortCopies, for Thunderbird's copies): the copy Thunderbird reaches.
      const tb = await readThunderbirdByUid(id);
      return tb ? { ...tb, tb: true } : null;
    } catch {
      return null;
    }
  },
  // A "tb:" id or book goes to Thunderbird through the same calls (the add-on's background).
  async update(id, vCard) {
    await contacts().saveVCard(id, vCard);
  },
  async create(parentId, vCard) {
    return (await contacts().createVCard(parentId, vCard)).id;
  },
  async remove(id) {
    await contacts().delete(id);
  },
  async listsOf(id) {
    return isThunderbirdId(id) ? thunderbirdListsOf(id) : [];
  },
  async addToList(listId, id) {
    return isThunderbirdId(id) ? addToThunderbirdList(listId, id) : false;
  },
  // Photos are inside Daynizer's vCards (PHOTO lines), so a deleted card's
  // photo comes back with its vCard. Thunderbird keeps a card's photo apart
  // from its vCard, so for its contacts it's read and put back on its own.
  async photo(id) {
    if (!isThunderbirdId(id)) {
      return null;
    }
    const file = await thunderbirdPhoto(id);
    return file && file.size <= PHOTO_LIMIT ? toDataUrl(file) : null;
  },
  async setPhoto(id, dataUrl) {
    if (!isThunderbirdId(id) || !dataUrl) {
      return;
    }
    const blob = await (await fetch(dataUrl)).blob();
    const type = blob.type || "image/jpeg";
    await setThunderbirdPhoto(id, new File([blob], `photo.${type.split("/")[1] ?? "jpg"}`, { type }));
  },
};

/** A photo that isn't in the vCard: only Thunderbird's contacts have one (parts.js shows a vCard's own). */
export async function photoUrl(id) {
  if (!isThunderbirdId(id)) {
    return null;
  }
  const file = await thunderbirdPhoto(id);
  return file ? URL.createObjectURL(file) : null;
}
