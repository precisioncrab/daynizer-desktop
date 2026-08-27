Daynizer v0.5.0 — list management, contacts polish, and reliability fixes

This release adds proper list management (unlink vs. delete, with server-side deletion),
several contacts improvements, and a batch of sync-correctness and desktop-behavior fixes on
top of 0.4.0. Daynizer is still beta.

## Lists
- **Unlink vs. Delete.** The list right-click menu now has two clear actions. **Unlink** makes a
  linked list local-only — your tasks stay both on this computer and on the server, but that list
  stops syncing. **Delete** removes the list and its tasks from Daynizer, and from the server too
  when the list is linked. (On DAViCal-based servers, including Synology Calendar, the server
  rejects whole-calendar deletion — Daynizer deletes locally and tells you the server copy remains.)
- **Renames reach the server.** Renaming a list now pushes the new name to the server's calendar
  collection instead of staying local.

## Contacts
- **Anniversary** field added to the contact editor, alongside Birthday (with the same optional-year
  handling), and it syncs over CardDAV.
- **Contact avatars** — two-letter initials on a name-hued disc, or the contact's photo when present.
- The personal **email type** now reads "personal" instead of "home".
- **Merge duplicates** now confirms the merge and returns you to the contacts list; when several
  duplicate groups exist it keeps you on the duplicates list until you've resolved them all.
- Removed the contact **favorites/star** feature — Android/CardDAV has no representation for it, so
  it couldn't round-trip.

## Sync correctness
- **Deleted tasks no longer come back.** Fixed a case where deleting a task and syncing could
  re-create it (the pull loop ignored a soft-deleted row that hadn't pushed yet).
- **Subtasks created on the server** now stay nested when pulled, instead of occasionally orphaning
  to the top level.
- Fixed adding a category/tag to a task not always saving.
- Nextcloud fixes: a calendar-color crash, list-connect errors, and contacts that only had a display
  name (FN) now import correctly.

## Desktop behavior
- **One instance only.** Launching Daynizer a second time now focuses the existing window instead of
  starting a second process — two copies could contend on the shared database and freeze the UI.
- **Reminders bring the app forward.** Clicking a reminder notification (or the tray icon) now raises
  the window to the foreground and jumps to the item, even when the app was minimized or hidden.
- The UI stays responsive during large contact syncs.

## Calendar
- Recurring events and tasks now redraw immediately when you page to another month or switch views,
  instead of only appearing after you clicked one.
