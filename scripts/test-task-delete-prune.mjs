// Tests for the 2026-11-10 code review fixes in electron/db.ts:
//   finding 3: taskDelete covers the whole subtree (soft + hard)
//   finding 2: tasksPruneMissing removes tasks deleted on the server
//   finding 1: listHasData / addressBookHasData (what a username change may drop)
// and the 2026-11-11 review fixes:
//   finding 3: hard task/event deletes and the event prune remove reminders
//   finding 1: hrefInCollection / listDetachForeignSyncIdentity (linking a list
//              to another calendar uploads its rows instead of pruning them)
// Bundles the REAL electron/db.ts with rolldown, with "electron" replaced by a stub
// whose app.getPath() points at a temp folder, so the database is a throwaway file.
// Run from the repo root: node scripts/test-task-delete-prune.mjs
import { build } from "rolldown";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const here = import.meta.dirname;
const out = mkdtempSync(join(tmpdir(), "daynizer-db-test-"));
const dataDir = join(out, "userData");
process.env.DAYNIZER_TEST_USERDATA = dataDir;

const electronStub = {
  name: "electron-stub",
  resolveId(id) { return id === "electron" ? "\0electron-stub" : null; },
  load(id) {
    if (id !== "\0electron-stub") return null;
    return `export const app = { getPath: () => process.env.DAYNIZER_TEST_USERDATA };`;
  }
};

let failures = 0;
let rawDb = null;
function check(cond, label) {
  console.log(`${cond ? "ok:  " : "FAIL:"} ${label}`);
  if (!cond) failures++;
}

