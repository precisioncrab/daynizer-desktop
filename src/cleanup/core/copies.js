/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * One contact in several address books with the same UID (a book imported
 * from another), and what can be done about it:
 *   link       each copy gets its own UID and they're linked: an edit to
 *              one is made to the others too (the links live in this
 *              add-on's storage only)
 *   keep       one copy stays, with the others' details and their address
 *              books (and mailing lists) as labels; the others are deleted
 *   separate   each copy gets its own UID, and they're edited apart
 *   leave      nothing changes (the page stops asking)
 * The changes themselves are made by src/core/history.js ("copies").
 *
 * Also labels: an address book or mailing list turned into a label
 * (CATEGORIES) on its contacts.
 */

import { parseVCard, serializeVCard, getAll, makeProp, insertProp, removeProp, escapeText, unescapeText, comparable } from "./vcard.js";
import { mergeOptions, mergeVCard } from "./duplicates.js";
import { cardModel, modelToVCard } from "./card-model.js";

/**
 * Cards that share a UID with a card in another address book:
 * [{ uid, cards }], each group's cards in the order of `cards`.
 */
export function findCopies(cards) {
  const byUid = new Map();
  for (const card of cards) {
    byUid.set(card.uid, [...(byUid.get(card.uid) ?? []), card]);
  }
  return [...byUid]
    .filter(([, group]) => new Set(group.map((c) => c.parentId)).size > 1)
    .map(([uid, group]) => ({ uid, cards: group }));
}

/** The address books a group spans, as a key ("bookA|bookB", ids sorted). */
export const booksKey = (group) => [...new Set(group.cards.map((c) => c.parentId))].sort().join("|");

const FIELD_NAMES = [
  [["fn", "given", "family", "nickname"], "name"],
  [["org", "title"], "organization"],
  [["bday", "bdayNoYear", "anniversary", "anniversaryNoYear"], "dates"],
  [["phones"], "phone numbers"],
  [["emails"], "email addresses"],
  [["chats"], "chat addresses"],
  [["addresses"], "addresses"],
  [["urls"], "websites"],
  [["categories"], "labels"],
  [["note"], "notes"],
];

/** What differs between the copies, in words: ["phone numbers", "chat addresses"]. */
export function differences(cards) {
  const models = cards.map((c) => cardModel(c.vCard));
  const strip = (list) => (Array.isArray(list) ? list.map(({ at, ...rest }) => rest) : list);
  return FIELD_NAMES
    .filter(([keys]) => keys.some((k) => new Set(models.map((m) => JSON.stringify(strip(m[k])))).size > 1))
    .map(([, words]) => words);
}

/**
 * One card's vCard holding every copy's details: `keeperId`'s name,
 * single values and lines first (where a phone number is written two ways,
 * its way wins), every other value added, notes joined.
 */
export function combinedVCard(cards, keeperId) {
  if (cards.length < 2) {
    return cards[0].vCard;
  }
  const options = mergeOptions(cards);
  const keeper = cards.find((c) => c.id === keeperId) ?? cards[0];
  const pick = (values) => (values.find((v) => v.from === keeper.id) ?? values[0])?.text ?? "";
  const withParts = [keeper, ...cards].find((c) => c.nameParts.given || c.nameParts.family);
  const notes = [...new Set(options.notes.sort((a, b) => (a.from === keeper.id ? -1 : b.from === keeper.id ? 1 : 0)).map((n) => n.text))];
  return mergeVCard(cards, keeper.id, {
    name: keeper.name || options.names[0] || "",
    given: withParts?.nameParts.given ?? "",
    family: withParts?.nameParts.family ?? "",
    multi: Object.fromEntries(options.multi.map((f) => [f.name, f.values.map((v) => v.key)])),
    single: Object.fromEntries(options.single.map((f) => [f.name, pick(f.values)])),
    note: notes.join("\n\n"),
    photoFrom: options.photos.includes(keeper.id) ? keeper.id : options.photos[0] ?? null,
  });
}

/** A card's labels (CATEGORIES). */
export function labelsOf(vCard) {
  return getAll(parseVCard(vCard), "CATEGORIES")
    .flatMap((p) => p.value.split(/(?<!\\),/).map(unescapeText))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The vCard with these labels added (a label it has already, in any case, isn't added twice). */
export function addLabels(vCard, labels) {
  const have = labelsOf(vCard);
  const seen = new Set(have.map((l) => l.toLowerCase()));
  const added = [];
  for (const label of labels.map((l) => String(l).trim()).filter(Boolean)) {
    if (!seen.has(label.toLowerCase())) {
      seen.add(label.toLowerCase());
      added.push(label);
    }
  }
  if (!added.length) {
    return vCard;
  }
  const vcard = parseVCard(vCard);
  getAll(vcard, "CATEGORIES").forEach((p) => removeProp(vcard, p));
  insertProp(vcard, makeProp("CATEGORIES", [...have, ...added].map(escapeText).join(",")), "NOTE");
  return serializeVCard(vcard);
}

/**
 * The vCard with the label `from` (any case) renamed to `to`, or taken off
 * when `to` is empty. Unchanged when it doesn't have the label.
 */
export function renameLabel(vCard, from, to) {
  const have = labelsOf(vCard);
  const key = String(from).trim().toLowerCase();
  if (!have.some((l) => l.toLowerCase() === key)) {
    return vCard;
  }
  const kept = have.filter((l) => l.toLowerCase() !== key);
  const next = String(to ?? "").trim();
  const labels = next && !kept.some((l) => l.toLowerCase() === next.toLowerCase()) ? [...kept, next] : kept;
  const vcard = parseVCard(vCard);
  getAll(vcard, "CATEGORIES").forEach((p) => removeProp(vcard, p));
  if (labels.length) {
    insertProp(vcard, makeProp("CATEGORIES", labels.map(escapeText).join(",")), "NOTE");
  }
  return serializeVCard(vcard);
}

/**
 * What each copy becomes, by address book id, for history's "copies"
 * change: { want, label, linked } (linked: whether the copies are linked
 * afterwards). `action` is "link", "keep" or "separate"; `keeper` the card
 * whose details win (link) or that stays (keep); `labels` the labels the
 * kept card gets (keep).
 */
export function copiesPlan(group, action, { keeper = null, labels = [] } = {}) {
  const keeperId = keeper ?? group.cards[0].id;
  if (action === "separate") {
    return { want: {}, linked: false };
  }
  const combined = combinedVCard(group.cards, keeperId);
  if (action === "link") {
    return { want: Object.fromEntries(group.cards.map((c) => [c.parentId, combined])), linked: true };
  }
  const kept = group.cards.find((c) => c.id === keeperId);
  return {
    want: Object.fromEntries(group.cards.map((c) => [c.parentId, c === kept ? addLabels(combined, labels) : null])),
    linked: false,
  };
}

/* ---------- Links (kept in storage.local: [[card id, ...], ...]) ---------- */

/** The other cards linked with this one. */
export const partnersOf = (links, id) => (links.find((group) => group.includes(id)) ?? []).filter((x) => x !== id);

/** The links with a new group (any group these cards were in before is joined into it). */
export function addLink(links, ids) {
  const joined = new Set(ids);
  const rest = [];
  for (const group of links) {
    if (group.some((id) => joined.has(id))) {
      group.forEach((id) => joined.add(id));
    } else {
      rest.push(group);
    }
  }
  return joined.size > 1 ? [...rest, [...joined]] : rest;
}

/** The links without this card (a group left with one card goes). */
export const unlink = (links, id) => links.map((group) => group.filter((x) => x !== id)).filter((group) => group.length > 1);

/** The links with only cards that still exist (`exists(id)`). */
export const pruneLinks = (links, exists) => links.map((group) => group.filter(exists)).filter((group) => group.length > 1);

/**
 * A linked copy after an edit to its partner: the fields the contact editor
 * shows are made the same as the edited card's; everything else on the copy
 * (its UID, photo, custom fields) stays its own.
 */
export const followEdit = (copyVCard, editedVCard) => modelToVCard(copyVCard, cardModel(editedVCard));

/** Whether a linked copy already shows the same details as its partner (following it would change nothing). */
export const sameDetails = (copyVCard, partnerVCard) => comparable(followEdit(copyVCard, partnerVCard)) === comparable(copyVCard);
