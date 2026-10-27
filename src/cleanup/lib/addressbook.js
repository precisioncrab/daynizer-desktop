/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Daynizer's contacts for the clean-up pages, in place of Contacts
 * Cleanup's src/lib/addressbook.js (Thunderbird's address books). The `api`
 * object is what src/core/history.js expects.
 *
 * A card's id is the contact's id in Daynizer. Daynizer reaches every copy
 * of a contact on its own, so nothing is ever "shadowed" here, and it has
 * no mailing lists (CardDAV group cards show as labels), so the api has no
 * list calls and history.js leaves lists alone. Thunderbird's own contacts
 * (add-on only) have "tb:" ids and are read-only for now.
 *
 * Cards are read and saved as whole vCards (window.api.contacts.vcards,
 * saveVCard, createVCard): Daynizer keeps a saved card's lines as written
 * and pushes them to the server as they are.
 */

import { readThunderbirdBooks, readThunderbirdCard, isThunderbirdId, THUNDERBIRD_READ_ONLY } from "../../thunderbirdBooks";

const contacts = () => window.api.contacts;

/** A contact as the clean-up pages use it: { id, uid, parentId, readOnly, vCard, tb }. */
const nodeOf = (c) => ({ id: c.id, uid: c.uid, parentId: c.address_book_id, readOnly: false, vCard: c.vcf, tb: false });

/**
 * Every address book with its cards: [{ id, name, readOnly, remote, synced,
 * thunderbird, contacts: [node], lists: [] }]. In the add-on, Thunderbird's
 * own address books come after Daynizer's (src/thunderbirdBooks.ts): marked
 * `thunderbird`, named "<name> (Thunderbird)", and read-only (`readOnly` keeps
 * them out of the address book pickers; their cards aren't readOnly, so the
 * pages still point out what they'd fix; writes are refused below and by the
 * controller).
 */
export async function loadBooks() {
  const [books, cards, tbBooks] = await Promise.all([window.api.addressbooks.all(), contacts().vcards(), readThunderbirdBooks().catch(() => [])]);
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
      readOnly: true,
      remote: false,
      synced: false,
      thunderbird: true,
      contacts: book.cards.map((c) => ({ id: c.id, uid: c.uid, parentId: c.parentId, readOnly: false, vCard: c.vCard, tb: true })),
      lists: [],
    })),
  ];
}

const refuse = () => {
  throw new Error(THUNDERBIRD_READ_ONLY);
};

export const api = {
  async get(id) {
    try {
      if (isThunderbirdId(id)) {
        const c = await readThunderbirdCard(id);
        return c ? { ...c, readOnly: false, tb: true } : null;
      }
      const [c] = await contacts().vcards([id]);
      return c ? nodeOf(c) : null;
    } catch {
      return null;
    }
  },
  async update(id, vCard) {
    if (isThunderbirdId(id)) {
      refuse();
    }
    await contacts().saveVCard(id, vCard);
  },
  async create(parentId, vCard) {
    if (isThunderbirdId(parentId)) {
      refuse();
    }
    return (await contacts().createVCard(parentId, vCard)).id;
  },
  async remove(id) {
    if (isThunderbirdId(id)) {
      refuse();
    }
    await contacts().delete(id);
  },
  // Photos are inside Daynizer's vCards (PHOTO lines), so a deleted card's
  // photo comes back with its vCard.
  async photo() {
    return null;
  },
  async setPhoto() {},
};

/** A photo that isn't in the vCard: Daynizer has none (parts.js shows the vCard's own). */
export async function photoUrl() {
  return null;
}
