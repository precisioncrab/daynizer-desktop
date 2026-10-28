# Contacts Cleanup inside Daynizer

This folder is Contacts Cleanup's code (`Projects/Contacts-Cleanup/contacts-cleanup/src/`, MPL-2.0,
same author), copied at its commit `f30926c` (test build 0.1.21) on 2026-10-24. A fix in one should be
copied to the other.

**Copied unchanged:** `core/*.js`, `ui/dom.js`, `ui/parts.js`, `ui/merge-fields.js`, `ui/omemo-state.js`,
`ui/views/duplicates.js`, `lib/omemo.js`. Contacts Cleanup's tests (`npm test` there) cover `core/`.

**Copied with Daynizer changes** (search for "Daynizer" in them):
- `ui/contact-panel.js`: neutral wording; the OMEMO hint only in the add-on, its "get OMEMO" link only
  where `ctx.host.omemoPromo`. (Until the add-on's Manifest V2 move, 0.9.0, it also locked Thunderbird's
  contacts, `card.tb`; that's gone, so Save and Delete match Contacts Cleanup again.)
- `ui/views/copies.js`: Daynizer's own copies get plain update/create/delete changes (Daynizer reaches
  every copy); Thunderbird's (add-on) keep Contacts Cleanup's "copies" change, mailing lists and wording;
  Daynizer's and Thunderbird's books compared each among themselves.
- `ui/views/labels.js`: Daynizer's own books have no mailing lists (moving one is create + delete); Thunderbird's books (add-on) keep Contacts Cleanup's mailing lists, its wording for them, and its "copies" change for a contact in two of their books with one ID.
- `ui/views/chat.js`: Chat list tab only in the add-on (`chatListShown`), OMEMO offers only with
  `omemoPromo`, wording.
- `ui/views/history.js`, `names.js`, `phones.js`: one help sentence each.

**Daynizer's own:** `controller.js` (in place of `ui/tab.js`: no sidebar, menus or theme, drawn into
the Contacts tab; like `ui/tab.js`'s `recompute`, proposes nothing for a `shadowed` copy), `lib/addressbook.js` (Daynizer's contacts as whole vCards over `window.api.contacts`; Thunderbird's own, add-on only, through the same calls, with the `shadowed` copies marked as Contacts Cleanup's `markShadowed` does and Thunderbird's photos read and put back),
`lib/links.js`, `lib/store.js` (IndexedDB in place of `storage.local`), `cleanup.css` (generated from
`ui/tab.css`, scoped under `.cleanup`).

