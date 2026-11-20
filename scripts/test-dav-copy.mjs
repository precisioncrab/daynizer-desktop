// Tests for Copy to... (electron/davcopy.ts) against two throwaway Radicale
// servers (scripts/radicale-test-server.mjs): the source over https with a
// self-signed certificate (like a Synology or Radicale on the LAN), the target
// over http with a 60 kB request limit so one large contact photo fails.
// Never touches a real server.
// Run from the repo root: node scripts/test-dav-copy.mjs
import { build } from "rolldown";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startRadicale } from "./radicale-test-server.mjs";

// The app sets this when Settings allows self-signed certificates.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
process.removeAllListeners("warning");

const here = import.meta.dirname;
const out = mkdtempSync(join(tmpdir(), "daynizer-davcopy-test-"));
let failures = 0;
function check(cond, label) {
  console.log(`${cond ? "ok:  " : "FAIL:"} ${label}`);
  if (!cond) failures++;
}

const CRLF = "\r\n";
const ics = (...lines) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//Synology-like//EN", ...lines, "END:VCALENDAR", ""].join(CRLF);
const vcf = (...lines) => ["BEGIN:VCARD", "VERSION:3.0", ...lines, "END:VCARD", ""].join(CRLF);
const fold = (line) => line.match(/.{1,74}/g).join(`${CRLF} `);
const b64 = (n) => Buffer.alloc(n, 7).toString("base64");

