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
 *   A mailing list: its members get the label; then they stay, or move
 *   into another address book like a whole book's contacts; the list can
 *   be deleted afterwards (Undo makes it again).
 * Daynizer: its own address books have no mailing lists (their lists are
 * empty); Thunderbird's books (add-on) have theirs, as in Contacts Cleanup.
 * Daynizer reaches its own copies directly; a contact in two of
 * Thunderbird's books with one ID goes through the "copies" change, since
 * Thunderbird lets add-ons reach one copy at a time.
 */

import { h, plural } from "../dom.js";
import { toolbar, row, emptyState } from "../parts.js";
import { openContextMenu } from "../context-menu.js";
import { label as cardLabel } from "../../core/card.js";
import { addLabels, combinedVCard } from "../../core/copies.js";
import { withoutUid } from "../../core/history.js";
import { comparable } from "../../core/vcard.js";

// Daynizer: a hidden book (a Thunderbird book with the same contacts as one of Daynizer's, or one
// hidden from the Contacts tab) isn't offered.
const writable = (ctx) => ctx.state.books.filter((b) => !b.readOnly && !b.remote && !b.hidden);
const bookName = (ctx, id) => ctx.state.books.find((b) => b.id === id)?.name ?? "";

/** A book's cards as the add-on reads them (with `shadowed` from the tab). */
const cardsIn = (ctx, bookId) => (ctx.state.allCards ?? []).filter((c) => c.parentId === bookId);

/** The labels from a book's mailing lists a card is in. */
const listLabels = (book, card) => (book.lists ?? []).filter((l) => l.members.includes(card.uid)).map((l) => l.name);

/** Every copy of a UID in a writable address book, by book id. */
function copiesOf(ctx, uid) {
  return (ctx.state.allCards ?? []).filter((c) => c.uid === uid);
}

/** Labels the cards where they are; a `shadowed` copy can't be changed, so it's counted in `skipped`. */
export function labelChanges(cards, labelsFor) {
  const changes = [];
  let skipped = 0;
  for (const card of cards) {
    const vCard = addLabels(card.vCard, labelsFor(card));
    if (comparable(vCard) === comparable(card.vCard)) {
      continue;
    }
    if (card.shadowed) {
      skipped++;
    } else {
      changes.push({ type: "update", id: card.id, vCard, label: cardLabel(card) });
    }
  }
  return { changes, skipped };
}

/**
 * Moves the cards into the `target` book with their labels: a contact that's
 * already there with the same contact ID is combined with that copy, the
 * others are made there with a new ID; the cards they came from are deleted.
 */
export function moveChanges(ctx, cards, target, labelsFor) {
  const changes = [];
  for (const card of cards) {
    const copies = copiesOf(ctx, card.uid);
    const name = cardLabel(card);
    const there = copies.find((c) => c.parentId === target);
    const tbCopies = copies.filter((c) => c.tb);
    if (card.tb && tbCopies.length > 1) {
      // In two of Thunderbird's books with one ID: Thunderbird reaches one copy at a time, so this
      // copy goes (and a copy in the target, if it's one of Thunderbird's, is combined) through the
      // "copies" change, as in Contacts Cleanup. A target copy of Daynizer's own is changed directly.
      const want = { [card.parentId]: null };
      if (there?.tb) {
        want[target] = addLabels(combinedVCard([there, card], there.id), labelsFor(card));
      } else if (there) {
        changes.push({ type: "update", id: there.id, vCard: addLabels(combinedVCard([there, card], there.id), labelsFor(card)), label: name });
      } else {
        changes.push({ type: "create", parentId: target, vCard: withoutUid(addLabels(card.vCard, labelsFor(card))), label: name });
      }
      changes.push({ type: "copies", uid: card.uid, books: [...new Set(tbCopies.map((c) => c.parentId))], want, label: name });
      continue;
    }
    if (there) {
      // Already in the target with this ID: that copy gets this one's details and the labels; this one goes.
      // (Daynizer reaches both copies directly here, so no "copies" change is needed.)
      changes.push({ type: "update", id: there.id, vCard: addLabels(combinedVCard([there, card], there.id), labelsFor(card)), label: name });
    } else {
      changes.push({ type: "create", parentId: target, vCard: withoutUid(addLabels(card.vCard, labelsFor(card))), label: name });
    }
    changes.push({ type: "delete", id: card.id, label: name });
  }
  return changes;
}