**Changed in both on 2026-10-27:** Lists to labels' mailing-list dialog has the same "Then:" as an address
book (leave the members, or move them into another address book; Contacts Cleanup `7cb92b6`), through
`labelChanges` and `moveChanges` (each file keeps its own move rules above). Then (`0e7911b`): its "Then:" is
keep the list, delete it, or move the members and delete it; right-click a mailing list row to delete it
(`row()` in `ui/parts.js` takes `onContextMenu`, still identical in both). Then (Contacts Cleanup 0.1.23): `core/history.js`
(still identical) has `missingBooks`, so Undo refuses when an address book it would put contacts back into is gone;
both `lib/addressbook.js` have `bookExists` and `deleteBook`; both tabs have `ctx.deleteBook` (asks, can't be undone),
used after a move in Lists to labels and by right-click on an address book (Contacts Cleanup's sidebar; Daynizer's
React sidebar, Thunderbird's books only). Daynizer only: a hidden Thunderbird book (same contacts as one of
Daynizer's) stays in `state.books`/`allCards` marked `hidden`; `excludedBooks()` always leaves it out and Lists to
labels doesn't list it, so a copy in it still counts for In several books and moves. In several books' top box follows
the selected contact in both (Contacts Cleanup 0.1.24, `234b29b`).

**Changed in both on 2026-10-27 (Contacts Cleanup 0.1.25, `e85475e`):** new `ui/context-menu.js` (copied
unchanged; Daynizer's `styles.css` `.context-menu` gained its separator, disabled and color-dot rules) and
`core/copies.js` `renameLabel`. Lists to labels: right-click a mailing list for Rename…, Make a label…, Delete
mailing list… (`listMenu`), through `ctx.askName` and `ctx.renameList` (both tabs) and `api.renameList` (both
`lib/addressbook.js`). Hiding: Contacts Cleanup keeps `settings.hiddenBooks`/`hiddenLabels` and marks hidden books
`hidden` in `narrowCards()`; Daynizer keeps them in `src/contactsHidden.ts` and `lib/addressbook.js` marks its own and
Thunderbird's hidden books `hidden`, so `excludedBooks()` and Lists to labels' `writable` leave them out in both.
The sidebars themselves (Contacts Cleanup's `ui/tab.js`, Daynizer's React `ContactsSidebar.tsx`) each got the same
right-click menus: address books Rename, color, Hide, Delete; labels Rename, color, Hide, Delete.

**Changed on 2026-10-28 (Contacts Cleanup 0.1.27, `8855bbf`):** `core/copies.js` and `ui/views/copies.js` say "edited
separately" (was "edited apart"), in both. Contacts Cleanup's `core/history.js` gained a `createBook` change (an import
into a new address book) that Daynizer's copy doesn't have: Daynizer's import doesn't go through the history (its own
`ImportVCardModal`, which got the same new-book and label choices). The list page and the contact right-click are
Daynizer's own React (`components/MailingListView.tsx`, `contactMenuItems` in `App.tsx`), written to match
Contacts Cleanup's `listPage` and `contactMenu`; list changes go through `ctx.apply` (`listMember`, undo).

**Changed in both on 2026-10-28 (Contacts Cleanup 0.1.26, `d74abd3`):** `core/history.js` (copied unchanged) has the
`createList` and `listMember` changes with undo (`entry.madeLists`, `entry.members`) and `entryChanged`; both
`lib/addressbook.js` have `removeFromList` (Daynizer's through `removeFromThunderbirdList`). `ui/contact-panel.js` has
a Mailing lists field (Daynizer: only for Thunderbird's books, "tb:" ids). `ui/views/copies.js` keeps what was applied
on the page with Undo (`state.copiesDone`, cleared when the page changes; Daynizer's hint worded for both kinds of
copies). `ui/views/labels.js` exports `listToLabel` and `deleteList`, and its `listMenu` has "New message to this
list" (`ctx.writeTo`, `compose.beginNew`). Both tabs: `ctx.writeTo`, `apply` records an entry that changed only
mailing lists. The sidebars (Contacts Cleanup's `ui/tab.js`, Daynizer's React `ContactsSidebar.tsx`) show each
address book's mailing lists under it (click shows the members; Daynizer's through `ContactFilter` kind "list" and
`ListMembers`), New mailing list… on a book's right-click (Daynizer: the controller's `newMailingList`), the list's
menu, and New message to everyone with a label (Daynizer: add-on only). Daynizer's own editor
(`ContactDetailPanel.tsx`) has the same Mailing lists field for Thunderbird contacts (ticks saved after the card).
Contacts Cleanup's Ctrl+Z change isn't copied (Daynizer dropped Ctrl+Z after a clean-up change, 2026-10-27).

**Changed in both on 2026-10-26 (not yet in a Contacts Cleanup build):** the "include" checkboxes on
address books are gone; the clean-up tools work on the address books selected in the sidebar (click one,
Ctrl+click for several, none = all). The pages ask `ctx.excludedBooks()` instead of reading
`settings.excludedBooks`, so `contact-panel.js`, `chat.js` and `copies.js` change the same way in both.
The Chat page's Show filter gained "With a chat address" in both.

**Not copied:** `ui/tab.js`, `menu.js`, `theme*.js`, `ui/views/contacts.js` and `about.js` (Daynizer
has its own contact list, editor and About), `lib/addressbook.js` (Thunderbird's address books).
