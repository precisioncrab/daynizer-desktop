# Scheduled Posts — design plan (Friendica-backed post scheduling in the calendar)

**Date:** 2026-08-02. **Status:** ⬜ Design only — nothing built. Gate behind a feature flag when built.

## What this adds

A fourth item type on the calendar — a **scheduled social post** — alongside tasks and events. You compose a post, pick a date/time, and it appears on the calendar at that time. The post is scheduled **on Friendica** (`hunter@precisioncrab.com`), which then publishes it and — via the existing n8n tag-router — fans it out to Pixelfed, Tumblr, Mastodon, Facebook/Instagram, etc. by hashtag.

This is the "multi-account scheduling UI for Friendica" gap noted in the crossposting project's `publishing-architecture.md` §7b. The tasks app becomes the **composer + calendar**; Friendica stays the **source of truth + publisher**; n8n stays the **distributor**. No new posting engine is introduced.

### Why Friendica, and what's verified

Friendica exposes the Mastodon-compatible scheduling API, and the full lifecycle was verified live on the instance (2026-08-02, Friendica 2026.05):

- `POST /api/v1/statuses` with a `scheduled_at` → returns a **ScheduledStatus** (`id`, `scheduled_at`, `params{}`), queued not posted ✅
- `GET /api/v1/scheduled_statuses` → lists the queue ✅
- `DELETE /api/v1/scheduled_statuses/:id` → removes it ✅
- `PUT /api/v1/scheduled_statuses/:id` (reschedule in place) → **`501 Not Implemented`** ⚠️