/** "Then:" leave the contacts, or move them into another address book (`pick.move`, `pick.target`). */
function afterChoice(pick, leaveText, others) {
  return [
    h("p", {}, "Then:"),
    h("label", { class: "choice" }, h("input", { type: "radio", name: "after", checked: true, onChange: () => {
      pick.move = false;
    } }), leaveText),
    others.length
      ? h("label", { class: "choice" }, h("input", { type: "radio", name: "after", onChange: () => {
        pick.move = true;
      } }), "Move them into ",
      h("select", { onChange: (e) => {
        pick.target = e.target.value;
      } }, others.map((b) => h("option", { value: b.id }, b.name))))
      : null,
  ];
}

async function bookToLabel(ctx, book) {
  const others = writable(ctx).filter((b) => b.id !== book.id);
  const pick = { label: book.labelName ?? book.name, move: false, target: others[0]?.id ?? null, lists: true, deleteBook: false };
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
      ...afterChoice(pick, `Leave the contacts in ${book.name}`, others),
      book.thunderbird && others.length
        ? h("label", { class: "choice", style: { marginLeft: "22px" } }, h("input", { type: "checkbox", onChange: (e) => {
          pick.deleteBook = e.target.checked;
        } }), `When moving: then delete ${book.name}, once it's empty. That part can't be undone, and Undo can't put the contacts back into it either.`)
        : null,
      h("p", { class: "hint" }, book.thunderbird
        ? `Moving: a contact that's already in that address book with the same contact ID is combined with that copy instead of copied twice. Moved contacts leave ${book.name}'s mailing lists (the labels keep the grouping); the emptied address book and its lists stay unless you tick the box above (or right-click the address book in the sidebar later).`
        : `Moving: a contact that's already in that address book with the same contact ID is combined with that copy instead of copied twice. ${book.name} stays, empty, until you delete it (right-click it under Address books).`),
      h("p", { class: "hint" }, "Undo (the message after, or Changes) puts it all back."),
    ],
    ok: "Make the label",
  });
  if (!go || !pick.label.trim()) {
    return;
  }
  const labelsFor = (card) => [pick.label.trim(), ...(pick.lists ? listLabels(book, card) : [])];
  const { changes, skipped } = pick.move
    ? { changes: moveChanges(ctx, cardsIn(ctx, book.id), pick.target, labelsFor), skipped: 0 }
    : labelChanges(cardsIn(ctx, book.id), labelsFor);
  if (!changes.length) {
    ctx.toast(skipped ? `Nothing labeled: ${plural(skipped, "contact shares", "contacts share")} a contact ID with another address book. Sort them out under In several books first.` : `Every contact in ${book.name} has that label already.`, { error: Boolean(skipped) });
    return;
  }
  const entry = await ctx.apply(pick.move
    ? `Moved ${book.name} into ${bookName(ctx, pick.target)} with the label ${pick.label.trim()}`
    : `Labeled ${book.name}'s contacts ${pick.label.trim()}`, changes);
  if (entry && pick.move && pick.deleteBook) {
    // Only an address book the move emptied goes (a contact that couldn't be moved keeps it).
    const now = ctx.state.books.find((b) => b.id === book.id);
    // When the move stopped partway, ctx.apply's message says why; it stays on screen.
    if (now && !now.contacts.length) {
      await ctx.deleteBook(now, { asked: true });
    }
  }
  if (entry && skipped) {
    ctx.toast(`Done, except ${plural(skipped, "contact", "contacts")} that share a contact ID with another address book. Sort them out under In several books, then make the label again.`);
  }
}

