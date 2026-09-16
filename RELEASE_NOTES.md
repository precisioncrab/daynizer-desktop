## Unreleased (staged on `experimental` since v0.8.2, no version number assigned)

- **A simple way to schedule "the first Saturday of every month" style events** — Repeats now has a
  "Monthly (specific weekday)" option with plain position/weekday dropdowns (First/Second/Third/
  Fourth/Last, Sunday-Saturday), instead of needing to know RRULE syntax. Custom RRULE is still there
  for anything this doesn't cover.

---

Daynizer v0.8.2

Changes since v0.8.1. Daynizer remains beta, pre-1.0 — keep a backup of anything important.

- **Deleting an address book now also removes it from the server**, when the book is linked to one
  (matching how deleting a calendar/task list already worked). If the server refuses the collection
  delete (some DAViCal/Synology setups return 405), the book is still removed here and you get a
  specific message saying the server copy is still there, instead of a generic warning that always
  showed up before regardless of whether a server was even involved.
- Installers and the About dialog now say "Precision Crab" instead of "Arlis" for the
  publisher/copyright line.

---

Daynizer v0.8.1

Changes since v0.8.0. Daynizer remains beta, pre-1.0 — keep a backup of anything important.

- **Locale-aware calendar and dates** (community contribution, PR #4 by DrStrangeloovee). The
  calendar week now starts on the correct day for your region instead of always Sunday, and fixes
  a real bug: a date-only task due "today" could show as due *yesterday* and get marked overdue,
  in any timezone west of UTC.
- **Manual override for the week-start day** — Settings → Calendars & Lists → "First day of the
  week" lets you pick a specific day instead of following your OS's region automatically. Takes
  effect as soon as you close Settings, no restart needed.
- **Fixed the in-app "Full connection guide" link** (Settings → Sync Server) and the equivalent
  links in the README and GitHub issue template — they pointed at a URL that didn't match where
  the guide is actually published.

---

Daynizer v0.8.0 — built-in sync server

Changes since v0.7.0. Daynizer remains beta, pre-1.0 — keep a backup of anything important.

## Built-in sync server — new, on by default, fully optional

Don't have a CalDAV/CardDAV server? Daynizer can now host its own — a bundled, zero-config
CalDAV/CardDAV server that Daynizer runs and supervises for you, so your tasks, calendar, and
contacts sync across your devices **without a third-party account** (Synology, Nextcloud, a NAS, or
any cloud).

- **Optional — you don't have to use it.** It's on out of the box so sync works with zero setup, but
  you can turn it off in **Settings → Sync Server** any time and point Daynizer at your own
  CalDAV/CardDAV server instead.
- **Nothing to configure.** On first run Daynizer creates its own "Built-in server" account with a
  default Calendar and Contacts, and the server just runs.
- **Runs in the background.** It starts with Daynizer, keeps running in the tray when you close the
  window, and can start hidden at login. The tray shows when a device last synced.
- **Works with any client** — it speaks standard CalDAV/CardDAV, so DAVx5, Tasks.org, Apple Calendar,
  and Thunderbird all connect to it.
- **Secure by default (HTTPS).** Self-signed TLS, so Tasks.org's direct CalDAV — which refuses plain
  HTTP on modern Android — connects over `caldavs://`. You approve the certificate once.
- **QR pairing.** Settings → Sync Server shows a QR code — scan it with DAVx5 on Android and your
  phone is connected, then add Tasks.org (or OpenTasks) for the task lists.
- **Windows Firewall helper.** A one-click button opens your firewall so other devices on your Wi-Fi
  can reach the server.
- **Add another Daynizer fast:** paste a pairing link into the new "Have a pairing link?" field on
  the Add Account form to fill in the address, username, and password in one go.

**Not included in the Thunderbird add-on.** The add-on has no server component on any platform,
regardless of this flag — it stays a pure CalDAV/CardDAV client, same as before.

## Platform notes

- **Windows, Linux, and macOS (both Apple Silicon and Intel)** all ship the server in this release.
- Bundles [Radicale](https://github.com/Kozea/Radicale) (GPLv3) as a separate process — see
  [`server/THIRD-PARTY-LICENSES.md`](https://github.com/precisioncrab/daynizer-desktop/blob/main/server/THIRD-PARTY-LICENSES.md)
  for the full list of bundled components and their licenses.
- Want a dedicated always-on server instead of running Daynizer itself somewhere (a Raspberry Pi,
  Proxmox, a NAS)? See
  [`server/standalone/`](https://github.com/precisioncrab/daynizer-desktop/tree/main/server/standalone)
  for a ready-to-run standalone Radicale + Docker setup, including its own offline QR-pairing page.

## Notes

- macOS builds are ad-hoc signed, not notarized — Gatekeeper blocks the first launch (right-click →
  Open, then confirm). Windows builds are unsigned — SmartScreen may warn (More info → Run anyway).
- Bug reports and feature requests are welcome on the
  [issue tracker](https://github.com/precisioncrab/daynizer-desktop/issues) — bugs and feature
  requests now have separate templates there.