const TZ = ["BEGIN:VTIMEZONE", "TZID:America/New_York", "BEGIN:STANDARD", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "END:STANDARD", "BEGIN:DAYLIGHT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "END:DAYLIGHT", "END:VTIMEZONE"];

const EVENTS = {
  "weekly-standup.ics": ics(...TZ,
    "BEGIN:VEVENT", "UID:standup-0001@test", "DTSTAMP:20261101T120000Z",
    "DTSTART;TZID=America/New_York:20261102T090000", "DTEND;TZID=America/New_York:20261102T093000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;TZID=America/New_York:20261116T090000",
    "SUMMARY:Weekly standup", "ATTENDEE;CN=Pat;PARTSTAT=ACCEPTED:mailto:pat@example.com",
    "ORGANIZER;CN=Arlis:mailto:arlis@example.com",
    "ATTACH;FMTTYPE=text/plain;ENCODING=BASE64;VALUE=BINARY:aGVsbG8gd29ybGQ=",
    "X-SYNO-EVT-COLOR:#ff8800", "X-OTHER-APP-PROP;X-P=1:kept as is",
    "BEGIN:VALARM", "UID:alarm-uid-before-nothing", "ACTION:DISPLAY", "DESCRIPTION:Standup", "TRIGGER:-PT10M", "END:VALARM",
    "END:VEVENT",
    "BEGIN:VEVENT", "UID:standup-0001@test", "DTSTAMP:20261101T120000Z",
    "RECURRENCE-ID;TZID=America/New_York:20261109T090000",
    "DTSTART;TZID=America/New_York:20261109T100000", "DTEND;TZID=America/New_York:20261109T103000",
    "SUMMARY:Weekly standup (moved)", "END:VEVENT"),
  "dentist.ics": ics(
    "BEGIN:VEVENT", "DTSTAMP:20261101T120000Z",
    // A VALARM with its own UID BEFORE the event's UID: the copy must key on the event's.
    "BEGIN:VALARM", "UID:alarm-first", "ACTION:AUDIO", "TRIGGER:-P1D", "END:VALARM",
    "UID:dentist-0002@test", "DTSTART;VALUE=DATE:20261203", "DTEND;VALUE=DATE:20261204",
    "SUMMARY:Dentist", fold(`DESCRIPTION:${"A long description line that has to be folded across several lines to test that folding survives the copy. ".repeat(2)}`),
    "END:VEVENT")
};

const TASKS = {
  "parent.ics": ics("BEGIN:VTODO", "UID:task-parent@test", "DTSTAMP:20261101T120000Z", "SUMMARY:Groceries trip", "X-APPLE-SORT-ORDER:1", "END:VTODO"),
  "child-a.ics": ics("BEGIN:VTODO", "UID:task-child-a@test", "DTSTAMP:20261101T120000Z", "SUMMARY:Milk", "RELATED-TO;RELTYPE=PARENT:task-parent@test", "END:VTODO"),
  "child-b.ics": ics("BEGIN:VTODO", "UID:task-child-b@test", "DTSTAMP:20261101T120000Z", "SUMMARY:Eggs", "RELATED-TO:task-parent@test", "STATUS:COMPLETED", "COMPLETED:20261105T100000Z", "PERCENT-COMPLETE:100", "END:VTODO"),
  "alarm-task.ics": ics("BEGIN:VTODO", "UID:task-alarm@test", "DTSTAMP:20261101T120000Z", "SUMMARY:Call the vet", "DUE:20261125T150000Z",
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Vet", "TRIGGER;RELATED=END:-PT30M", "END:VALARM", "END:VTODO")
};

const CONTACTS = {
  "pat.vcf": vcf("UID:contact-pat@test", "FN:Pat Smith", "N:Smith;Pat;;;", "EMAIL;TYPE=INTERNET:pat@example.com",
    fold(`PHOTO;ENCODING=b;TYPE=JPEG:${b64(3000)}`), "X-SOCIALPROFILE;TYPE=xmpp:pat@xmpp.example", "CATEGORIES:Friends"),
  "big-photo.vcf": vcf("UID:contact-big@test", "FN:Big Photo Person", "N:Person;Big Photo;;;", fold(`PHOTO;ENCODING=b;TYPE=JPEG:${b64(80000)}`)),
  "lee.vcf": vcf("UID:contact-lee@test", "FN:Lee Jones", "N:Jones;Lee;;;", "TEL;TYPE=CELL:+1 555 0100", "item1.X-ABLabel:custom"),
  "group-friends.vcf": vcf("UID:group-friends@test", "FN:Friends", "N:Friends;;;;", "X-ADDRESSBOOKSERVER-KIND:group",
    "X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:contact-pat@test", "X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:contact-lee@test")
};
// Radicale refuses (and skips) a card without UID, and file names with spaces or
// colons; Synology can hold both. Those cases come from a fake in-memory source.
const NO_UID = vcf("FN:No Uid Card", "N:Card;No Uid;;;");

/** A read-only fake DAV collection at `base`: PROPFIND (Depth 0 and 1) and GET,
 *  like a Synology. Every other method fails the test. */
function fakeSource(base, kind, items, displayName) {
  const seen = [];
  const res = (status, text, type = "application/xml") => {
    const body = Buffer.from(text, "utf8");
    return { status, headers: { get: (n) => (n.toLowerCase() === "content-type" ? type : null) }, text: async () => text, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) };
  };
  const path = new URL(base).pathname;
  const fetch = async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    seen.push(method);
    const u = new URL(url);
    if (method === "PROPFIND" && u.pathname === path) {
      const rt = kind === "calendar" ? "<d:collection/><c:calendar/>" : "<d:collection/><card:addressbook/>";
      const self = `<d:response><d:href>${path}</d:href><d:propstat><d:prop><d:displayname>${displayName}</d:displayname><d:resourcetype>${rt}</d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
      const kids = init.headers?.Depth === "1" ? Object.keys(items).map((n) => `<d:response><d:href>${path}${n}</d:href><d:propstat><d:prop><d:getetag>"${n}"</d:getetag><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join("") : "";
      return res(207, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:card="urn:ietf:params:xml:ns:carddav">${self}${kids}</d:multistatus>`);
    }
    if (method === "GET") {
      const name = u.pathname.slice(path.length);
      if (name in items) return res(200, items[name], kind === "calendar" ? "text/calendar; charset=utf-8" : "text/vcard; charset=utf-8");
      return res(404, "not found", "text/plain");
    }
    return res(405, "fake source is read-only", "text/plain");
  };
  return { fetch, seen };
}

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
  if (m.status !== 201) throw new Error(`seed ${coll}: ${m.status} ${m.text}`);
  for (const [name, text] of Object.entries(items)) {
    const r = await req(srv, user, "PUT", `${user}/${coll}/${name}`, text, { "Content-Type": kind === "calendar" ? "text/calendar" : "text/vcard" });
    if (r.status !== 201) throw new Error(`seed ${coll}/${name}: ${r.status} ${r.text}`);
  }
}

async function snapshot(srv, user, coll) {
  const r = await req(srv, user, "PROPFIND", `${user}/${coll}/`, `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:displayname/></d:prop></d:propfind>`, { Depth: "1", "Content-Type": "application/xml" });
  return r.text;
}

const get = async (srv, user, path) => (await req(srv, user, "GET", path)).text;
const unfold = (t) => t.replace(/\r?\n[ \t]/g, "");

let src, dst;
try {
  const file = join(out, "davcopy.mjs");
  await build({ input: resolve(here, "../electron/davcopy.ts"), platform: "node", output: { file, format: "esm" }, logLevel: "silent" });
  const D = await import(pathToFileURL(file).href);

  // ---- pure helpers ----
  check(D.itemUid(EVENTS["dentist.ics"]) === "dentist-0002@test", "itemUid skips a VALARM's UID that comes first");
  check(D.itemUid(NO_UID) === null, "itemUid is null for a card without UID");
  check(D.safeSegment("bad%20name%3A.ics") === "bad-name-.ics", "safeSegment replaces characters Radicale refuses");
  check(D.fileName("https://h/a/b/c%20d.ics") === "c%20d.ics", "fileName keeps the encoded last segment");

  src = await startRadicale({ users: { src: "pw" }, tls: true });
  dst = await startRadicale({ users: { dst: "pw" }, maxContentLength: 60000 });
  const S = { username: "src", password: "pw", fetch: globalThis.fetch };
  const T = { username: "dst", password: "pw", fetch: globalThis.fetch };

  await seed(src, "src", "work-cal", "calendar", EVENTS,
    "<d:displayname>Work Calendar</d:displayname><ic:calendar-color>#3366FFFF</ic:calendar-color><c:supported-calendar-component-set><c:comp name=\"VEVENT\"/></c:supported-calendar-component-set>");
  await seed(src, "src", "groceries", "calendar", TASKS,
    "<d:displayname>Groceries</d:displayname><ic:calendar-color>#22AA44FF</ic:calendar-color><c:supported-calendar-component-set><c:comp name=\"VTODO\"/></c:supported-calendar-component-set>");
  await seed(src, "src", "my-contacts", "addressbook", CONTACTS, "<d:displayname>My Contacts</d:displayname>");

  const before = {
    cal: await snapshot(src, "src", "work-cal"),
    tasks: await snapshot(src, "src", "groceries"),
    book: await snapshot(src, "src", "my-contacts")
  };

  // ---- 1. calendar with recurrence, override, alarms, attendees -> new collection ----
  const calInfo = await D.collectionInfo(S, `${src.url}src/work-cal/`);
  check(calInfo.kind === "calendar" && calInfo.displayName === "Work Calendar" && calInfo.color === "#3366FFFF"
    && calInfo.components.join() === "VEVENT", "collectionInfo reads name, color, component types");
  const calUrl = await D.freeCollectionUrl(T, `${dst.url}dst/`, "work-cal");
  check(calUrl === `${dst.url}dst/work-cal/`, "freeCollectionUrl uses the source's folder name when free");
  const progress = [];
  const r1 = await D.copyCollection({ kind: "calendar", source: { ...S, url: `${src.url}src/work-cal/` }, target: { ...T, url: calUrl }, create: calInfo, onProgress: (p) => progress.push(p) });
  check(r1.createdTarget && r1.copied === 2 && r1.already === 0 && r1.failed === 0 && r1.complete, `calendar: 2 copied, complete (${JSON.stringify({ c: r1.copied, a: r1.already, f: r1.failed, items: r1.items })})`);
  check(r1.sourceCount === 2 && r1.targetCountAfter === 2 && r1.sourceName === "Work Calendar", "calendar: counts match on both sides");
  check(progress.some((p) => p.phase === "copying" && p.done === 2 && p.total === 2) && progress.at(-1).phase === "done", "progress reported up to done");
  const tInfo = await D.collectionInfo(T, calUrl);
  check(tInfo.displayName === "Work Calendar" && tInfo.color === "#3366FFFF" && tInfo.components.join() === "VEVENT", "target calendar has the same name, color and component types");
  const standup = unfold(await get(dst, "dst", "dst/work-cal/weekly-standup.ics"));
  for (const want of ["UID:standup-0001@test", "RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;TZID=America/New_York:20261116T090000", "RECURRENCE-ID;TZID=America/New_York:20261109T090000",
    "SUMMARY:Weekly standup (moved)", "ATTENDEE;CN=Pat;PARTSTAT=ACCEPTED:mailto:pat@example.com", "ORGANIZER;CN=Arlis:mailto:arlis@example.com",
    "aGVsbG8gd29ybGQ=", "X-SYNO-EVT-COLOR:#ff8800", "X-OTHER-APP-PROP;X-P=1:kept as is", "TRIGGER:-PT10M", "TZID:America/New_York"]) {
    check(standup.includes(want), `recurring event kept: ${want}`);
  }
  const dentist = unfold(await get(dst, "dst", "dst/work-cal/dentist.ics"));
  check(dentist.includes("UID:dentist-0002@test") && dentist.includes("TRIGGER:-P1D") && dentist.includes("A long description line that has to be folded"), "event with alarm and folded description kept under the same file name");

  // ---- 2. tasks with subtasks (RELATED-TO) and an alarm ----
  const taskInfo = await D.collectionInfo(S, `${src.url}src/groceries/`);
  const r2 = await D.copyCollection({ kind: "calendar", source: { ...S, url: `${src.url}src/groceries/` }, target: { ...T, url: await D.freeCollectionUrl(T, `${dst.url}dst/`, "groceries") }, create: taskInfo });
  check(r2.copied === 4 && r2.failed === 0 && r2.complete, "tasks: 4 copied, complete");
  const childA = unfold(await get(dst, "dst", "dst/groceries/child-a.ics"));
  const childB = unfold(await get(dst, "dst", "dst/groceries/child-b.ics"));
  check(childA.includes("RELATED-TO;RELTYPE=PARENT:task-parent@test") && childB.includes("RELATED-TO:task-parent@test"), "subtasks still point at the parent's UID");
  check(unfold(await get(dst, "dst", "dst/groceries/parent.ics")).includes("UID:task-parent@test"), "parent task kept its UID");
  check(childB.includes("STATUS:COMPLETED") && unfold(await get(dst, "dst", "dst/groceries/alarm-task.ics")).includes("TRIGGER;RELATED=END:-PT30M"), "completed task and task alarm kept");
  check((await D.collectionInfo(T, `${dst.url}dst/groceries/`)).components.join() === "VTODO", "task list stays tasks only");

  // ---- 3. contacts with photos and groups; one too large for the target ----
  const bookInfo = await D.collectionInfo(S, `${src.url}src/my-contacts/`);
  check(bookInfo.kind === "addressbook" && bookInfo.displayName === "My Contacts", "address book info read");
  const bookUrl = await D.freeCollectionUrl(T, `${dst.url}dst/`, "my-contacts");
  const r3 = await D.copyCollection({ kind: "addressbook", source: { ...S, url: `${src.url}src/my-contacts/` }, target: { ...T, url: bookUrl }, create: bookInfo });
  check(r3.copied === 3 && r3.failed === 1 && !r3.complete && r3.missing === 1, `contacts: 3 copied, 1 failed, reported incomplete (${JSON.stringify({ c: r3.copied, f: r3.failed, m: r3.missing })})`);
  const big = r3.items.find((i) => i.name === "big-photo.vcf");
  check(big && big.status === "failed" && /413/.test(big.reason) && big.label === "Big Photo Person", `the failing item names its reason and contact (${big?.reason})`);
  const pat = unfold(await get(dst, "dst", "dst/my-contacts/pat.vcf"));
  check(pat.includes(b64(3000)) && pat.includes("X-SOCIALPROFILE;TYPE=xmpp:pat@xmpp.example") && pat.includes("CATEGORIES:Friends"), "contact photo and other properties kept");
  const grp = unfold(await get(dst, "dst", "dst/my-contacts/group-friends.vcf"));
  check(grp.includes("X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:contact-pat@test") && grp.includes("X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:contact-lee@test") && grp.includes("X-ADDRESSBOOKSERVER-KIND:group"), "group card and its members kept");
  check(unfold(await get(dst, "dst", "dst/my-contacts/lee.vcf")).toUpperCase().includes("ITEM1.X-ABLABEL:CUSTOM"), "grouped property (item1.) kept (Radicale writes property names in upper case)");

  // ---- 4. the source never changed ----
  check(before.cal === await snapshot(src, "src", "work-cal") && before.tasks === await snapshot(src, "src", "groceries") && before.book === await snapshot(src, "src", "my-contacts"),
    "source collections unchanged (same items, same etags)");

  // ---- 5. running it twice is safe ----
  const r1b = await D.copyCollection({ kind: "calendar", source: { ...S, url: `${src.url}src/work-cal/` }, target: { ...T, url: calUrl } });
  check(r1b.copied === 0 && r1b.already === 2 && r1b.failed === 0 && r1b.complete && r1b.targetCountAfter === 2, "second calendar run: nothing copied, 2 already there");
  const r3b = await D.copyCollection({ kind: "addressbook", source: { ...S, url: `${src.url}src/my-contacts/` }, target: { ...T, url: bookUrl } });
  check(r3b.copied === 0 && r3b.already === 3 && r3b.failed === 1 && r3b.targetCountAfter === 3, `second contacts run: 3 already there, the big one still fails (${JSON.stringify({ c: r3b.copied, a: r3b.already, f: r3b.failed, n: r3b.targetCountAfter })})`);
  check(await D.freeCollectionUrl(T, `${dst.url}dst/`, "work-cal") === `${dst.url}dst/work-cal-2/`, "freeCollectionUrl adds -2 when the folder is taken");
  check(await D.collectionKindAt(T, calUrl) === "calendar" && await D.collectionKindAt(T, `${dst.url}dst/nothing/`) === null, "collectionKindAt tells an existing calendar from nothing");

  // ---- 6. into an existing collection with clashes; nothing there is overwritten ----
  await seed(dst, "dst", "existing", "calendar", {
    "other-name.ics": ics("BEGIN:VEVENT", "UID:standup-0001@test", "DTSTAMP:20261101T120000Z", "DTSTART:20261102T140000Z", "SUMMARY:Target's own copy", "END:VEVENT"),
    "dentist.ics": ics("BEGIN:VEVENT", "UID:somebody-else@test", "DTSTAMP:20261101T120000Z", "DTSTART:20261102T140000Z", "SUMMARY:Unrelated item with the same file name", "END:VEVENT"),
    "keep-me.ics": ics("BEGIN:VEVENT", "UID:keep-me@test", "DTSTAMP:20261101T120000Z", "DTSTART:20261102T140000Z", "SUMMARY:Keep me", "END:VEVENT")
  }, "<d:displayname>Existing</d:displayname>");
  const exBefore = { a: await get(dst, "dst", "dst/existing/other-name.ics"), b: await get(dst, "dst", "dst/existing/dentist.ics"), c: await get(dst, "dst", "dst/existing/keep-me.ics") };
  const r6 = await D.copyCollection({ kind: "calendar", source: { ...S, url: `${src.url}src/work-cal/` }, target: { ...T, url: `${dst.url}dst/existing/` } });
  check(r6.already === 1 && r6.copied === 1 && r6.failed === 0 && r6.complete && r6.targetCountBefore === 3 && r6.targetCountAfter === 4, `existing: same UID = already there, same file name = copied under another name (${JSON.stringify({ a: r6.already, c: r6.copied, f: r6.failed, items: r6.items })})`);
  const renamed = r6.items.find((i) => i.name === "dentist.ics");
  check(renamed && renamed.status === "copied" && renamed.targetName === "dentist-0002@test.ics", "renamed item is listed with its new file name");
  check(exBefore.a === await get(dst, "dst", "dst/existing/other-name.ics") && exBefore.b === await get(dst, "dst", "dst/existing/dentist.ics") && exBefore.c === await get(dst, "dst", "dst/existing/keep-me.ics"),
    "nothing already on the target was overwritten");

  // ---- 7. Synology-like source: odd file names, a card without UID, a broken item ----
  const fakeBase = "https://synology.invalid:5001/carddav/arlis/abc/";
  const fake = fakeSource(fakeBase, "addressbook", {
    "Odd%20Name%3A1.vcf": vcf("UID:odd-name@test", "FN:Odd Name"),
    "no-uid.vcf": NO_UID,
    "broken.vcf": ["BEGIN:VCARD", "this is not a vcard", ""].join(CRLF),
    "fine.vcf": vcf("UID:fine@test", "FN:Fine Card")
  }, "Synology Contacts");
  const fakeInfo = await D.collectionInfo({ username: "x", password: "y", fetch: fake.fetch }, fakeBase);
  const r7 = await D.copyCollection({ kind: "addressbook", source: { username: "x", password: "y", fetch: fake.fetch, url: fakeBase }, target: { ...T, url: `${dst.url}dst/from-synology/` }, create: fakeInfo });
  const odd = r7.items.find((i) => i.name === "Odd Name:1.vcf");
  check(odd && odd.status === "copied" && odd.targetName === "odd-name@test.vcf", `a file name the target refuses gets the UID-based name (${JSON.stringify(odd)})`);
  const noUid = r7.items.find((i) => i.name === "no-uid.vcf");
  check(noUid && noUid.status === "failed" && /HTTP 400/.test(noUid.reason) && noUid.label === "No Uid Card", `a card without UID fails with the target's answer (${noUid?.reason})`);
  const broken = r7.items.find((i) => i.name === "broken.vcf");
  check(broken && broken.status === "failed" && /HTTP 400/.test(broken.reason), `a broken item fails with the target's answer (${broken?.reason})`);
  check(r7.copied === 2 && r7.failed === 2 && r7.missing === 2 && !r7.complete && r7.sourceName === "Synology Contacts", "Synology-like run: 2 copied, 2 failed, reported incomplete");
  check(fake.seen.every((m) => m === "PROPFIND" || m === "GET"), `the source only got PROPFIND and GET (${[...new Set(fake.seen)].join(", ")})`);
  const r7b = await D.copyCollection({ kind: "addressbook", source: { username: "x", password: "y", fetch: fake.fetch, url: fakeBase }, target: { ...T, url: `${dst.url}dst/from-synology/` } });
  check(r7b.copied === 0 && r7b.already === 2 && r7b.failed === 2, "second Synology-like run: renamed item counts as already there");

  // ---- 8. the copy can't start: wrong password on the source ----
  let threw = null;
  try { await D.copyCollection({ kind: "calendar", source: { ...S, password: "wrong", url: `${src.url}src/work-cal/` }, target: { ...T, url: calUrl } }); } catch (e) { threw = e; }
  check(threw && /401/.test(threw.message), `unreadable source stops before anything is written (${threw?.message})`);
} catch (e) {
  failures++;
  console.log("FAIL: test crashed:", e);
} finally {
  await src?.stop();
  await dst?.stop();
  try { rmSync(out, { recursive: true, force: true }); } catch { /* temp */ }
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