async function listToLabel(ctx, book, list) {
  const others = writable(ctx).filter((b) => b.id !== book.id);
  // after: "keep" (members stay, the list too), "delete" (members stay, the list goes) or "move" (into `target`; the list goes).
  const pick = { label: list.name, after: "keep", target: others[0]?.id ?? null };
  const choice = (after, ...text) => h("label", { class: "choice" }, h("input", { type: "radio", name: "after", checked: after === "keep", onChange: () => {
    pick.after = after;
  } }), ...text);
  const members = cardsIn(ctx, book.id).filter((c) => list.members.includes(c.uid));
  const go = await ctx.confirm({
    title: `Make the list ${list.name} a label?`,
    body: [
      h("p", {}, `Its ${plural(members.length, "member", "members")} in ${book.name} get the label:`),
      h("input", { type: "text", style: { width: "100%" }, value: pick.label, onInput: (e) => {
        pick.label = e.target.value;
      } }),
      h("p", {}, "Then:"),
      choice("keep", `Leave them in ${book.name}, and keep the list`),
      choice("delete", `Leave them in ${book.name}, and delete the list (only the list goes, never its contacts)`),
      others.length
        ? choice("move", "Move them into ", h("select", { onChange: (e) => {
          pick.target = e.target.value;
        } }, others.map((b) => h("option", { value: b.id }, b.name))), " and delete the list")
        : null,
      h("p", { class: "hint" }, `Moving: each member is made in the address book you pick, with the label (and the names of ${book.name}'s other mailing lists it's in, as labels), and taken out of ${book.name}. A contact that's already there with the same contact ID is combined with that copy instead of copied twice.`),
      h("p", { class: "hint" }, "Undo (the message after, or Changes) puts it all back: the contacts where they were, the list with its members."),
    ],
    ok: "Make the label",
  });
  if (!go || !pick.label.trim()) {
    return;
  }
  const move = pick.after === "move" && Boolean(pick.target);
  const remove = pick.after !== "keep";
  const labelsFor = (card) => [...new Set([pick.label.trim(), ...(move ? listLabels(book, card) : [])])];
  const { changes, skipped } = move
    ? { changes: moveChanges(ctx, members, pick.target, labelsFor), skipped: 0 }
    : labelChanges(members, labelsFor);
  if (remove) {
    changes.push({ type: "deleteList", listId: list.id, label: list.name });
  }
  if (!changes.length) {
    ctx.toast(skipped ? `Nothing labeled: ${plural(skipped, "member shares", "members share")} a contact ID with another address book. Sort them out under In several books first.` : `Every member has that label already.`, { error: Boolean(skipped) });
    return;
  }
  const done = move
    ? `Moved the list ${list.name}'s members into ${bookName(ctx, pick.target)} with the label ${pick.label.trim()}`
    : `Labeled the list ${list.name}'s members ${pick.label.trim()}`;
  const entry = await ctx.apply(`${done}${remove ? " and deleted the list" : ""}`, changes);
  if (entry && skipped) {
    ctx.toast(`Done, except ${plural(skipped, "member", "members")} that share a contact ID with another address book. Sort them out under In several books, then make the label again.`);
  }
}

/** Right-click on a mailing list: rename it, or delete it. */
function listMenu(ctx, e, book, list) {
  openContextMenu(e, [
    { label: "Rename…", disabled: Boolean(ctx.state.busy), onClick: async () => {
      const name = await ctx.askName({ title: `Rename the list ${list.name}`, value: list.name });
      if (name) {
        await ctx.renameList(list, name);
      }
    } },
    { label: "Make a label…", disabled: Boolean(ctx.state.busy) || !list.members.length, onClick: () => listToLabel(ctx, book, list) },
    { separator: true },
    { label: "Delete mailing list…", danger: true, disabled: Boolean(ctx.state.busy), onClick: () => deleteList(ctx, book, list) },
  ]);
}

