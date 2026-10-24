/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Lists to labels: an address book or a mailing list becomes a label
 * (vCard CATEGORIES) on its contacts. Labels travel with a contact
 * (CardDAV and Google sync them; phones show them as groups), where a
 * Thunderbird address book or mailing list only holds contacts of its own
 * book.
 *   An address book: every contact in it gets the label; then they stay,
 *   or move into another address book (a contact already there with the
 *   same contact ID is combined with that copy rather than copied twice).
 *   Its mailing lists can become labels too.
 *   A mailing list: its members get the label; the list can be deleted
 *   afterwards (Undo makes it again).
 * Daynizer has no mailing lists (its address books' lists are empty), so
 * only address books show here.
 */

import { h, plural } from "../dom.js";
import { toolbar, row, emptyState } from "../parts.js";
import { label as cardLabel } from "../../core/card.js";
import { addLabels, combinedVCard } from "../../core/copies.js";
import { withoutUid } from "../../core/history.js";
import { comparable } from "../../core/vcard.js";

const writable = (ctx) => ctx.state.books.filter((b) => !b.readOnly && !b.remote);
const bookName = (ctx, id) => ctx.state.books.find((b) => b.id === id)?.name ?? "";

/** A book's cards as the add-on reads them (with `shadowed` from the tab). */
const cardsIn = (ctx, bookId) => (ctx.state.allCards ?? []).filter((c) => c.parentId === bookId);

/** The labels from a book's mailing lists a card is in. */
const listLabels = (book, card) => (book.lists ?? []).filter((l) => l.members.includes(card.uid)).map((l) => l.name);

/** Every copy of a UID in a writable address book, by book id. */
function copiesOf(ctx, uid) {
  return (ctx.state.allCards ?? []).filter((c) => c.uid === uid);
}

async function bookToLabel(ctx, book) {
  const others = writable(ctx).filter((b) => b.id !== book.id);
  const pick = { label: book.name, move: false, target: others[0]?.id ?? null, lists: true };
  const go = await ctx.confirm({
    title: `Make ${book.name} a label?`,
    body: [
      h("p", {}, `Every contact in ${book.name} (${book.contacts.length}) gets the label:`),
      h("input", { type: "text", style: { width: "100%" }, value: pick.label, onInput: (e) => {
        pick.label = e.target.value;
      } }),
      book.lists?.length
        ? h("label", { class: "choice" }, h("input", { type: "checkbox", checked: true, onChange: (e) => {
          pick.lists = e.target.checked;
        } }), `Also label the members of its mailing lists with the list's name (${book.lists.map((l) => l.name).join(", ")})`)
        : null,
      h("p", {}, "Then:"),
      h("label", { class: "choice" }, h("input", { type: "radio", name: "after", checked: true, onChange: () => {
        pick.move = false;
      } }), `Leave the contacts in ${book.name}`),
      others.length
        ? h("label", { class: "choice" }, h("input", { type: "radio", name: "after", onChange: () => {
          pick.move = true;
        } }), "Move them into ",
        h("select", { onChange: (e) => {
          pick.target = e.target.value;
        } }, others.map((b) => h("option", { value: b.id }, b.name))))
        : null,
      h("p", { class: "hint" }, `Moving: a contact that's already in that address book with the same contact ID is combined with that copy instead of copied twice. ${book.name} stays, empty, until you delete it (right-click it under Address books).`),
      h("p", { class: "hint" }, "Undo (the message after, or Changes) puts it all back."),
    ],
    ok: "Make the label",
  });
  if (!go || !pick.label.trim()) {
    return;
  }
  const labelsFor = (card) => [pick.label.trim(), ...(pick.lists ? listLabels(book, card) : [])];
  const changes = [];
  let skipped = 0;
  for (const card of cardsIn(ctx, book.id)) {
    const copies = copiesOf(ctx, card.uid);
    const name = cardLabel(card);
    if (!pick.move) {
      const vCard = addLabels(card.vCard, labelsFor(card));
      if (card.shadowed) {
        skipped += comparable(vCard) !== comparable(card.vCard) ? 1 : 0;
      } else if (comparable(vCard) !== comparable(card.vCard)) {
        changes.push({ type: "update", id: card.id, vCard, label: name });
      }
      continue;
    }
    const there = copies.find((c) => c.parentId === pick.target);
    if (there) {
      // Already in the target with this ID: that copy gets this one's details and the labels; this one goes.
      // (Daynizer reaches both copies directly, so no "copies" change is needed.)
      const both = [there, card];
      changes.push({ type: "update", id: there.id, vCard: addLabels(combinedVCard(both, there.id), labelsFor(card)), label: name });
      changes.push({ type: "delete", id: card.id, label: name });
    } else {
      changes.push({ type: "create", parentId: pick.target, vCard: withoutUid(addLabels(card.vCard, labelsFor(card))), label: name });
      changes.push({ type: "delete", id: card.id, label: name });
    }
  }
  if (!changes.length) {
    ctx.toast(skipped ? `Nothing labeled: ${plural(skipped, "contact shares", "contacts share")} a contact ID with another address book. Sort them out under In several books first.` : `Every contact in ${book.name} has that label already.`, { error: Boolean(skipped) });
    return;
  }
  const entry = await ctx.apply(pick.move
    ? `Moved ${book.name} into ${bookName(ctx, pick.target)} with the label ${pick.label.trim()}`
    : `Labeled ${book.name}'s contacts ${pick.label.trim()}`, changes);
  if (entry && skipped) {
    ctx.toast(`Done, except ${plural(skipped, "contact", "contacts")} that share a contact ID with another address book. Sort them out under In several books, then make the label again.`);
  }
}

async function listToLabel(ctx, book, list) {
  const pick = { label: list.name, remove: false };
  const members = cardsIn(ctx, book.id).filter((c) => list.members.includes(c.uid));
  const go = await ctx.confirm({
    title: `Make the list ${list.name} a label?`,
    body: [
      h("p", {}, `Its ${plural(members.length, "member", "members")} in ${book.name} get the label:`),
      h("input", { type: "text", style: { width: "100%" }, value: pick.label, onInput: (e) => {
        pick.label = e.target.value;
      } }),
      h("label", { class: "choice" }, h("input", { type: "checkbox", onChange: (e) => {
        pick.remove = e.target.checked;
      } }), "Then delete the mailing list (the contacts stay)"),
      h("p", { class: "hint" }, "Undo (the message after, or Changes) takes the label off and makes the list again with its members."),
    ],
    ok: "Make the label",
  });
  if (!go || !pick.label.trim()) {
    return;
  }
  const changes = [];
  let skipped = 0;
  for (const card of members) {
    const vCard = addLabels(card.vCard, [pick.label.trim()]);
    if (comparable(vCard) === comparable(card.vCard)) {
      continue;
    }
    if (card.shadowed) {
      skipped++;
    } else {
      changes.push({ type: "update", id: card.id, vCard, label: cardLabel(card) });
    }
  }
  if (pick.remove) {
    changes.push({ type: "deleteList", listId: list.id, label: list.name });
  }
  if (!changes.length) {
    ctx.toast(skipped ? `Nothing labeled: ${plural(skipped, "member shares", "members share")} a contact ID with another address book. Sort them out under In several books first.` : `Every member has that label already.`, { error: Boolean(skipped) });
    return;
  }
  const entry = await ctx.apply(`Labeled the list ${list.name}'s members ${pick.label.trim()}${pick.remove ? " and deleted the list" : ""}`, changes);
  if (entry && skipped) {
    ctx.toast(`Done, except ${plural(skipped, "member", "members")} that share a contact ID with another address book. Sort them out under In several books, then make the label again.`);
  }
}

export default {
  id: "labels",
  title: "Lists to labels",
  dot: "#5aa0c8",

  count: () => null,

  main(ctx) {
    const books = writable(ctx);
    const rows = books.flatMap((book) => [
      { key: `book:${book.id}`, book, list: null },
      ...(book.lists ?? []).map((list) => ({ key: `list:${list.id}`, book, list })),
    ]);
    return [
      toolbar(ctx, { title: "Address books to labels", search: false }),
      h("div", { class: "toolbar-filters" }, h("span", {}, "A label stays with a contact wherever it goes, and syncs with it (CardDAV; phones show labels as groups). An address book only holds its own contacts.")),
      h("div", { class: "list", "data-scroll": "labels" },
        rows.length
          ? rows.map(({ key, book, list }) => row(ctx, {
            key,
            title: list ? list.name : book.name,
            meta: list
              ? [h("span", {}, `mailing list in ${book.name}`), h("span", {}, plural(list.members.length, "member", "members"))]
              : [h("span", {}, "address book"), h("span", {}, plural(book.contacts.length, "contact", "contacts")), book.lists?.length ? h("span", {}, plural(book.lists.length, "mailing list", "mailing lists")) : null],
            actions: [h("button", { disabled: Boolean(ctx.state.busy) || (list ? !list.members.length : !book.contacts.length), onClick: () => (list ? listToLabel(ctx, book, list) : bookToLabel(ctx, book)) }, "Make a label…")],
          }))
          : emptyState("No address books to change.", "")),
    ];
  },

  detail() {
    return [
      h("h3", {}, "Lists to labels"),
      h("p", {}, "Makes an address book a label on its contacts (Labels in the sidebar, and in each contact's editor)."),
      h("h4", {}, "An address book"),
      h("p", {}, "Every contact in it gets the label. Then they stay where they are, or move into another address book: one that's already there with the same contact ID is combined with that copy, not copied twice."),
      h("p", {}, "Undo puts it all back."),
    ];
  },
};
