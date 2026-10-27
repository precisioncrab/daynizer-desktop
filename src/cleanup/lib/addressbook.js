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
 * books do, as in Contacts Cleanup: their `lists` are loaded (Lists to labels
 * offers them, and "keep one copy" labels with them), and the list calls
 * (listsOf, addToList, getList, createList, deleteList) answer for
 * Thunderbird's contacts and lists only, so a copy made again under a new ID
 * stays in its lists, a list can be deleted, and undo puts it all back.
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
  readThunderbirdBooks, sameAsDaynizer, shownThunderbirdBooks, readThunderbirdCard, readThunderbirdByUid, thunderbirdShadowed,
  thunderbirdPhoto, setThunderbirdPhoto, thunderbirdBookExists, deleteThunderbirdBook,
  thunderbirdListsOf, addToThunderbirdList, readThunderbirdList, createThunderbirdList, deleteThunderbirdList, isThunderbirdId,
} from "../../thunderbirdBooks";

const contacts = () => window.api.contacts;

/** A contact as the clean-up pages use it: { id, uid, parentId, readOnly, vCard, tb }. */
const nodeOf = (c) => ({ id: c.id, uid: c.uid, parentId: c.address_book_id, readOnly: false, vCard: c.vcf, tb: false });

/**
 * Every address book with its cards: [{ id, name, readOnly, remote, synced,
 * thunderbird, contacts: [node], lists: [] }]. In the add-on, Thunderbird's
 * own address books come after Daynizer's (src/thunderbirdBooks.ts): marked
 * `thunderbird` and named "<name> (Thunderbird)"; `readOnly` is Thunderbird's
 * own (a read-only CardDAV book, say).
 */
export async function loadBooks() {
  const [books, cards, allTbBooks] = await Promise.all([
    window.api.addressbooks.all(), contacts().vcards(), readThunderbirdBooks().then(sameAsDaynizer).catch(() => []),
  ]);
  // Thunderbird's copies add-ons can't change (one UID in two of its books), over all its books.
  const shadowed = await thunderbirdShadowed(allTbBooks).catch(() => new Map());
  // A Thunderbird book with the same contacts as one of Daynizer's is hidden, as in the contact list,
  // but stays here marked `hidden`: its copies still count (one ID in it and in a shown book is a
  // contact in two books, and moving or sorting the shown copy has to go through the "copies"
  // change). The controller leaves it out of every page.
  const shownIds = new Set(shownThunderbirdBooks(allTbBooks).map((b) => b.id));
  const tbBooks = allTbBooks;
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
      // Lists to labels names the label after the book, without " (Thunderbird)".
      labelName: book.name,
      hidden: !shownIds.has(book.id),
      readOnly: book.readOnly,
      remote: false,
      synced: false,
      thunderbird: true,
      contacts: book.cards.map((c) => ({
        id: c.id, uid: c.uid, parentId: c.parentId, readOnly: c.readOnly, vCard: c.vCard, tb: true, shadowed: shadowed.get(c.id) ?? null,
      })),
      lists: book.lists ?? [],
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
  async getList(id) {
    return readThunderbirdList(id);
  },
  async createList(parentId, list) {
    return createThunderbirdList(parentId, list);
  },
  async deleteList(id) {
    return deleteThunderbirdList(id);
  },
  // Undo checks a book is still there; only Thunderbird's books are deleted from the clean-up pages.
  async bookExists(id) {
    if (isThunderbirdId(id)) {
      return thunderbirdBookExists(id);
    }
    return (await window.api.addressbooks.all()).some((b) => b.id === id);
  },
  async deleteBook(id) {
    return deleteThunderbirdBook(id);
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