/** Deletes a mailing list after asking (its contacts stay; Undo makes it again with its members). */
async function deleteList(ctx, book, list) {
  const go = await ctx.confirm({
    title: `Delete the mailing list ${list.name}?`,
    body: [h("p", {}, `Only the list goes: its ${plural(list.members.length, "member stays", "members stay")} in ${book.name}. Undo (the message after, or Changes) makes it again with its members.`)],
    ok: "Delete",
    danger: true,
  });
  if (go) {
    await ctx.apply(`Deleted the mailing list ${list.name}`, [{ type: "deleteList", listId: list.id, label: list.name }]);
  }
}

export default {
  id: "labels",
  title: "Lists to labels",
  dot: "#5aa0c8",

  count: () => null,

  main(ctx) {
    const books = writable(ctx);
    const anyLists = books.some((b) => b.lists?.length);
    const rows = books.flatMap((book) => [
      { key: `book:${book.id}`, book, list: null },
      ...(book.lists ?? []).map((list) => ({ key: `list:${list.id}`, book, list })),
    ]);
    return [
      toolbar(ctx, { title: anyLists ? "Address books and mailing lists to labels" : "Address books to labels", search: false }),
      h("div", { class: "toolbar-filters" }, h("span", {}, anyLists
        ? "A label stays with a contact wherever it goes, and syncs with it (CardDAV, Google; phones show labels as groups). An address book or mailing list only holds contacts of its own book. Right-click a mailing list to rename or delete it."
        : "A label stays with a contact wherever it goes, and syncs with it (CardDAV; phones show labels as groups). An address book only holds its own contacts.")),
      h("div", { class: "list", "data-scroll": "labels" },
        rows.length
          ? rows.map(({ key, book, list }) => row(ctx, {
            key,
            title: list ? list.name : book.name,
            meta: list
              ? [h("span", {}, `mailing list in ${book.name}`), h("span", {}, plural(list.members.length, "member", "members"))]
              : [h("span", {}, "address book"), h("span", {}, plural(book.contacts.length, "contact", "contacts")), book.lists?.length ? h("span", {}, plural(book.lists.length, "mailing list", "mailing lists")) : null],
            actions: [h("button", { disabled: Boolean(ctx.state.busy) || (list ? !list.members.length : !book.contacts.length), onClick: () => (list ? listToLabel(ctx, book, list) : bookToLabel(ctx, book)) }, "Make a label…")],
            onContextMenu: list ? (e) => listMenu(ctx, e, book, list) : null,
          }))
          : emptyState("No address books to change.", "")),
    ];
  },

  detail(ctx) {
    const anyLists = writable(ctx).some((b) => b.lists?.length);
    return [
      h("h3", {}, "Lists to labels"),
      h("p", {}, anyLists
        ? "Makes an address book or a mailing list a label on its contacts (Labels in the sidebar, and in each contact's editor)."
        : "Makes an address book a label on its contacts (Labels in the sidebar, and in each contact's editor)."),
      h("h4", {}, "An address book"),
      h("p", {}, "Every contact in it gets the label. Then they stay where they are, or move into another address book: one that's already there with the same contact ID is combined with that copy, not copied twice."),
      ...(anyLists ? [
        h("h4", {}, "A mailing list (Thunderbird's address books)"),
        h("p", {}, "Its members get the label. The list can be deleted afterwards: a mailing list only points at contacts in its address book, so deleting it leaves every contact where it is, now with the label."),
        h("p", {}, "Contacts that share a contact ID with another address book can't be changed here until they're sorted out under In several books."),
      ] : []),
      h("p", {}, anyLists ? "Undo puts it all back, mailing lists included." : "Undo puts it all back."),
    ];
  },
};