The `501` is the one constraint that shapes the design: **there is no in-place reschedule.** Moving a post to a new time = **delete the old scheduled status + create a new one.** A `write`-scoped Friendica token is required (the crossposter's polling token is `read`-only); one was minted 2026-08-02 (app `friendica-scheduler`).

---

## Architecture fit (mapped to the existing code)

The app already has the exact shape this needs. The plan is to mirror the **events** and **caldav_accounts** patterns rather than invent anything.

| Concern | Existing pattern to copy | New piece |
| --- | --- | --- |
| Remote account + secret | `caldav_accounts` table; `password_enc` via `safeStorage` (`electron/caldav.ts` `encryptPassword`/`decryptPassword`) | `friendica_accounts` table; `token_enc` via the same `safeStorage` helpers |
| Local mirror of remote data | `events` table + `dirty`/`deleted` flags; sync reconciles | `scheduled_posts` table, same flag model |
| Network + DB in main process | `electron/caldav.ts`, `electron/db.ts`; renderer never touches network | `electron/friendica.ts` |
| IPC surface | `window.api.events.*`, `window.api.accounts.*` (`electron/main.ts` `ipcMain.handle`, `src/types.ts` `Window.api`) | `window.api.posts.*` + `window.api.friendica.*` |
| Calendar rendering | `buildEcEvents()` in `CalendarView.tsx` merges tasks+events, each with `extendedProps.kind` | add a `kind: "post"` branch |
| Detail/compose panel | `EventDetailPanel.tsx`, routed by `selectedEventId` in `App.tsx` | `PostDetailPanel.tsx`, routed by `selectedPostId` |
| Incremental rollout | `src/featureFlags.ts` (`RECURRING_PER_OCCURRENCE`) | `FRIENDICA_SCHEDULING` flag |
| Secure-by-construction | tokens/passwords only in main, decrypted at call time | same — the write token never reaches the renderer |

**Source-of-truth model: Friendica-authoritative, local mirror. ✅ DECIDED 2026-08-02.** Exactly how CalDAV already works here — the remote is the truth, the local SQLite table is a cache with `dirty`/`deleted` flags, and a sync function reconciles.

**The deciding fact: the Friendica server is always on; the desktop app is not.** Whatever *fires* a post at its scheduled time must therefore be Friendica, not the app — a post due while the desktop is off/asleep must still go out. So a scheduled post is written into Friendica's always-on queue at save time, and Friendica publishes it independent of the app. The app only needs to run when you're composing/rearranging. A local-drafts-then-push model would reintroduce the always-on dependency (a draft awaiting push needs the app running at push time) and add a second source of truth, so it's rejected.

**Combined with the drafts question (decision 2): allow purely-local, *un-timed* drafts** (compose offline, no API call), and the moment a draft is given a `scheduled_at` it's written to Friendica's queue. This gives offline composing with server-side firing. So `state='draft'` = local only, no `remote_id`; assigning a time transitions it to `state='scheduled'` and pushes it.

---

## Data model

Two new tables, added with the same idempotent `CREATE TABLE IF NOT EXISTS` + `try/catch ALTER TABLE` migration style already in `electron/db.ts` `migrate()`.

```sql
CREATE TABLE IF NOT EXISTS friendica_accounts (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,          -- "Hunter (art)", per brand/account
  base_url      TEXT NOT NULL,          -- https://precisioncrab.com
  username      TEXT NOT NULL,          -- hunter
  account_id    TEXT,                   -- numeric Friendica id (e.g. "3"), for reference
  token_enc     TEXT NOT NULL,          -- safeStorage-encrypted write token (base64), like password_enc
  last_sync_at  TEXT,
  last_sync_status TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id            TEXT PRIMARY KEY,       -- stable local id (nanoid) — survives reschedule
  account_id    TEXT NOT NULL,          -- -> friendica_accounts.id
  remote_id     TEXT,                   -- ScheduledStatus id from Friendica; NULL until pushed
  body          TEXT NOT NULL DEFAULT '',
  visibility    TEXT NOT NULL DEFAULT 'public',   -- public|unlisted|private
  media         TEXT NOT NULL DEFAULT '[]',       -- JSON: [{path|url, alt}]; uploaded at push time
  routing_tags  TEXT NOT NULL DEFAULT '',         -- e.g. "#art,#mastodon" — drives n8n fan-out
  scheduled_at  TEXT NOT NULL,          -- UTC ISO, like events store instants
  state         TEXT NOT NULL DEFAULT 'draft',    -- draft|scheduled|published|failed|canceled
  last_error    TEXT,
  dirty         INTEGER NOT NULL DEFAULT 0,
  deleted       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sposts_account ON scheduled_posts(account_id);
CREATE INDEX IF NOT EXISTS idx_sposts_when ON scheduled_posts(scheduled_at);
```

**Key field: `id` is a stable local id, separate from `remote_id`.** Because reschedule = delete+recreate on Friendica, the `remote_id` changes when you move a post — but the local `id` (and its calendar identity, selection state, etc.) stays put. The UI tracks the local id; sync swaps the `remote_id` underneath.

**`routing_tags`** is the bridge to the crosspost pipeline: the composer offers checkboxes (`#art`, `#mastodon`, `#pixelfed`, `#tumblr`, `#farm`, …) that get appended to the body so the existing n8n router fans the post out. Compose once here, distribute everywhere — no per-destination work in this app.

---

## Main-process module: `electron/friendica.ts`

Uses Node's `fetch` (undici) like `caldav.ts`. Token decrypted per call via the existing `decryptPassword` helper (rename/share as `decryptSecret`).

```
testConnection(account)       -> GET /api/v1/accounts/verify_credentials      (validate token)
listScheduled(accountId)      -> GET /api/v1/scheduled_statuses               (pull queue)
createScheduled(accountId, p) -> [optional media upload] POST /api/v1/statuses {scheduled_at,...}
deleteScheduled(accountId,rid)-> DELETE /api/v1/scheduled_statuses/:rid
reschedule(accountId, localId, newWhen) -> deleteScheduled(old) then createScheduled(new)  // 501 workaround
uploadMedia(accountId, file)  -> POST /api/v2/media (form-data 'file') -> media id           // for image posts
syncFriendica(accountId)      -> reconcile local <-> remote; returns {pulled, pushed, errors}
```

**`syncFriendica` reconciliation (mirrors `syncAccount` in `caldav.ts`):**

1. `listScheduled` → remote set keyed by `remote_id`.
2. Push locals with `dirty=1`: `deleted` → `deleteScheduled`; new (no `remote_id`) → `createScheduled`, store returned `remote_id`, set `state='scheduled'`, clear `dirty`.
3. Pull: any remote not seen locally → insert (`state='scheduled'`).
4. **Disappeared-from-remote handling:** a local `scheduled` post whose `remote_id` is no longer in the remote list almost always means **it fired** → set `state='published'` (don't delete — keep it on the calendar as history, greyed). Optionally confirm by checking the account timeline for a status created near `scheduled_at`.

⚠️ **Publish-failure blind spot:** Friendica publishes asynchronously server-side; the API does **not** report a later failure. "Published" is therefore best-effort inference from the queue emptying. Note this in the UI (a subtle "assumed sent" vs "confirmed" distinction if timeline confirmation is added).

---

## IPC surface (`electron/main.ts` + `src/types.ts`)

Register alongside the existing handlers, same style:

```
window.api.friendica = {
  all(), create({label, base_url, username, token}), update(id, patch), delete(id),
  testConnection(account), sync(accountId)
}
window.api.posts = {
  all(), create(input), update(id, patch), delete(id, hard?), reschedule(id, newWhenIso)
}
```

`friendica.create` takes the plaintext token, encrypts with `safeStorage` in main, stores `token_enc`; `friendica.all` strips `token_enc` before returning (same as `accounts:all` strips `password_enc`).

---

## Calendar integration (`src/components/CalendarView.tsx`)

In `buildEcEvents()`, add a third pass over `scheduledPosts` producing **timed** entries (posts have a specific instant, so they render in TimeGrid; DayGrid shows a dot):

```ts
{
  id: `post:${p.id}`,
  title: firstLine(p.body) || "(scheduled post)",
  start: p.scheduled_at,          // UTC ISO
  allDay: false,
  backgroundColor: stateColor(p.state),   // scheduled=accent, published=grey, failed=red
  extendedProps: { kind: "post", masterId: p.id, state: p.state, accountId: p.account_id }
}
```

- **Icon/affordance:** prefix the title with a send glyph (e.g. ✈/📣) so posts read as distinct from events, matching how the ↻ recurrence mark is injected in `eventContent`.
- **`eventClick`:** extend the existing switch — `kind === "post"` → open `PostDetailPanel` (new `selectedPostId` state in `App.tsx`, same one-panel-at-a-time logic as tasks/events/contacts).
- **Drag-to-reschedule (`eventDrop`):** for a `post`, call `window.api.posts.reschedule(id, newIso)`. Because Friendica returns `501` on `PUT`, this is a delete+recreate under the hood — do it optimistically with a spinner and roll the calendar back on error. Validate the drop target is far enough in the future (see below).
- **Create by click/drag on empty time:** offer "New scheduled post" here in addition to New event, defaulting `scheduled_at` to the clicked slot.

---

## Compose panel (`src/components/PostDetailPanel.tsx`)

Mirror `EventDetailPanel.tsx`. Fields:

- **Account** (which Friendica account/brand) — dropdown from `friendica_accounts`.
- **Body** — textarea with a character counter. Friendica's own limit is generous, but destinations differ (Mastodon default 500). Show the tightest limit implied by the selected routing tags as a soft warning.
- **Routing tags** — checkboxes mapped to the n8n router (`#art`, `#mastodon`, `#pixelfed`, `#tumblr`, `#farm`, `#farmmarket`, `#fabrication`). Appended to the body on save. This is the composer's superpower: pick destinations by tag.
- **Media** — attach image(s); uploaded at push time via `POST /api/v2/media` then referenced as `media_ids`. (Pixelfed/Meta branches require an image; the panel can warn if `#pixelfed`/`#art`-to-Meta is selected without one.)
- **Visibility** — public/unlisted/private.
- **Scheduled at** — datetime picker (store UTC ISO like events).
- **State badge + last_error** — read-only status.

---

## Security

- Write token stored **only** as `token_enc` (safeStorage) in the main-process DB, exactly like CalDAV `password_enc`. It never crosses IPC to the renderer.
- All Friendica HTTP happens in `electron/friendica.ts` (main). The renderer only sends/receives sanitized post data.
- The token is `write`-scoped — it can post as you — so it stays local to the desktop app; do not sync it anywhere.
- Gate the entire feature behind `FRIENDICA_SCHEDULING` in `featureFlags.ts` until each slice is tested.

---

## The `501` reschedule, concretely

There is no `PUT`. So:

- **Move a post (drag or edit the time):** `deleteScheduled(old remote_id)` → `createScheduled(new)` → store new `remote_id` on the same local row. Local `id` unchanged.
- **Edit body/media of an already-scheduled post:** same delete+recreate (Friendica has no edit-scheduled either). Treat any change to a `scheduled` post as replace-remote.
- **Guard the time:** Mastodon requires `scheduled_at` ≥ ~5 minutes out; verify whether this instance enforces it (untested). Validate client-side (reject drops/edits inside a 5-minute buffer with a clear message) to avoid a failed create leaving the calendar empty after the delete succeeded — or, safer, **create-then-delete** (create new first; only delete old if create succeeds) to avoid losing the post on a failed reschedule.

---

## Phased build plan (each behind the flag, test before advancing)

1. **Account + read-only calendar.** `friendica_accounts` table, Settings UI to add an account (label, base_url, username, paste token), `testConnection` via `verify_credentials`, `syncFriendica` pull-only, render existing scheduled posts on the calendar (no editing). Proves the loop end-to-end with zero write risk.
2. **Create + delete.** `PostDetailPanel` compose → `createScheduled`; delete from the panel/context menu. Now you can schedule and cancel from the calendar.
3. **Reschedule + media + routing tags.** Drag-to-reschedule (create-then-delete), image upload, the tag checkboxes wired to n8n. This is the point where "compose once → fan out" works.
4. **Sync polish.** Periodic refresh, published/failed inference, optional timeline confirmation, multi-account.

---

## Open decisions (for Arlis)

1. ✅ **Source of truth — DECIDED: Friendica-authoritative + local mirror.** Settled by the always-on server / not-always-on app fact (see "Architecture fit"). Firing must be server-side.
2. ✅ **Drafts — DECIDED: yes, un-timed local drafts allowed.** `state='draft'` is local-only (no API call); assigning a `scheduled_at` pushes it to Friendica and flips it to `state='scheduled'`.
3. **Which accounts/brands** — start with just `hunter@precisioncrab.com`, or model all brand accounts from day one? (Table supports many; UI can start with one.)
4. **Routing tags in the composer** — surface the n8n tag set as checkboxes (recommended — it's the whole point of composing here), or keep the body free-form?
5. **Reschedule safety** — create-then-delete (never lose a post, brief chance of a duplicate in the queue) vs delete-then-create (never a duplicate, small chance of loss on failure). Recommendation: create-then-delete.
