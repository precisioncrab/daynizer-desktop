// Tests for Copy to... in the app (electron/copyTo.ts): accounts from the real
// database, tsdav discovery, folder names, linking the copy into Daynizer, and
// Copy everything to... run twice. Two throwaway Radicale servers
// (scripts/radicale-test-server.mjs); the db is a temp file (electron stubbed,
// as in test-task-delete-prune.mjs). Never touches a real server.
// Run from the repo root: node scripts/test-copy-to.mjs
import { build } from "rolldown";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startRadicale } from "./radicale-test-server.mjs";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
process.removeAllListeners("warning");

const here = import.meta.dirname;
const out = mkdtempSync(join(tmpdir(), "daynizer-copyto-test-"));
process.env.DAYNIZER_TEST_USERDATA = join(out, "userData");

const electronStub = {
  name: "electron-stub",
  resolveId(id) { return id === "electron" ? "\0electron-stub" : null; },
  load(id) {
    if (id !== "\0electron-stub") return null;
    return `export const app = { getPath: () => process.env.DAYNIZER_TEST_USERDATA, isPackaged: false };
export const safeStorage = { isEncryptionAvailable: () => false };`;
  }
};

let failures = 0;
function check(cond, label) {
  console.log(`${cond ? "ok:  " : "FAIL:"} ${label}`);
  if (!cond) failures++;
}

const CRLF = "\r\n";
const ics = (...l) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN", ...l, "END:VCALENDAR", ""].join(CRLF);
const vcf = (...l) => ["BEGIN:VCARD", "VERSION:3.0", ...l, "END:VCARD", ""].join(CRLF);

async function req(srv, user, method, path, body, headers = {}) {
  const r = await fetch(new URL(path, srv.url), {
    method, body,
    headers: { Authorization: "Basic " + Buffer.from(`${user}:pw`).toString("base64"), ...(body != null ? { "Content-Length": String(Buffer.byteLength(body)) } : {}), ...headers }
  });
  return { status: r.status, text: await r.text() };
}
async function seed(srv, user, coll, kind, items, props) {
  const body = kind === "calendar"
    ? `<?xml version="1.0"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/"><d:set><d:prop>${props}</d:prop></d:set></c:mkcalendar>`
    : `<?xml version="1.0"?><d:mkcol xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:set><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>${props}</d:prop></d:set></d:mkcol>`;
  const m = await req(srv, user, kind === "calendar" ? "MKCALENDAR" : "MKCOL", `${user}/${coll}/`, body, { "Content-Type": "application/xml" });
  if (m.status !== 201) throw new Error(`seed ${coll}: ${m.status}`);
  for (const [name, text] of Object.entries(items)) {
    const r = await req(srv, user, "PUT", `${user}/${coll}/${name}`, text, { "Content-Type": kind === "calendar" ? "text/calendar" : "text/vcard" });
    if (r.status !== 201) throw new Error(`seed ${coll}/${name}: ${r.status} ${r.text}`);
  }
}

