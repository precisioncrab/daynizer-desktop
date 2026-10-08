Daynizer v0.8.4

Changes since v0.8.3. Daynizer remains beta, pre-1.0, keep a backup of anything important.

- **Fixed repeating events showing an hour off after a daylight-saving change.** A weekly 4 PM
  meeting created in winter showed at 5 PM in summer on the calendar. Repeats now keep their clock
  time. Completing a timed repeating task had the same drift and is fixed too.
- **Show several lists at once, and save them as a view.** Click a list in the sidebar to show
  only that list; Ctrl+click (Cmd+click on Mac) to add more lists or take one away. This works on
  the Tasks tab and the Calendar tab, which each keep their own selection. On the Calendar tab,
  clicking a list in the sidebar now narrows the calendar to it, and the List filter is a checkbox
  list (tick to add a list, click a name to show only that one). The Calendar tab has a Save view
  button too, and saved views (renamed from "Filters") work from either tab: a view brings its
  lists and category to whichever tab you open it on. Views you saved before carry over.
- **Filter bars stay on one line.** On a narrow window (or a Thunderbird tab) the filters on the
  Tasks and Calendar tabs no longer stack onto extra rows; their labels shorten instead (for
  example "Tasks: Start–Due" becomes "T: S–D"). Open a filter to see its full choices.
- **Hide the filters you don't use: View → Filters.** Untick a filter to remove it from the
  toolbar. A hidden filter still applies, and you can change its setting in the same window.
  The Calendar's Month/Week/Day picker counts as a filter, and the calendar now remembers it
  between launches.
- **View → Saved Views.** Open any saved view, or save the current one, from the menu. Saved views
  now also remember which filters are hidden, the Tasks sort order, and the calendar's
  Month/Week/Day.
- **New tasks and events go into the list you have selected.** With a list selected, anything you
  create lands in it (with several selected, the first one you picked); with All selected, it goes
  to your default list from Settings. This now also holds for File → New Task (Ctrl+N), which
  ignored the selection, and for new tasks made on the Calendar tab, which used the Tasks tab's
  selection instead of the calendar's.
- **Choose what each tab shows when Daynizer opens.** Settings → Calendars & Lists has a default
  Tasks view (All Tasks, Today & Overdue, or a saved view) and a default Calendar view (same as
  last time, All lists, or a saved view).
- **Thunderbird add-on: reminders now pop up as notifications.** Turn them on in Settings →
  Notifications; Thunderbird asks once for permission to show notifications. Reminders show while
  Thunderbird is running, and clicking one opens Daynizer on that task or event. In the add-on the
  Settings pane no longer shows the desktop-only tray and start-at-login options.
- **Thunderbird add-on: importing contacts from a vCard (.vcf) file works.** Choose file & import
  now opens a file picker; before, it failed with an error.

---

Daynizer v0.8.3

Changes since v0.8.2. Daynizer remains beta, pre-1.0, keep a backup of anything important.

- **A simple way to schedule "the first Saturday of every month" style events.** Repeats now has a
  "Monthly (specific weekday)" option with plain position/weekday dropdowns (First/Second/Third/
  Fourth/Last, Sunday-Saturday), instead of needing to know RRULE syntax. Custom RRULE is still there
  for anything this doesn't cover.
- **Fixed a task jumping back to its old date** when you dragged it on the calendar and then saved
  changes (like making it repeat) from the open details panel.
- **Search now finds subtasks.** A subtask matching the search (title, notes, or tags) is shown under
  its parent, and collapsed parents expand while a search is active.

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
