Daynizer v0.9.0 (in progress, not released)

Changes since v0.8.10. Daynizer remains beta, pre-1.0, keep a backup of anything important.

- **Thunderbird add-on: Thunderbird's own address books in the Contacts tab.** Their contacts show
  beside Daynizer's (Settings > Contacts can hide them), and the contact editor and every clean-up
  tool can change them; Thunderbird syncs them as it always does. A contact in two of Thunderbird's books with one
  contact ID can only be changed in the copy Thunderbird lets add-ons reach; the other copy is marked,
  and Clean up > In several books sorts such contacts out (mailing lists kept). Every change can be
  undone from Changes.
- **The desktop app is unchanged from v0.8.10** apart from wording.

---

Daynizer v0.8.10

Changes since v0.8.9. Daynizer remains beta, pre-1.0, keep a backup of anything important.

- **The calendar stays where you scrolled it.** In a busy month scrolled down to a later week,
  clicking a task or event threw the grid back to the top, and a sync or a saved change could do
  the same. Now it stays put, and a click only moves the highlight.
- **Contacts clean-up tools, from Contacts Cleanup.** The Contacts tab's sidebar has new sections:
  - **Clean up:** Duplicates (check the cards that are the same person, pick what the merged card
    keeps, merge; "Not duplicates" hides a group for good), In several books (the same contact in
    two address books with one ID: link the copies, keep one with the other books as labels,
    separate them, or leave them), Phone numbers (one format, +1 555 123 4567, with a default
    country), Missing names, and Lists to labels (an address book becomes a label, and can move
    into another book).
  - **Chat:** Chat addresses: every contact with a phone number or chat address, JMP.chat
    addresses added from their numbers, and chat addresses other apps can't read (no xmpp:,
    X-JABBER, Google's x-apple:) fixed.
  - **More:** Changes, every change made there, each one can be undone (also Edit > Undo).
  These replace the old Merge duplicates screen. Pairs marked "Not duplicates" there are kept.
  Categories in the sidebar fold away with a click on their name.
- **Contact details you don't edit in Daynizer stay on the card.** Saving a contact used to
  rewrite the whole card from Daynizer's own fields, which dropped what Daynizer doesn't show: the
  marker that tells Google Contacts and iCloud a chat address is XMPP, a second phone type, Apple's
  custom labels, the PO box of an address. Now a card nothing changed on goes back exactly as it
  came, and an edited one keeps those details. Imported contacts keep their photo when they sync.
- **View > Contacts Sidebar…** chooses what the Contacts tab's left pane shows: address books,
  labels, each clean-up tool, the Chat items, More. Hiding one only takes it off the pane; nothing
  in your contacts or on the server changes, and ticking it again brings it back.
- **View > More from Precision Crab…** lists the other Precision Crab apps, each with a link.
- **Upcoming birthdays list each person once.** Someone in several address books showed up once
  per book. Now each birthday and anniversary is listed once.
- **Show several address books or labels at once.** In the Contacts tab, Ctrl+click (Cmd+click on
  a Mac) an address book or label to add it to what's shown, or to take it out, the same as lists
  in Tasks and Calendar. A plain click still shows just that one.

---

Daynizer v0.8.9

Changes since v0.8.8. Daynizer remains beta, pre-1.0, keep a backup of anything important.

- **Windows tells you when an update is ready.** Daynizer already downloaded updates quietly and
  installed them the next time it fully quit, which could be days away while it sits in the tray.
  Now a bar at the bottom says which version is ready, with Restart now, What's new and Later, and
  the tray menu gets a "Restart to update" item. It also checks for updates twice a day while
  running, not only at start.
- **"Restart to update" restarts Daynizer** when it's set to stay in the tray or the built-in sync
  server is running. Before, it only hid the window. Unsynced changes are synced first.

---

Daynizer v0.8.8

Changes since v0.8.6 (v0.8.7 was a Thunderbird add-on update only, listed below). Daynizer remains
beta, pre-1.0, keep a backup of anything important.

- **Timed tasks show on the right day in the calendar's month view.** In the Americas, a task due
  in the evening (from 8 PM on in US Eastern summer time, earlier further west) was drawn on the
  next day. Its stored date and time were right; only the day it was drawn on was wrong. The same
  went for "Start date only".
- **The Today panel shows evening tasks and events on their own day.** They were missing from
  Today and showed up a day late, and a task due last night counted as due today, not overdue.
- **Today & Overdue and the "Due" filter no longer include tomorrow's all-day tasks** in the
  Americas.
- **All-day tasks and events from the server keep their date** in Europe, Asia and Australia.
  They were saved one day early. Items already saved early are corrected the next time they change
  on the server; check any you rely on.

---

Daynizer v0.8.7 (Thunderbird add-on only)

- **The Daynizer button in the left sidebar no longer goes missing** after Thunderbird restarts.
  It came back only once the Daynizer tab was open again or you clicked the toolbar button.

---

Daynizer v0.8.6

Changes since v0.8.5. v0.8.5 came out for Windows and macOS only, so on Linux and in the Thunderbird
add-on this is the first release with its changes too (listed below). Daynizer remains beta,
pre-1.0, keep a backup of anything important.

- **Settings no longer opens at every start** on builds without the built-in sync server (the
  Flatpak from the Daynizer Flatpak repository before this release). It opened to the Sync Server
  page with no "Got it" button to dismiss it.
- **Deleting something that changed on another device no longer fails forever.** If a task, event
  or contact was edited elsewhere (on your phone, say) after the last sync, the server refused the
  delete with "HTTP 412" and Daynizer retried the same way at every sync. Your delete now wins.
- **Deleted contacts no longer come back** when the server couldn't delete them right away. They
  are now retried at the next sync, like tasks and events.

---

Daynizer v0.8.5

Changes since v0.8.4. Daynizer remains beta, pre-1.0, keep a backup of anything important.

- **Light mode.** View > Theme now has Match System (the default), Light Mode and Dark Mode, in
  the desktop app and the Thunderbird add-on. Match System follows your computer's setting (in
  Thunderbird, Thunderbird's own theme) and switches with it. The choice is saved on each computer.
- **Linux and macOS tell you when an update is out.** Windows already updates itself; on Linux and
  macOS, Daynizer now checks for a newer release when it starts (and twice a day while running)
  and shows a bar at the bottom with how to update: GNOME Software, KDE Discover or
  `flatpak update` for the Flatpak, the `apt install` command for the .deb, or the release page.
  "Later" hides it until the next version.
- **The auto-updating Flatpak includes the built-in sync server again.** Since v0.8.0 the Flatpak
  from the Daynizer Flatpak repository was built without it (the one attached to each GitHub
  release had it).
- **Linux packages now state their license** (GPL-3.0-or-later). The .deb showed "unknown" before.
- **Pick a contact's address book at the top of the contact form.** The Address book field was at
  the bottom and only appeared with more than one book; it's now the first field and always shown,
  so a new contact's book is easy to set.
- **Moving a contact to another address book no longer leaves a copy behind.** A contact already
  synced to the server was re-downloaded into its old book on the next sync. It is now removed from
  the old book and uploaded to the new one.

---

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
