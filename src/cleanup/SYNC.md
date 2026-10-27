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
- `ui/views/copies.js`: plain update/create/delete changes (Daynizer reaches every copy), no mailing
  lists, Daynizer's and Thunderbird's books compared each among themselves, wording.
- `ui/views/labels.js`: no mailing lists (moving a book is create + delete), wording.
- `ui/views/chat.js`: Chat list tab only in the add-on (`chatListShown`), OMEMO offers only with
  `omemoPromo`, wording.
- `ui/views/history.js`, `names.js`, `phones.js`: one help sentence each.

**Daynizer's own:** `controller.js` (in place of `ui/tab.js`: no sidebar, menus or theme, drawn into
the Contacts tab; like `ui/tab.js`'s `recompute`, proposes nothing for a `shadowed` copy), `lib/addressbook.js` (Daynizer's contacts as whole vCards over `window.api.contacts`; Thunderbird's own, add-on only, through the same calls, with the `shadowed` copies marked as Contacts Cleanup's `markShadowed` does and Thunderbird's photos read and put back),
`lib/links.js`, `lib/store.js` (IndexedDB in place of `storage.local`), `cleanup.css` (generated from
`ui/tab.css`, scoped under `.cleanup`).

**Changed in both on 2026-10-26 (not yet in a Contacts Cleanup build):** the "include" checkboxes on
address books are gone; the clean-up tools work on the address books selected in the sidebar (click one,
Ctrl+click for several, none = all). The pages ask `ctx.excludedBooks()` instead of reading
`settings.excludedBooks`, so `contact-panel.js`, `chat.js` and `copies.js` change the same way in both.
The Chat page's Show filter gained "With a chat address" in both.

**Not copied:** `ui/tab.js`, `menu.js`, `theme*.js`, `ui/views/contacts.js` and `about.js` (Daynizer
has its own contact list, editor and About), `lib/addressbook.js` (Thunderbird's address books).
