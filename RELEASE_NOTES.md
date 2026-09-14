Daynizer v0.7.0 — built-in sync server (Windows experimental preview)

Changes since 0.6.0. This is an early **Windows-only experimental preview** — Daynizer is still beta, and Linux/macOS builds of the new server are on the way. It's an unsigned build, so Windows SmartScreen may warn ("unknown publisher"): click **More info → Run anyway**.

## Built-in sync server — new, on by default

Daynizer can now host its own sync server, so your tasks, calendar, and contacts sync across your devices **without a third-party account** (Synology, Nextcloud, a NAS, or any cloud). It's a bundled, zero-config CalDAV/CardDAV server that Daynizer runs and supervises for you.

- **Optional — you don't have to use it.** It's on out of the box so sync works with zero setup, but you can turn it off in **Settings → Sync Server** any time and point Daynizer at your own CalDAV/CardDAV server instead.
- **Nothing to configure.** On first run Daynizer creates its own "Built-in server" account with a default Calendar and Contacts, and the server just runs.
- **Runs in the background.** It starts with Daynizer, keeps running in the tray when you close the window, and can start hidden at login. The tray shows when a device last synced.
- **Works with any client** — it speaks standard CalDAV/CardDAV, so DAVx5, Tasks.org, Apple Calendar, and Thunderbird all connect to it.

## Set up your phone in seconds

- **QR pairing.** Settings → Sync Server shows a QR code — scan it with DAVx5 on Android and your phone is connected, then add Tasks.org (or OpenTasks) for the task lists.
- **Secure by default (HTTPS).** The server uses TLS with a self-signed certificate, so Tasks.org's direct CalDAV — which refuses plain HTTP on modern Android — connects over `caldavs://`. You approve the certificate once.
- **Windows Firewall helper.** A one-click button opens your firewall so other devices on your Wi-Fi can reach the server.

## Works with a brand-new / empty server

- Create your first list/calendar on an empty server (Daynizer asks the server for your calendar home directly, instead of deriving it from an existing calendar).
- Create an address book on the server, the same way lists are created.
- New accounts get a default "Calendar" and "Contacts" automatically when the server has none; existing servers (Synology, Nextcloud, …) are left untouched.
- A newly added account appears in the "New list → On server" picker right away, and adding an account no longer freezes the form while it sets up.

## Lists, subtasks & colors

- **List colors** — a rotating palette, a color picker when creating a list, and right-click recolor; the color syncs to the server (and other clients) over CalDAV.
- **Subtasks stay with their parent's list.** Moving a task to another list now moves its subtasks with it, and adding subtasks right after changing a task's list no longer strands them — so parent/subtask nesting stays correct in Tasks.org and other clients.
- **Rename an address book** (right-click → Rename; the new name is pushed to the server for synced books).
- Clearer **"New list/calendar"** button label, and a ⇄ sync marker next to server-synced books in a contact's address-book picker.

## Notes

- **Windows only for now.** This preview bundles the sync server for Windows; Linux and macOS server builds are in progress. Stable cross-platform builds remain at v0.6.0.
- This build is unsigned — Windows SmartScreen may warn; click **More info → Run anyway**.
- Daynizer remains beta. Two-way sync works, but keep a backup of anything important, and please file bugs on the issue tracker.
