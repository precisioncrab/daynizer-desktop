/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Applying changes to cards, and undoing them.
 *
 * Every applied change is one history entry holding each card before and
 * after: { id, time, title, cards: [{ id, parentId, label, before, after,
 * photoKept, photo }], undone }. `after` is the vCard as Thunderbird saved
 * it (read back), or null for a card that was deleted; `before` is null for
 * a card that was created (undo deletes it). Photos come inside
 * the vCards (Thunderbird adds a local card's photo as a data URL), so a
 * change that leaves a card's photo alone stores both vCards without it
 * (`photoKept`), and undo puts the card's current photo back in: a phone
 * fix on hundreds of cards doesn't store hundreds of photos twice. `photo`
 * is a deleted card's photo as a data URL, only when its vCard had none.
 *
 * Undo puts every card back as it was. A card that changed since (edited
 * in Thunderbird, or by a sync) is a conflict: undo stops and asks, and
 * goes ahead only when told to.
 *
 * A deleted card also keeps the mailing lists it was in (`lists`), and
 * undo puts the card back in them. A deleted mailing list is kept in
 * entry.lists ({ parentId, name, nickName, description, members }) and
 * undo makes it again with its members. A mailing list made is kept in
 * entry.madeLists ({ id, parentId, name }) and undo deletes it; a card put
 * on or taken off a list is kept in entry.members ({ listId, id, add }) and
 * undo does the opposite.
 *
 * `api` is the address book (src/lib/addressbook.js, or a fake in tests):
 * get(id) -> node|null, update(id, vCard), create(parentId, vCard) -> id,
 * remove(id), photo(id) -> dataUrl|null, setPhoto(id, dataUrl); and for
 * mailing lists, when it has them: listsOf(id) -> [list id],
 * addToList(listId, id), removeFromList(listId, id), getList(id),
 * createList(parentId, list) -> id, deleteList(id); and bookExists(id) ->
 * bool, when it can tell.
 */

import { comparable, parseVCard, parseLine, serializeVCard, insertProp, photoLines, withoutPhoto, withPhoto } from "./vcard.js";

/** The vCard without its UID line, so Thunderbird gives the card a new one. */
export function withoutUid(vCard) {
  const vcard = parseVCard(vCard);
  vcard.props = vcard.props.filter((p) => p.name !== "UID");
  return serializeVCard(vcard);
}

/** The vCard with this UID (Thunderbird refuses an update that changes a card's UID). */
export function withUid(vCard, uid) {
  const vcard = parseVCard(withoutUid(vCard));
  insertProp(vcard, parseLine(`UID:${uid}`));
  return serializeVCard(vcard);
}

/** Deletes a card, recording it (with its photo and mailing lists) for undo. */
async function deleteCard(api, entry, node, label) {
  const photo = photoLines(node.vCard) ? null : await api.photo(node.id).catch(() => null);
  const lists = api.listsOf ? await api.listsOf(node.id).catch(() => []) : [];
  await api.remove(node.id);
  entry.cards.push({ id: node.id, parentId: node.parentId, label, before: node.vCard, after: null, photo, ...(lists.length ? { lists } : {}) });
}

/**
 * The same contact in several address books with one UID: Thunderbird lets
 * add-ons reach one copy at a time (src/lib/addressbook.js). `change.want`
 * says what each copy becomes, by address book id: a vCard, or null to
 * delete that copy; a copy whose book isn't named stays as it is. Each copy
 * Thunderbird reaches is dealt with in turn: deleted, or (while others
 * still share its UID) made again in its book with a new UID, in the same
 * mailing lists; that lets Thunderbird reach the next one. The last copy
 * left keeps the UID and is updated. Returns the card ids the copies have
 * afterwards.
 */
async function sortCopies(api, entry, change) {
  const left = new Set(change.books);
  const ids = [];
  for (let step = 0; step <= change.books.length && left.size; step++) {
    const node = await api.get(change.uid);
    if (!node) {
      break;
    }
    if (!left.has(node.parentId)) {
      throw new Error(`"${change.label}" has a copy in an address book this change doesn't cover. Nothing more was changed.`);
    }
    left.delete(node.parentId);
    const want = node.parentId in change.want ? change.want[node.parentId] : node.vCard;
    if (want === null) {
      await deleteCard(api, entry, node, change.label);
    } else if (left.size) {
      const id = await api.create(node.parentId, withoutUid(want));
      for (const list of api.listsOf ? await api.listsOf(node.id).catch(() => []) : []) {
        await api.addToList(list, id).catch(() => false);
      }
      entry.cards.push({ id, parentId: node.parentId, label: change.label, before: null, after: (await api.get(id))?.vCard ?? want });
      await deleteCard(api, entry, node, change.label);
      ids.push(id);
    } else {
      if (comparable(want) !== comparable(node.vCard)) {
        await updateCard(api, entry, node, withUid(want, change.uid), change.label);
      }
      ids.push(node.id);
    }
  }
  return ids;
}

async function updateCard(api, entry, node, vCard, label) {
  await api.update(node.id, vCard);
  const saved = (await api.get(node.id))?.vCard ?? vCard;
  const record = { id: node.id, parentId: node.parentId, label, before: node.vCard, after: saved };
  if (photoLines(node.vCard) === photoLines(saved)) {
    Object.assign(record, { before: withoutPhoto(node.vCard), after: withoutPhoto(saved), photoKept: true });
  }
  entry.cards.push(record);
}

export const HISTORY_LIMIT = 50;

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Applies changes in order: [{ type: "update", id, vCard, label }],
 * [{ type: "delete", id, label }], [{ type: "create", parentId, vCard,
 * label, lists }] (lists: mailing list ids to put the new card in),
 * [{ type: "copies", uid, books, want, label }] (see sortCopies),
 * [{ type: "deleteList", listId, label }], [{ type: "createList", parentId,
 * name, label }] or [{ type: "listMember", listId, id, add, label }] (puts
 * the card on the list, or with add false takes it off; Thunderbird skips a
 * card without an email address). Stops at the first failure, so
 * a merge never deletes cards after its kept card failed to save.
 * Returns { entry, error, results }: the entry holds what was done, even
 * after a failure; results[i] is what change i gave (a "copies" change: its
 * card ids).
 * `onProgress(done, total)` is called after each change.
 */
export async function applyChanges(api, title, changes, onProgress = () => {}) {
  const entry = { id: newId(), time: Date.now(), title, cards: [], undone: false };
  const results = [];
  try {
    for (const [i, change] of changes.entries()) {
      if (change.type === "create") {
        const id = await api.create(change.parentId, change.vCard);
        for (const list of change.lists ?? []) {
          await api.addToList(list, id).catch(() => false);
        }
        const saved = (await api.get(id))?.vCard ?? change.vCard;
        entry.cards.push({ id, parentId: change.parentId, label: change.label, before: null, after: saved });
        results.push(id);
      } else if (change.type === "copies") {
        results.push(await sortCopies(api, entry, change));
      } else if (change.type === "deleteList") {
        const list = await api.getList(change.listId);
        if (list) {
          await api.deleteList(change.listId);
          entry.lists = [...(entry.lists ?? []), list];
        }
        results.push(null);
      } else if (change.type === "createList") {
        const id = await api.createList(change.parentId, { name: change.name });
        entry.madeLists = [...(entry.madeLists ?? []), { id, parentId: change.parentId, name: change.name }];
        results.push(id);
      } else if (change.type === "listMember") {
        const done = await (change.add ? api.addToList(change.listId, change.id) : api.removeFromList(change.listId, change.id));
        if (done === false) {
          throw new Error(`The mailing list for "${change.label}" isn't there any more.`);
        }
        entry.members = [...(entry.members ?? []), { listId: change.listId, id: change.id, add: Boolean(change.add) }];
        results.push(change.id);
      } else {
        const node = await api.get(change.id);
        if (!node) {
          throw new Error(`"${change.label}" isn't in the address book any more.`);
        }
        if (change.type === "delete") {
          await deleteCard(api, entry, node, change.label);
        } else {
          await updateCard(api, entry, node, change.vCard, change.label);
        }
        results.push(change.id);
      }
      onProgress(i + 1, changes.length);
    }
    return { entry, error: null, results };
  } catch (e) {
    return { entry, error: e?.message ?? String(e), results };
  }
}

/**
 * What changed since an entry was applied: [{ label, reason }].
 * reason: "changed" (edited since), "missing" (deleted since), "exists"
 * (a deleted card is back).
 */
export async function undoConflicts(api, entry) {
  const conflicts = [];
  for (const card of entry.cards) {
    const node = await api.get(card.id).catch(() => null);
    if (card.before === null) {
      // Created: changed since is a conflict; deleted since is already undone.
      if (node && comparable(node.vCard) !== comparable(card.after)) {
        conflicts.push({ label: card.label, reason: "changed" });
      }
    } else if (card.after === null) {
      if (node) {
        conflicts.push({ label: card.label, reason: "exists" });
      }
    } else if (!node) {
      conflicts.push({ label: card.label, reason: "missing" });
    } else if (comparable(node.vCard) !== comparable(card.after)) {
      conflicts.push({ label: card.label, reason: "changed" });
    }
  }
  return conflicts;
}

/**
 * The address books an undo would put cards or mailing lists back into that
 * are gone (deleted since), by id. Undo doesn't run then: it would take the
 * moved copies away and have nowhere to put the cards back. Checked with
 * `api.bookExists(id)` when the api has it.
 */
export async function missingBooks(api, entry) {
  if (!api.bookExists) {
    return [];
  }
  const ids = new Set([
    ...entry.cards.filter((c) => c.before !== null).map((c) => c.parentId),
    ...(entry.lists ?? []).map((l) => l.parentId),
  ]);
  const missing = [];
  for (const id of ids) {
    if (!(await api.bookExists(id).catch(() => true))) {
      missing.push(id);
    }
  }
  return missing;
}

/**
 * Undoes an entry: deleted cards come back (with their photos), changed
 * cards get their old vCard. With conflicts and no `force`, nothing is
 * done and { conflicts } comes back. Cards that were deleted since are
 * created again; cards that came back are left alone.
 * Returns { conflicts, done, error }.
 */
export async function undoEntry(api, entry, { force = false } = {}) {
  if ((await missingBooks(api, entry)).length) {
    return { conflicts: [], done: false, error: "an address book it would put contacts back into was deleted since, so it can't be undone. Nothing was changed." };
  }
  const conflicts = await undoConflicts(api, entry);
  if (conflicts.length && !force) {
    return { conflicts, done: false, error: null };
  }
  try {
    // Cards put on or taken off a list go back first, newest first.
    for (const m of [...(entry.members ?? [])].reverse()) {
      await (m.add ? api.removeFromList(m.listId, m.id) : api.addToList(m.listId, m.id)).catch(() => false);
    }
    // Deleted mailing lists come back first (empty), so cards brought back can join them.
    const listIds = new Map();
    for (const list of entry.lists ?? []) {
      listIds.set(list.id, await api.createList(list.parentId, list));
    }
    // A card made again gets a new UID when its old one is taken (by a copy in
    // another address book): its new id, for the lists of the cards after it.
    const newIds = new Map();
    for (const card of [...entry.cards].reverse()) {
      const node = await api.get(card.id).catch(() => null);
      if (card.before === null) {
        if (node) {
          await api.remove(card.id);
        }
        continue;
      }
      if (card.after === null || !node) {
        if (card.after === null && node) {
          continue;
        }
        const id = await createWithFallback(api, card.parentId, card.before);
        newIds.set(card.id, id);
        if (card.photo && id) {
          await api.setPhoto(id, card.photo).catch(() => {});
        }
        for (const list of card.lists ?? []) {
          await api.addToList(listIds.get(list) ?? list, id).catch(() => false);
        }
      } else {
        await api.update(card.id, card.photoKept ? withPhoto(card.before, photoLines(node.vCard)) : card.before);
      }
    }
    for (const list of entry.lists ?? []) {
      for (const member of list.members) {
        await api.addToList(listIds.get(list.id), newIds.get(member) ?? member).catch(() => false);
      }
    }
    // Mailing lists it made go last (their contacts stay); one deleted since is left alone.
    for (const list of entry.madeLists ?? []) {
      if (await api.getList(list.id)) {
        await api.deleteList(list.id);
      }
    }
    return { conflicts, done: true, error: null };
  } catch (e) {
    return { conflicts, done: false, error: e?.message ?? String(e) };
  }
}

/**
 * Creates the card with its old UID (so it gets its old id back), or with a
 * new one if Thunderbird refuses (it refuses a UID any address book uses).
 */
async function createWithFallback(api, parentId, vCard) {
  try {
    return await api.create(parentId, vCard);
  } catch {
    return api.create(parentId, withoutUid(vCard));
  }
}

/** Whether an entry changed anything (cards, or mailing lists alone). */
export const entryChanged = (entry) => Boolean(entry.cards.length || entry.lists?.length || entry.madeLists?.length || entry.members?.length);

/** The history with a new entry on top, at most HISTORY_LIMIT long. */
export function addEntry(history, entry) {
  return [entry, ...(history ?? [])].slice(0, HISTORY_LIMIT);
}
