Daynizer v0.7.0

Changes since v0.6.0. Daynizer remains beta, pre-1.0 — keep a backup of anything important.

## Sync reliability — subtasks, list moves, and colors

- **Subtasks always stay with their parent's list.** Adding a subtask right after moving its parent no longer strands it on the old list, and moving a task now cascades the change to its whole subtree — already-synced subtasks re-home correctly on the server instead of being left behind.
- **New tasks push with a stable identifier**, so subtask nesting no longer depends on sync order — a child synced before its parent still nests correctly.
- **List colour sync is more robust** against a server's address changing mid-session.

## Getting started with a brand-new server

- Create your first list/calendar directly on an **empty** CalDAV server — Daynizer asks the server for your calendar home instead of requiring an existing calendar to derive it from.
- Create address books on the server the same way, including **renaming** a server-side address book from within Daynizer.
- A brand-new account **auto-provisions a default Calendar and Contacts** if the server has none; existing servers with data are left untouched.
- Adding an account no longer freezes the form while Daynizer sets things up in the background.

## Accounts

- **Add an account faster:** paste a `caldav://user:pass@host/`-style pairing link into the new field on the Add Account form to fill in the CalDAV/CardDAV URL, username, and password in one go — useful with any tool that hands you one (see the standalone-server docs below).
- Clearer **"+ New list/calendar"** button label, and a sync marker next to server-linked address books when picking one for a contact.

## Self-hosting docs

- New [`server/standalone/`](https://github.com/precisioncrab/daynizer-desktop/tree/main/server/standalone) — a ready-to-run Docker Compose setup (Radicale behind Caddy for HTTPS) for anyone who wants a dedicated always-on CalDAV/CardDAV server on their own hardware (a Raspberry Pi, Proxmox, a NAS with Docker), including an offline, fully client-side phone-pairing QR-code generator.

## Notes

- This release does **not** include the built-in sync server that's been in development on a separate track — that work continues, aimed at a more thoroughly-tested future release rather than shipping half-proven. Nothing in this changelog depends on it.
- Bug reports and feature requests are welcome on the [issue tracker](https://github.com/precisioncrab/daynizer-desktop/issues) — bugs and feature requests now have separate templates there.
