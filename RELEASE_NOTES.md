Daynizer v1.0.0 — the rebrand, calendar events, and reliability release

The app formerly known as Tasks Desktop is now **Daynizer**. This release adds two-way
calendar event sync, recurring events, app-wide undo, a redesigned Settings, and a batch of
sync-reliability fixes — on top of the contacts support introduced in 0.3.0.

## New name: Daynizer
- Tasks Desktop is now Daynizer. This is a name change only — your data, accounts, and sync
  are unchanged. Existing installs keep working and stay connected to the same server.

## Calendar events (CalDAV) — new
- Two-way event sync: create, edit, and delete calendar events and have them sync with your
  CalDAV server alongside tasks and contacts.
- Recurring events display across the calendar, and whole-series ("all events") edits sync
  reliably.
- Per-event reminders (VALARM) and all-day / multi-day events.

## Undo
- One-level undo (Ctrl/Cmd+Z, or Edit ▸ Undo) across tasks and events — reverses your last
  create, edit, delete, complete, or reschedule.

## Subtasks
- Collapse and expand subtasks in the task list; subtask parent relationships now round-trip
  correctly over sync (RELATED-TO).

## Settings, redesigned
- Settings is organized into left-nav panes (Accounts, Calendars & Lists, Contacts, Sync,
  Notifications & Startup) instead of one long scrolling column.
- Choose a default list for new tasks and a default calendar for new events.

## Sync reliability
- Prompt to sync on close when you have unsynced changes.
- Fixes for edits getting "wedged" by etag mismatches, and steadier handling of conflicting
  server changes.
- Self-signed HTTPS support and the duplicate-list cleanup from 0.3.0 are still here.

## Contacts
- Delete a label (category) across all contacts and sync the change; per-label colors; merge
  duplicates; favorites.
