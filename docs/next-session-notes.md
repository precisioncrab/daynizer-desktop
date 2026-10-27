# Notes for next session

## 2026-08-25 — Fixes from beta-test notes + live Synology validation

Batch from Arlis's desktop + add-on test checklists. Code changes are in `src/**`
(shared by desktop AND the add-on — the add-on's `tab/entry.ts` imports `../../src/main`)
and `electron/**`. Typechecked clean (renderer / electron / addon tsconfigs).

**Fixed & LIVE-VERIFIED against Synology:**
- **Lists -> server now appear.** Root cause proven on the wire: `createServerCalendar()`
  sent only `displayname`, so the new calendar got an EMPTY `supported-calendar-component-set`.
  The server hides those and Tasks.org won't subscribe (DAVx5 shows them anyway). Fix: declare
  `VEVENT + VTODO` on `makeCalendar` (`electron/caldav.ts` + `thunderbird-addon/background/caldav.ts`
  + canonical add-on repo). Verified: new lists from desktop (`daynizer2`) and add-on (`tbird4`)
  both landed with `[VEVENT,VTODO]` and show in Synology Calendar. NOTE: must install the new
  build from `release\`, not just relaunch the old install.

**Server identity (matters for the rest):** the Synology "native" Calendar is **DAViCal 1.1.12**
under the hood (`/caldav.php/`, `X-DAViCal-Version`). New known limitation: DAViCal returns
`405 "DELETE collection is not supported"`, so deleting a whole list in the app cannot remove the
collection from the server (items still delete fine). `PROPPATCH` of the component set IS allowed
(used it to surface + delete 13 orphan test calendars this session).

**Fixed, typecheck-clean, NOT yet runtime-tested by Arlis:**
- Contact editor "Categories" -> "Labels" (matches the sidebar) + a dropdown of existing labels
  (`ContactDetailPanel.tsx` + `App.tsx`).
- Address field "Region" -> "State".
- Tasks created in Calendar view default to the default TASK list, not the event calendar
  (`App.tsx` `createTaskOnDate`).
- Pending deletions now count as unsynced — `electron/db.ts` `countDirtyItems` only counted
  `dirty=1` and missed soft-deletes, so the close-prompt ignored deletes and a delete could be lost
  on quit and re-pulled.
- Add-on Edit menu: Cut/Copy/Paste/Select All (`AddonMenuBar.tsx`).
- Add-on Settings: empty "Notifications & Startup" pane hidden for the add-on (`SettingsModal.tsx`).

**Diagnosed, not changed (need more live testing):** favorites -> server/Android (no standard
CardDAV favorite; the add-on reboot-loss is a pull/conflict issue), merge-duplicates not clearing
server dupes, "(conflicted copy)" dupes, notification-click jump (renderer handler + AUMID already
correct — likely a Windows toast quirk). Full detail in `../FIX-NOTES-2026-08-25.md`.


## 2026-08-02 — ▶️ START HERE NEXT: Friendica scheduled posts, Phase 1 (design done, decisions locked)

**New feature: schedule social posts from the calendar.** Full design is written in `docs/scheduled-posts-plan.md` — read it first. In short: a scheduled post becomes a 4th calendar item type (next to tasks/events); it's scheduled **on the always-on Friendica server** (which fires it even when this app is closed) and the existing n8n tag-router fans it out to Pixelfed/Mastodon/Tumblr/Meta by hashtag. This app is the composer/calendar, not the publisher.

**Decisions already locked (don't re-litigate):**
- **Friendica-authoritative + local mirror** (mirrors the CalDAV model). Reason: the server is always on, this app is not — firing must be server-side.
- **Un-timed local drafts allowed:** `state='draft'` is local-only (no API call); assigning a `scheduled_at` pushes it to Friendica → `state='scheduled'`.
- **Reschedule = create-then-delete** (Friendica returns `501` on `PUT /scheduled_statuses/:id` — no in-place edit; create-then-delete so a failed move never loses the post).
- **Surface n8n routing tags as checkboxes** in the composer (`#art`, `#mastodon`, `#pixelfed`, …).

**Prerequisites — all READY:**
- Scheduling API **verified live** (2026-08-02, Friendica 2026.05): `POST /statuses`+`scheduled_at` → ScheduledStatus ✅ · `GET /scheduled_statuses` ✅ · `DELETE …/:id` ✅ · `PUT` → 501 ⚠️.
- **Write token minted** and in Bitwarden (`Friendica — read write token (hunter)`; app `friendica-scheduler`). base_url `https://precisioncrab.com`, username `hunter`, numeric account id `3`.
- ⚠️ Unverified: whether the instance enforces Mastodon's "`scheduled_at` ≥ ~5 min out" rule — validate client-side anyway.

**Phase 1 scope (zero write risk — build this slice first, behind a `FRIENDICA_SCHEDULING` flag in `src/featureFlags.ts`):**
1. `friendica_accounts` table + migration in `electron/db.ts` (`token_enc` via `safeStorage`, exactly like `caldav_accounts.password_enc`).
2. `electron/friendica.ts` — `testConnection` (GET `/accounts/verify_credentials`) + `listScheduled` (GET `/scheduled_statuses`), pull-only. Node `fetch` like `caldav.ts`; token decrypted in-main only.
3. Settings UI section to add a Friendica account (label, base_url, username, paste token) + Test connection.
4. `scheduled_posts` table + pull-only sync; render existing scheduled posts on the calendar as **read-only** `kind:"post"` items in `CalendarView.tsx` `buildEcEvents()` (new branch; `eventClick` → a stub `PostDetailPanel`).

Nothing in Phase 1 can create/delete a post, so it's safe to run against the live instance. Phases 2–4 (create/delete → reschedule/media/tags → sync polish) are in the plan doc.

> ⚠️ **Same standing rule as always:** the Cowork sandbox can't run the vite build and must NOT build/commit. Cowork writes the code; **Arlis runs `npm run build` + `npm run dev`/`dev:electron` and commits from his own terminal.** Suggested commit when green: `git add electron/ src/ docs/ && git commit -m "scheduled posts: phase 1 (friendica account + read-only calendar)"`.

## 2026-07-12 (evening) — Contacts phase 3 UI + CardDAV linking (BUILT, NOT YET BUILD-TESTED)

On branch `contacts`. A large batch of renderer work was written but **not built or
tested on Windows yet** (Cowork can't run the vite build; electron `tsc` for the
`carddav_url` backend also wasn't re-run). First thing: `npm run build`, fix any TS
errors, then `npm run dev` + `npm run dev:electron` and test the checklist below.

**What was built (all on the Contacts tab):**
- **Contacts-aware sidebar** (`src/components/ContactsSidebar.tsx`) — replaces the
  task-list sidebar when on Contacts: All contacts / ★ Favorites / Address books
  ("+ New address book") / Labels. Right-click a label → set color (palette).
  Footer "CardDAV accounts…". Single active collection drives the list.
- **`ContactsView`** reworked — toolbar is just search + New contact (no dropdowns);
  rows show initials avatar + star (favorite) + colored label dots.
- **Favorites** = reserved `CATEGORIES` value "Favorite" (`src/contactUtils.ts`),
  so it's the ★ Favorites collection AND syncs. Star toggle on each row.
- **Label colors** stored as a settings-JSON map under key `contactLabelColors`
  (no new table); dots on sidebar + rows.
- **Upcoming rail** (`src/components/ContactsRail.tsx`) — right pane shows next **8**
  birthdays + anniversaries (🎂/💍), date, "turns N", days-until; click opens contact;
  shows all contacts regardless of the sidebar filter.
- **Year-less birthdays** — "no year" checkbox in `ContactDetailPanel`; stored as
  `--MM-DD`; the rail parses it and shows no age.
- **CardDAV linking (3b)** — `SettingsModal` gained a "Contacts (CardDAV)" section per
  account: a CardDAV URL field (Synology's is a DIFFERENT address than CalDAV, e.g.
  `.../carddav.php/…`), "Find address books", and per-book Link. Backend already had
  `carddav_url` on the account + `carddav.ts` using it + the `addressbooks:*` IPC.

**Test checklist:**
1. Contacts tab renders; create/edit/delete a contact; star some (→ ★ Favorites).
2. Add a category → shows under Labels; right-click → color sticks (persists across
   restart via settings).
3. Search matches first/last/nickname/phone/email.
4. Set a birthday with a year and one with "no year"; both appear in the rail with
   correct days-until; the year one shows "turns N".
5. Settings → your account → Contacts (CardDAV): paste Synology's CardDAV URL →
   Find address books → Link one → confirm real contacts sync in, and edits push back.

**Known rough edges to polish:** detail panel's Categories field shows "Favorite"
when starred (hide the reserved marker); no anniversary editor in the panel yet
(rail shows synced anniversaries only); no star in the detail panel (row star only);
label color picker is a context-menu list, not swatches; no unlink/delete-address-book
UI yet. `KIND:group` real groups still needed for Apple cross-compat (see contacts-plan.md).

Commit when green: `git add electron/ src/ docs/ && git commit -m "contacts: phase 3 UI (sidebar/rail/favorites/label-colors) + CardDAV linking"`

## 2026-07-12 — packaged .exe shows the Electron logo, not the green app icon
User reports the installed Windows .exe (from a GitHub release) displays the default Electron
logo instead of the app's green icon. Likely one or more of:
- `build/icon.ico` missing / invalid / not actually the green logo — verify it exists and is a
  proper multi-resolution .ico (`package.json` build.win.icon = "build/icon.ico").
- `BrowserWindow({ icon: ... })` is never set in `electron/main.ts`, so the window/taskbar icon
  falls back to the generic Electron logo (see the 2026-07-09 tray/taskbar-icon note below). Set
  it to the green icon for packaged (and ideally dev) runs.
- Confirm electron-builder actually embeds `win.icon` into the NSIS installer + the exe.

Updated 2026-07-09 (same session, continued): CalDAV VALARM sync described below as "next" is
now implemented — `electron/ical.ts` (VALARM serialize/parse + `reminderOffsets` on
`taskToVTodo`/`eventToVEvent`/`ParsedVTodo`/`ParsedVEvent`), `electron/db.ts`
(`mergeRemindersFromRemote`, `reminderCreateForOwner`/`reminderDeleteForOwner`),
`electron/main.ts` (IPC now calls the `*ForOwner` versions), `electron/caldav.ts` (push passes
offsets into the serializers, pull calls `mergeRemindersFromRemote` on create/etag-catchup/
conflict-overwrite, conflicted copies carry over local offsets too). See `docs/roadmap.md`'s
"CalDAV VALARM sync for reminders — DONE" entry for the full writeup. **Not yet done**:
typecheck/build/dev-test/commit (next terminal steps), and real-device verification against an
Android CalDAV client (DAVx5/Etar) — untested against a real phone.

## Reminders — local-only v1 shipped this session, CalDAV VALARM sync is next

Built and tested working (user confirmed): multiple configurable reminders per task/event
("at time of" or N minutes/hours/days before), stored in a new `reminders` table (`electron/db.ts`),
scheduler rewritten in `electron/main.ts` (`checkReminders()` now uses `remindersDueForNotification`),
IPC in `preload.cts`/`types.ts`, UI is a shared `RemindersEditor.tsx` component used by both
`DetailPanel.tsx` (tasks) and `EventDetailPanel.tsx` (non-recurring events). Recurring events are
excluded from reminders (v1 decision, unchanged — see docs/roadmap.md).

**Also shipped this session**: unified the whole detail-panel save model per explicit user request
("1 system of logic... either no save button at all, or any change... needs to require a save").
Chose batch-save (matches Thunderbird/Tasks.org, which the user pointed to as the reference): title/
notes/dates/priority/tags/recurrence/reminders/new-subtasks are all just local component state until
you click Save, which commits everything at once (reminders are diffed against the DB — only actual
adds/removes fire IPC calls). Mark-complete and Delete stay immediate/one-click (destructive/terminal
actions, not "edits"), per explicit user confirmation.

**Next up, starting fresh next session** (explicit user instruction: "we need reminders to work in
android with stock calendar/Etar... going to need to implement it pretty soon, even if it has bugs"):
real CalDAV VALARM support, so reminders round-trip to other CalDAV clients (Android via DAVx5+Etar,
Tasks.org mobile, etc.), not just stay local. Plan already scoped out (see chat, not yet written to
roadmap.md — do that first thing next session):
- `electron/ical.ts`: add VALARM sub-component serialization to `taskToVTodo`/`eventToVEvent` (new
  optional `reminderOffsets: number[]` param) — `ICAL.Duration.fromSeconds(-minutes*60)` for the
  TRIGGER value, `ACTION:DISPLAY`, and `RELATED=END` parameter on tasks specifically (VTODO's TRIGGER
  defaults relate to DTSTART if present, but this app's reminders are always anchored to due_date, so
  need to force relating to DUE via the RELATED param; events don't need it, START is already the
  default and matches start_date).
- `parseVTodo`/`parseVEvent`: extract VALARM triggers back into a `reminderOffsets: number[]` field
  on `ParsedVTodo`/`ParsedVEvent` (signed `ICAL.Duration.toSeconds()`, only negative/zero triggers
  count as "N minutes before"; positive/"after" triggers are out of scope, ignore them).
- `electron/db.ts`: new `mergeRemindersFromRemote(ownerType, ownerId, offsets)` — **additive only,
  never deletes**. If `offsets` is empty, do nothing at all (critical: the user's own Synology CalDAV
  server is documented to strip VALARM blocks entirely — see docs/roadmap.md's original VALARM
  research — so a naive "replace local reminders with what the server returned" would silently wipe
  every reminder the user has set, every single sync). Only add reminders that are on the server but
  missing locally.
- New `reminderCreateForOwner`/`reminderDeleteForOwner` wrapper functions that also mark the owning
  task/event `dirty: 1` (via `taskUpdate(id, {dirty:1})`/`eventUpdate(id, {dirty:1})`) so a
  reminder-only change actually gets picked up and pushed next sync. Wire these into the
  `reminders:create`/`reminders:delete` IPC handlers in `main.ts` (currently call the raw, non-dirty-
  marking `reminderCreate`/`reminderDelete` — keep those raw versions for `ensureDefaultReminder` and
  the remote-merge path, which must NOT mark dirty).
- `electron/caldav.ts`: at push time (both create and update paths, for tasks and events), fetch
  `remindersForOwner(...)` and pass the offsets into `taskToVTodo`/`eventToVEvent`. At pull time,
  call `mergeRemindersFromRemote` after a successful create/update/etag-catchup branch.
- Do this as its own pass, typecheck/build/dev-test before committing, same one-terminal-step-at-a-
  time workflow as always.

## Older items

## UI fixes requested

- "Show scheduled" toggle and "Save view" button in the toolbar-filters row are positioned awkwardly — rework their placement/layout (src/App.tsx toolbar-filters section, styles in src/styles.css).
- Clearing the date should also clear the time (added 2026-07-04).
- ~~Opening the app should trigger a sync; hitting save should trigger a sync~~ — done 2026-07-09 on `experimental` branch, see below.
- Typing in the search field brings the app to a crawl — investigate performance (likely needs debouncing/memoization) (added 2026-07-04).
- App has gotten super slow in general — overall performance investigation needed (added 2026-07-04).
- **"(conflicted copy)" tasks — investigated, looks like real conflicts, not a bug** (added
  2026-07-09, resolved same day after reviewing `sync.log`). The two conflicts seen ("shim
  sawmill", "plan water lines with flags") both fired at the first sync after a ~4.5-day gap with
  no syncs at all (last sync July 5, next sync July 9 13:18). No `etag refresh failed`/`NOT FOUND`
  lines anywhere in the log, which was the original suspicion — ruled out. Most likely explanation:
  another device (e.g. phone Tasks.org) edited those two tasks on the server during the gap while
  the desktop app still had older unpushed local edits to the same tasks. That's a genuine
  independent-edit conflict, and the sync engine did the right thing (kept the remote version,
  preserved the local edits as a "(conflicted copy)" task so nothing was lost). No fix needed —
  just something the user should manually reconcile (merge or delete the copies).
- Dev/experimental tray icon still not confirmed working (added 2026-07-09): tried an in-memory
  tint and then a real separate file (`build/icons/32x32-dev.png`, orange), wired into
  `setupTray()` in `electron/main.ts` behind `isDev`. Neither changed what the user was seeing.
  Suspect we've actually been looking at the **taskbar** icon (from `BrowserWindow`'s `icon`
  option — never set in this codebase, so dev/unpackaged runs fall back to the generic Electron
  logo there regardless of Tray changes) rather than the **system tray** icon near the clock
  (which is what `setupTray()` actually controls). Need to confirm which one the user means,
  then either fix `BrowserWindow({ icon: ... })` for dev too, or confirm the tray fix already
  works and was just never actually checked in the right place.

## Sync-on-open / sync-on-save (2026-07-09, `experimental` branch)

Ported Tasks.org's (Android) sync-triggering methodology into src/App.tsx, researched from the
tasks/tasks GitHub source (WorkManagerImpl.kt, SyncAdapters.kt, SyncSource.kt, Debouncer.kt):

- **Sync on launch**: one-shot `setTimeout` ~1.5s after mount calls `runSync(true)`, mirroring
  Tasks.org's app-open sync. (Tasks.org also resumes its hourly WorkManager job across boots
  automatically — no direct equivalent needed here since this app has no separate "boot" moment;
  "launch at login" already gets covered by the same on-launch trigger.)
- **Sync after edits**: new `scheduleDirtySync()` (60s debounce, timer resets on every call) is
  invoked after task create/update/toggle-complete/delete/duplicate/subtask/snooze. Mirrors
  Tasks.org's dirty-row watcher + 1-minute debounced sync (SyncSource.TASK_CHANGE). Deliberately
  *not* called from `reorderTask` — sort_order is local-only and already excluded from the dirty/
  sync path (see comment on that function).
- **Periodic interval**: this app already had a user-configurable background-sync timer
  (`syncIntervalMinutes`, "0" = manual only), the desktop analogue of Tasks.org's fixed 1-hour
  `PeriodicWorkRequest`. Default bumped from 5 min to 60 min to match Tasks.org, since sync-on-save
  and sync-on-launch now cover the cases that mattered most about a short interval; added a
  "60 minutes (Tasks.org default)" option to the Settings dropdown. Only affects new/unconfigured
  installs — existing users with a stored `syncIntervalMinutes` value are unaffected.
- **Not ported**: Tasks.org's `APP_RESUME` (re-sync if foregrounded and last sync >5 min ago) —
  skipped since this app doesn't really "background/foreground" the way a phone app does with
  the tray icon. Easy to add later if it turns out to matter.

Not yet done: this was implemented and reviewed in the Cowork sandbox but **not built or
committed from there** (per the standing rule below). Needs a `npm run build`/typecheck and a
manual smoke test (create a task, edit+save a task, confirm a sync fires ~1 min later; check
the interval timer still runs) from a real terminal before committing on `experimental`.

## Status 2026-07-04 (Linux session)

- v0.1.14 installed on the Linux machine via update-tasksdesktop.sh (script now at ~/.local/bin/update-tasksdesktop); launches cleanly.

## Backlog

- **Flatpak repo auto-updates** (decided 2026-07-04, deferred until current build is tested for a while):
  self-host an OSTree repo on GitHub Pages via the Flatter GitHub Action (GPG-signed, prune old builds),
  and build bundles with `--repo-url` embedded so installing a release bundle auto-registers the remote —
  then `flatpak update` / GNOME Software handles updates like Flathub apps. Replaces the update script.
- Optional smaller step: in-app "update available" check on Linux against GitHub releases/latest
  (IPC plumbing `update:status` already exists).

## Release notes process (new as of 2026-07-04)

- RELEASE_NOTES.md at repo root is published as the GitHub release body by CI (`body_path` in build.yml).
- Keep it updated as changes land; it always describes the *next* release. Reset it after each tag.

## Session context

- v0.1.13 tagged this session: About dialog (View → About Tasks Desktop), Edit → Settings…, date/time inputs stacked vertically + dark themed (added `color-scheme: dark` and `input[type="time"]` to the dark input rule).
- User runs 0.1.12 installed on Win11; auto-update works from 0.1.9+. v0.1.13 release publishes via CI on tag push.
- Old tags v0.1.10/v0.1.11 exist locally but were deliberately NOT pushed — never `git push --tags` (stale releases would hijack "latest" and break auto-update).
- IMPORTANT: the Cowork sandbox mount can show truncated file tails for recently edited files (caused corrupted commits before v0.1.8). Never commit/build from the sandbox — verify with the file tools (Windows side) and let the user commit from their own terminal.