try {
  const file = join(out, "db.mjs");
  await build({
    input: resolve(here, "../electron/db.ts"),
    platform: "node",
    logLevel: "warn",
    plugins: [electronStub],
    external: [/^node:/],
    output: { file, format: "esm" }
  });
  const db = await import(pathToFileURL(file).href);
  const raw = db.getDb();
  rawDb = raw;
  const row = (id) => raw.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  const synced = (id, uid) =>
    raw.prepare(`UPDATE tasks SET caldav_uid = ?, caldav_href = ?, caldav_etag = 'e1', dirty = 0 WHERE id = ?`).run(uid, `/cal/${uid}.ics`, id);

  // ---- finding 3: soft delete reaches every level, undo restores exactly those
  console.log("\n== taskDelete (soft)");
  const L = db.listCreate("Soft");
  const A = db.taskCreate({ list_id: L.id, title: "A" });
  const B = db.taskCreate({ list_id: L.id, title: "B", parent_id: A.id });
  const C = db.taskCreate({ list_id: L.id, title: "C", parent_id: B.id });
  const D = db.taskCreate({ list_id: L.id, title: "D", parent_id: C.id });
  const other = db.taskCreate({ list_id: L.id, title: "unrelated" });
  const already = db.taskCreate({ list_id: L.id, title: "already deleted", parent_id: B.id });
  raw.prepare(`UPDATE tasks SET deleted = 1 WHERE id = ?`).run(already.id);
  const changed = db.taskDelete(A.id);
  check([A, B, C, D].every((t) => row(t.id).deleted === 1), "A, B, grandchild C and great-grandchild D all deleted");
  check(row(other.id).deleted === 0, "unrelated task untouched");
  check(changed.length === 4 && [A, B, C, D].every((t) => changed.includes(t.id)), "returns the 4 ids it deleted");
  check(!changed.includes(already.id), "an already-deleted subtask is not in the undo list");
  for (const id of changed) db.taskUpdate(id, { deleted: 0 });
  check([A, B, C, D].every((t) => row(t.id).deleted === 0), "undo brings back every level");
  check(row(already.id).deleted === 1, "undo leaves the earlier delete alone");

  // cycle in bad data must not hang
  const X = db.taskCreate({ list_id: L.id, title: "X" });
  const Y = db.taskCreate({ list_id: L.id, title: "Y", parent_id: X.id });
  raw.prepare(`UPDATE tasks SET parent_id = ? WHERE id = ?`).run(Y.id, X.id);
  const cyc = db.taskDelete(X.id);
  check(cyc.length === 2, "a parent_id cycle ends (2 ids, no hang)");

  // ---- finding 3: hard delete keeps synced descendants as tombstones
  console.log("\n== taskDelete (hard)");
  const H = db.listCreate("Hard");
  const P = db.taskCreate({ list_id: H.id, title: "P" });
  const Q = db.taskCreate({ list_id: H.id, title: "Q synced", parent_id: P.id });
  const R = db.taskCreate({ list_id: H.id, title: "R local", parent_id: Q.id });
  synced(Q.id, "q-uid");
  const hardRet = db.taskDelete(P.id, true);
  check(!row(P.id), "the task row itself is removed");
  check(row(Q.id)?.deleted === 1, "synced subtask kept as a tombstone (server delete still pending)");
  check(!row(R.id), "never-synced grandchild removed");
  check(Array.isArray(hardRet) && hardRet.length === 0, "hard delete returns []");

  // ---- finding 2: prune tasks deleted on the server
  console.log("\n== tasksPruneMissing");
  const S = db.listCreate("Sync");
  const gone = db.taskCreate({ list_id: S.id, title: "deleted on phone" });
  synced(gone.id, "gone");
  const goneKid = db.taskCreate({ list_id: S.id, title: "child of deleted", parent_id: gone.id });
  synced(goneKid.id, "kid");
  const dirtyGone = db.taskCreate({ list_id: S.id, title: "edited here, deleted there" });
  synced(dirtyGone.id, "dirty-gone");
  raw.prepare(`UPDATE tasks SET dirty = 1 WHERE id = ?`).run(dirtyGone.id);
  const present = db.taskCreate({ list_id: S.id, title: "still on server" });
  synced(present.id, "present");
  const local = db.taskCreate({ list_id: S.id, title: "never synced" });
  const tomb = db.taskCreate({ list_id: S.id, title: "local delete pending" });
  synced(tomb.id, "tomb");
  raw.prepare(`UPDATE tasks SET deleted = 1 WHERE id = ?`).run(tomb.id);
  const otherList = db.listCreate("Other");
  const elsewhere = db.taskCreate({ list_id: otherList.id, title: "other list" });
  synced(elsewhere.id, "elsewhere");
  raw.prepare(`INSERT INTO reminders (id, owner_type, owner_id, offset_minutes, created_at) VALUES ('rem1', 'task', ?, 15, ?)`).run(gone.id, new Date().toISOString());

  const removed = db.tasksPruneMissing(S.id, new Set(["kid", "present"]));
  check(removed === 1, "removes exactly 1 task");
  check(!row(gone.id), "clean task missing on the server is removed");
  check(!raw.prepare(`SELECT 1 FROM reminders WHERE id = 'rem1'`).get(), "its reminder goes too");
  check(row(goneKid.id) && row(goneKid.id).parent_id === null, "its surviving subtask moves to the top level");
  check(row(goneKid.id).dirty === 0, "and isn't marked dirty by that");
  check(row(dirtyGone.id)?.deleted === 0, "a task with a pending local edit is kept");
  check(row(present.id)?.deleted === 0, "a task still on the server is kept");
  check(row(local.id)?.deleted === 0, "a never-synced task is kept");
  check(row(tomb.id)?.deleted === 1, "a pending local delete is left for the push");
  check(row(elsewhere.id)?.deleted === 0, "tasks in other lists are untouched");

  // ---- finding 1: what counts as "holds data"
  console.log("\n== listHasData / addressBookHasData");
  const empty = db.listCreate("Empty");
  check(db.listHasData(empty.id) === false, "empty list: no data");
  const onlyDeleted = db.listCreate("Only deleted");
  const dt = db.taskCreate({ list_id: onlyDeleted.id, title: "x" });
  raw.prepare(`UPDATE tasks SET deleted = 1 WHERE id = ?`).run(dt.id);
  check(db.listHasData(onlyDeleted.id) === false, "list with only deleted tasks: no data");
  const withTask = db.listCreate("With task");
  db.taskCreate({ list_id: withTask.id, title: "keep me" });
  check(db.listHasData(withTask.id) === true, "list with a task: has data");
  const withEvent = db.listCreate("With event");
  db.eventCreate({ list_id: withEvent.id, title: "meeting", start_date: "2026-11-10T10:00:00" });
  check(db.listHasData(withEvent.id) === true, "list with only an event: has data");
  const book = db.addressBookCreate("Book");
  check(db.addressBookHasData(book.id) === false, "empty address book: no data");
  db.contactCreate({ address_book_id: book.id, fn: "Pat" });
  check(db.addressBookHasData(book.id) === true, "address book with a contact: has data");

  // ---- 2026-11-11 finding 3: hard deletes take their reminders along
  console.log("\n== reminders on hard delete");
  const rem = (id, type, owner) =>
    raw.prepare(`INSERT INTO reminders (id, owner_type, owner_id, offset_minutes, created_at) VALUES (?, ?, ?, 15, ?)`).run(id, type, owner, new Date().toISOString());
  const hasRem = (id) => !!raw.prepare(`SELECT 1 FROM reminders WHERE id = ?`).get(id);
  const RL = db.listCreate("Reminders");
  const rp = db.taskCreate({ list_id: RL.id, title: "parent" });
  const rq = db.taskCreate({ list_id: RL.id, title: "synced child", parent_id: rp.id });
  const rr = db.taskCreate({ list_id: RL.id, title: "local child", parent_id: rp.id });
  synced(rq.id, "rq-uid");
  rem("r-p", "task", rp.id); rem("r-q", "task", rq.id); rem("r-r", "task", rr.id);
  const softP = db.taskCreate({ list_id: RL.id, title: "soft" });
  rem("r-soft", "task", softP.id);
  db.taskDelete(softP.id);
  check(hasRem("r-soft"), "soft delete keeps the reminder (for undo)");
  db.taskDelete(rp.id, true);
  check(!hasRem("r-p"), "hard-deleted task's reminder removed");
  check(!hasRem("r-r"), "removed local subtask's reminder removed");
  check(hasRem("r-q"), "tombstoned synced subtask keeps its reminder for now");
  db.taskDelete(rq.id, true);
  check(!hasRem("r-q"), "and loses it when its own hard delete runs");
  const ev = db.eventCreate({ list_id: RL.id, title: "ev", start_date: "2026-11-12T10:00:00" });
  rem("r-ev", "event", ev.id);
  db.eventDelete(ev.id, true);
  check(!hasRem("r-ev"), "hard-deleted event's reminder removed");
  const ev2 = db.eventCreate({ list_id: RL.id, title: "ev2", start_date: "2026-11-12T11:00:00" });
  raw.prepare(`UPDATE events SET caldav_uid = 'ev2-uid', dirty = 0 WHERE id = ?`).run(ev2.id);
  rem("r-ev2", "event", ev2.id);
  db.eventsPruneMissing(RL.id, new Set());
  check(!raw.prepare(`SELECT 1 FROM events WHERE id = ?`).get(ev2.id) && !hasRem("r-ev2"), "pruned event's reminder removed");

  // ---- 2026-11-11 finding 1: linking a list to another calendar
  console.log("\n== hrefInCollection");
  const cal = "https://nas.local/dav/work/";
  check(db.hrefInCollection("https://nas.local/dav/work/a.ics", cal), "absolute href inside");
  check(db.hrefInCollection("http://NAS.local:443/dav/work/a.ics", "https://nas.local/dav/work"), "scheme, port, host case and trailing slash ignored");
  check(db.hrefInCollection("/dav/work/a.ics", cal), "relative href inside");
  check(!db.hrefInCollection("https://nas.local/dav/workshop/a.ics", cal), "sibling calendar with a longer name is outside");
  check(!db.hrefInCollection("https://nas.local/dav/home/a.ics", cal), "other calendar outside");
  check(!db.hrefInCollection(null, cal), "no href: outside");

  console.log("\n== listDetachForeignSyncIdentity");
  const ML = db.listCreate("Moving");
  const setHref = (id, uid, href) =>
    raw.prepare(`UPDATE tasks SET caldav_uid = ?, caldav_href = ?, caldav_etag = 'e1', dirty = 0 WHERE id = ?`).run(uid, href, id);
  const mine = db.taskCreate({ list_id: ML.id, title: "already in WORK" });
  setHref(mine.id, "m1", "https://nas.local/dav/work/m1.ics");
  const foreign = db.taskCreate({ list_id: ML.id, title: "from HOME" });
  setHref(foreign.id, "f1", "https://nas.local/dav/home/f1.ics");
  const foreignTomb = db.taskCreate({ list_id: ML.id, title: "deleted, from HOME" });
  setHref(foreignTomb.id, "f2", "https://nas.local/dav/home/f2.ics");
  raw.prepare(`UPDATE tasks SET deleted = 1 WHERE id = ?`).run(foreignTomb.id);
  const fresh = db.taskCreate({ list_id: ML.id, title: "never synced" });
  const fev = db.eventCreate({ list_id: ML.id, title: "event from HOME", start_date: "2026-11-12T09:00:00" });
  raw.prepare(`UPDATE events SET caldav_uid = 'fe1', caldav_href = 'https://nas.local/dav/home/fe1.ics', caldav_etag = 'e', dirty = 0 WHERE id = ?`).run(fev.id);
  const n = db.listDetachForeignSyncIdentity(ML.id, cal);
  check(n === 2, "2 rows detached (the HOME task and the HOME event)");
  check(row(mine.id).caldav_uid === "m1" && row(mine.id).dirty === 0, "task already in the target calendar keeps its identity");
  const f = row(foreign.id);
  check(f.caldav_uid === null && f.caldav_href === null && f.caldav_etag === null && f.dirty === 1, "foreign task: identity cleared, marked dirty");
  check(row(foreignTomb.id).caldav_uid === "f2", "tombstone left alone");
  check(row(fresh.id).caldav_uid === null, "never-synced task unchanged");
  const fe = raw.prepare(`SELECT * FROM events WHERE id = ?`).get(fev.id);
  check(fe.caldav_uid === null && fe.dirty === 1, "foreign event: identity cleared, marked dirty");
  // WORK's listing holds only m1: the detached HOME rows are dirty, so the prune leaves them for the push.
  check(db.tasksPruneMissing(ML.id, new Set(["m1"])) === 0, "after detaching, WORK's listing prunes nothing that came from HOME");
  check(!!row(foreign.id) && !!row(fresh.id), "HOME task and never-synced task still there");

  // ---- 2026-11-14: right-click a list, Merge into…
  console.log("\n== listMergeInto / listRowCount");
  const SRC = db.listCreate("Source");
  const DST = db.listCreate("Target");
  const sp = db.taskCreate({ list_id: SRC.id, title: "synced parent" });
  setHref(sp.id, "sp-uid", "https://nas.local/dav/src/sp.ics");
  const sc = db.taskCreate({ list_id: SRC.id, parent_id: sp.id, title: "synced child" });
  setHref(sc.id, "sc-uid", "https://nas.local/dav/src/sc.ics");
  const lt = db.taskCreate({ list_id: SRC.id, title: "local task" });
  rem("r-merge", "task", sp.id);
  const sev = db.eventCreate({ list_id: SRC.id, title: "synced event", start_date: "2026-11-14T09:00:00" });
  raw.prepare(`UPDATE events SET caldav_uid = 'sev-uid', caldav_href = 'https://nas.local/dav/src/sev.ics', caldav_etag = 'e', dirty = 0 WHERE id = ?`).run(sev.id);
  const lev = db.eventCreate({ list_id: SRC.id, title: "local event", start_date: "2026-11-15T09:00:00" });
  const delT = db.taskCreate({ list_id: SRC.id, title: "already deleted" });
  raw.prepare(`UPDATE tasks SET deleted = 1 WHERE id = ?`).run(delT.id);
  const moved = db.listMergeInto(SRC.id, DST.id);
  check(moved.tasks === 3 && moved.events === 2, "3 tasks and 2 events moved (the deleted task stays behind)");
  const p2 = row(sp.id), c2 = row(sc.id), l2 = row(lt.id);
  check(p2.list_id === DST.id && c2.list_id === DST.id && l2.list_id === DST.id, "tasks now on the target");
  check(c2.parent_id === sp.id, "subtask keeps its parent");
  check(p2.caldav_uid === null && p2.caldav_href === null && p2.dirty === 1, "synced task: identity cleared, dirty, so it's pushed new");
  check(hasRem("r-merge"), "reminder kept (it follows the task id)");
  const tombs = raw.prepare(`SELECT caldav_uid, caldav_href, deleted FROM tasks WHERE list_id = ? AND deleted = 1 AND caldav_uid IS NOT NULL`).all(SRC.id);
  check(tombs.length === 2 && tombs.every((t) => t.caldav_href.includes("/dav/src/")), "two task tombstones on the source carry the old server addresses");
  const ev2m = raw.prepare(`SELECT * FROM events WHERE id = ?`).get(sev.id);
  check(ev2m.list_id === DST.id && ev2m.caldav_uid === null && ev2m.dirty === 1, "synced event moved, identity cleared, dirty");
  check(raw.prepare(`SELECT list_id FROM events WHERE id = ?`).get(lev.id).list_id === DST.id, "local event moved");
  const etomb = raw.prepare(`SELECT * FROM events WHERE list_id = ? AND deleted = 1`).all(SRC.id);
  check(etomb.length === 1 && etomb[0].caldav_uid === "sev-uid" && etomb[0].caldav_href.endsWith("sev.ics"), "event tombstone on the source");
  check(db.listRowCount(SRC.id) === 3, "source still holds the 3 tombstones (not the never-synced deleted task): not removed yet");
  raw.prepare(`DELETE FROM tasks WHERE list_id = ? AND caldav_uid IS NOT NULL`).run(SRC.id);
  raw.prepare(`DELETE FROM events WHERE list_id = ?`).run(SRC.id);
  check(db.listRowCount(SRC.id) === 0, "after the deletes are pushed: 0, safe to remove (the old deleted task doesn't block it)");
  check(db.listRowCount(DST.id) === 5, "target holds the 5 moved items");
  let threw = false;
  try { db.listMergeInto(DST.id, DST.id); } catch { threw = true; }
  check(threw, "merging a list into itself is refused");
} catch (err) {
  console.error(err);
  failures++;
} finally {
  try { rawDb?.close(); } catch { /* already closed */ }
  try { rmSync(out, { recursive: true, force: true }); } catch { /* temp folder; Windows may hold it briefly */ }
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exitCode = failures ? 1 : 0;