let src, dst;
try {
  const file = join(out, "copyto.mjs");
  await build({
    input: resolve(here, "../electron/copyTo.ts"),
    platform: "node",
    plugins: [electronStub],
    external: [/^node:/],
    output: { file, format: "esm", exports: "named" },
    logLevel: "silent"
  });
  const dbFile = join(out, "db.mjs");
  await build({ input: resolve(here, "../electron/db.ts"), platform: "node", plugins: [electronStub], external: [/^node:/], output: { file: dbFile, format: "esm" }, logLevel: "silent" });
  // copyTo.mjs bundles its own copy of db.ts; both open the same temp database file.
  const C = await import(pathToFileURL(file).href);
  const db = await import(pathToFileURL(dbFile).href);

  src = await startRadicale({ users: { src: "pw" }, tls: true });
  dst = await startRadicale({ users: { dst: "pw" } });

  await seed(src, "src", "groceries", "calendar", {
    "p.ics": ics("BEGIN:VTODO", "UID:p@test", "DTSTAMP:20261101T120000Z", "SUMMARY:Parent", "END:VTODO"),
    "c.ics": ics("BEGIN:VTODO", "UID:c@test", "DTSTAMP:20261101T120000Z", "SUMMARY:Child", "RELATED-TO;RELTYPE=PARENT:p@test", "END:VTODO")
  }, '<d:displayname>Groceries</d:displayname><ic:calendar-color>#22AA44FF</ic:calendar-color><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>');
  await seed(src, "src", "home", "calendar", {
    "e.ics": ics("BEGIN:VEVENT", "UID:e@test", "DTSTAMP:20261101T120000Z", "DTSTART:20261201T150000Z", "SUMMARY:Event", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT5M", "END:VALARM", "END:VEVENT")
  }, '<d:displayname>Home</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>');
  await seed(src, "src", "contacts", "addressbook", {
    "a.vcf": vcf("UID:a@test", "FN:Alice"),
    "b.vcf": vcf("UID:b@test", "FN:Bob")
  }, "<d:displayname>My Contacts</d:displayname>");

  // Accounts as Settings makes them (password stored by encryptPassword: base64 here).
  const enc = (p) => Buffer.from(p, "utf8").toString("base64");
  const sAcc = db.accountCreate({ label: "Synology (test)", server_url: src.url, username: "src", password_enc: enc("pw"), principal_url: null });
  db.accountUpdate(sAcc.id, { carddav_url: src.url });
  const tAcc = db.accountCreate({ label: "Radicale (test)", server_url: dst.url, username: "dst", password_enc: enc("pw"), principal_url: null });
  db.accountUpdate(tAcc.id, { carddav_url: dst.url });

  // Daynizer shows the source's Groceries list and My Contacts book.
  const groceries = db.listCreate("Groceries", "#22aa44");
  db.listUpdate(groceries.id, { caldav_account_id: sAcc.id, caldav_calendar_url: `${src.url}src/groceries/` });
  const book = db.addressBookCreate("My Contacts");
  db.addressBookUpdate(book.id, { carddav_account_id: sAcc.id, carddav_addressbook_url: `${src.url}src/contacts/` });

  // ---- one list: plan, new collection, linked into Daynizer ----
  const plan = await C.copyPlan("calendar", groceries.id, tAcc.id);
  check(plan.sourceName === "Groceries" && plan.collections.length === 0 && plan.sameFolderUrl === null, `plan on an empty target (${JSON.stringify(plan)})`);
  const progress = [];
  const o1 = await C.copyOne("calendar", groceries.id, tAcc.id, null, (p) => progress.push(p));
  check(!o1.error && o1.report.copied === 2 && o1.report.complete && o1.report.targetUrl === `${dst.url}dst/groceries/`, `list copied into a new folder with the source's name (${o1.error ?? o1.report.targetUrl})`);
  check(progress.length > 0 && progress.every((p) => p.collection === "Groceries"), "progress names the list");
  const linked = db.listsAll().find((l) => l.id === o1.linkedId);
  check(linked && linked.caldav_account_id === tAcc.id && linked.caldav_calendar_url === `${dst.url}dst/groceries/` && linked.name === "Groceries" && linked.color === "#22aa44",
    "the copy is a new Daynizer list on the target account, same name and color");
  const srcList = db.listsAll().find((l) => l.id === groceries.id);
  check(srcList.caldav_account_id === sAcc.id && srcList.caldav_calendar_url === `${src.url}src/groceries/`, "the source list is untouched in Daynizer");

  // ---- again: the dialog now offers the earlier copy; copying into it adds nothing ----
  const plan2 = await C.copyPlan("calendar", groceries.id, tAcc.id);
  check(plan2.sameFolderUrl === `${dst.url}dst/groceries/` && plan2.collections.some((c) => c.name === "Groceries"), "second plan offers the earlier copy (same folder name)");
  const o2 = await C.copyOne("calendar", groceries.id, tAcc.id, plan2.sameFolderUrl, () => {});
  check(!o2.error && o2.report.copied === 0 && o2.report.already === 2 && o2.linkedId === o1.linkedId, "copying into it again: 2 already there, same Daynizer list reused");
  check(db.listsAll().filter((l) => l.caldav_account_id === tAcc.id).length === 1, "no second Daynizer list for the same collection");

  // ---- address book ----
  const o3 = await C.copyOne("addressbook", book.id, tAcc.id, null, () => {});
  check(!o3.error && o3.report.copied === 2 && o3.report.complete, "address book copied");
  const tBook = db.addressBooksAll().find((b) => b.id === o3.linkedId);
  check(tBook && tBook.carddav_account_id === tAcc.id && tBook.carddav_addressbook_url === `${dst.url}dst/contacts/` && tBook.name === "My Contacts", "the copy is a new Daynizer address book on the target account");

  // ---- Copy everything to...: reuses the folders made above, makes the rest ----
  const all = await C.copyAllPlan(sAcc.id, tAcc.id);
  const byName = Object.fromEntries(all.map((i) => [i.name, i]));
  check(all.length === 3 && byName.Groceries?.existingTargetUrl === `${dst.url}dst/groceries/` && byName.Home?.existingTargetUrl === null && byName["My Contacts"]?.kind === "addressbook",
    `copy-all plan lists every calendar and book, and which already exist (${JSON.stringify(all.map((i) => [i.name, i.kind, !!i.existingTargetUrl]))})`);
  const allProgress = [];
  const outs = await C.copyAll(sAcc.id, tAcc.id, all.map(({ kind, url, name }) => ({ kind, url, name })), (p) => allProgress.push(p));
  const r = Object.fromEntries(outs.map((o) => [o.sourceName, o]));
  check(outs.every((o) => !o.error && o.report.complete), `copy-all: every collection complete (${outs.map((o) => o.error ?? "ok").join(", ")})`);
  check(r.Groceries.report.already === 2 && !r.Groceries.report.createdTarget && r.Home.report.copied === 1 && r.Home.report.createdTarget && r["My Contacts"].report.already === 2,
    "copy-all: existing copies only checked, Home made new");
  check(allProgress.some((p) => p.index === 2 && p.count === 3), "copy-all progress counts collections");
  const home = db.listsAll().find((l) => l.id === r.Home.linkedId);
  check(home && home.caldav_calendar_url === `${dst.url}dst/home/` && home.name === "Home", "Home (not shown in Daynizer before) is now a list on the target");

  // ---- copy-all a second time: nothing new anywhere ----
  const outs2 = await C.copyAll(sAcc.id, tAcc.id, all.map(({ kind, url, name }) => ({ kind, url, name })), () => {});
  check(outs2.every((o) => !o.error && o.report.copied === 0 && !o.report.createdTarget && o.report.complete), "second copy-all copies nothing and makes no new folders");
  const tCols = (await req(dst, "dst", "PROPFIND", "dst/", '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>', { Depth: "1" })).text;
  check((tCols.match(/<response>/g) || []).length === 4, "target holds exactly 3 collections (plus its home)");

  // ---- errors: a local list, and a wrong password ----
  const local = db.listCreate("Local only");
  let threw = null;
  try { await C.copyPlan("calendar", local.id, tAcc.id); } catch (e) { threw = e; }
  check(threw && /isn't on a server/.test(threw.message), "a local list can't be copied (it has no server items)");
  db.accountUpdate(sAcc.id, { password_enc: enc("wrong") });
  const bad = await C.copyOne("calendar", groceries.id, tAcc.id, null, () => {});
  check(bad.error && /401/.test(bad.error) && !bad.report, `wrong source password: reported, nothing made (${bad.error})`);
} catch (e) {
  failures++;
  console.log("FAIL: test crashed:", e);
} finally {
  await src?.stop();
  await dst?.stop();
  try { rmSync(out, { recursive: true, force: true }); } catch { /* temp, sqlite may hold it */ }
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
