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
 * list calls and history.js leaves lists alone.
 *
 * Cards are read and saved as whole vCards (window.api.contacts.vcards,
 * saveVCard, createVCard): Daynizer keeps a saved card's lines as written
 * and pushes them to the server as they are.
 */

const contacts = () => window.api.contacts;

/** A contact as the clean-up pages use it: { id, uid, parentId, readOnly, vCard }. */
const nodeOf = (c) => ({ id: c.id, uid: c.uid, parentId: c.address_book_id, readOnly: false, vCard: c.vcf });

/** Every address book with its cards: [{ id, name, readOnly, remote, synced, contacts: [node], lists: [] }]. */
export async function loadBooks() {
  const [books, cards] = await Promise.all([window.api.addressbooks.all(), contacts().vcards()]);
  return books.map((book) => ({
    id: book.id,
    name: book.name,
    readOnly: false,
    remote: false,
    synced: Boolean(book.carddav_addressbook_url),
    contacts: cards.filter((c) => c.address_book_id === book.id).map(nodeOf),
    lists: [],
  }));
}

export const api = {
  async get(id) {
    try {
      const [c] = await contacts().vcards([id]);
      return c ? nodeOf(c) : null;
    } catch {
      return null;
    }
  },
  async update(id, vCard) {
    await contacts().saveVCard(id, vCard);
  },
  async create(parentId, vCard) {
    return (await contacts().createVCard(parentId, vCard)).id;
  },
  async remove(id) {
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
