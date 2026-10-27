// Checks thunderbirdPatchedVCard against what ContactDetailPanel really sends.
import { thunderbirdContactRow, thunderbirdPatchedVCard } from "../src/thunderbirdBooks";

let failed = 0;
const ok = (cond: boolean, msg: string, extra?: string) => {
  if (cond) console.log("ok:   " + msg);
  else { failed++; console.log("FAIL: " + msg + (extra ? "\n" + extra : "")); }
};

const CRLF = (s: string) => s.trim().split("\n").map((l) => l.trim()).join("\r\n") + "\r\n";
const JANE = CRLF(`
BEGIN:VCARD
VERSION:4.0
UID:abc-123
FN:Dr. Jane Q. Smith
N:Smith;Jane;Q;Dr.;
TEL;TYPE=cell;PREF=1:+1 555 0100
TEL;TYPE=work:+1 555 0200
EMAIL;TYPE=home:jane@example.com
ADR;TYPE=home:PO Box 9;;1 Main St;Stuart;VA;24171;USA
ADR:PO Box 77;;;;;;
IMPP;X-SERVICE-TYPE=Jabber:xmpp:jane@example.com
BDAY;VALUE=DATE:19800415
NOTE:Met at the fair
CATEGORIES:Friends,Wedding
X-CUSTOM:keep me
PHOTO:data:image/jpeg;base64,AAAA
END:VCARD`);

// ContactDetailPanel: its state from the row, then handleSave's patch, with `edit` applied to the state.
function splitFullName(fn: string) {
  const parts = fn.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}
function editorSave(vCard: string, edit: (s: any) => void = () => {}) {
  const c = thunderbirdContactRow({ id: "tb:b»abc-123", parentId: "tb:b", vCard })!;
  const s: any = {};
  s.bookId = c.address_book_id;
  const fnVal = (c.fn ?? "").trim(), orgVal = (c.org ?? "").trim();
  if (!c.first_name && !c.last_name && fnVal && fnVal !== orgVal) {
    const sp = splitFullName(fnVal); s.firstName = sp.first; s.lastName = sp.last;
  } else { s.firstName = c.first_name; s.lastName = c.last_name; }
  s.org = c.org ?? ""; s.title = c.title ?? "";
  const b = (c.bday ?? "").trim();
  if (b.startsWith("--")) { const d = b.replace(/[^0-9]/g, ""); s.bday = `2000-${d.slice(0, 2)}-${d.slice(2, 4)}`; s.bdayNoYear = true; }
  else { s.bday = b.slice(0, 10); s.bdayNoYear = false; }
  const a = (c.anniversary ?? "").trim();
  if (a.startsWith("--")) { const d = a.replace(/[^0-9]/g, ""); s.anniversary = `2000-${d.slice(0, 2)}-${d.slice(2, 4)}`; s.anniversaryNoYear = true; }
  else { s.anniversary = a.slice(0, 10); s.anniversaryNoYear = false; }
  s.phones = JSON.parse(c.phones); s.emails = JSON.parse(c.emails); s.addresses = JSON.parse(c.addresses);
  s.categories = c.categories ?? ""; s.notes = c.notes ?? "";
  edit(s);
  const fn = [s.firstName.trim(), s.lastName.trim()].filter(Boolean).join(" ") || s.org.trim() || "Unnamed";
  return {
    address_book_id: s.bookId, fn, first_name: s.firstName, last_name: s.lastName, org: s.org, title: s.title,
    bday: s.bday ? (s.bdayNoYear ? `--${s.bday.slice(5, 7)}-${s.bday.slice(8, 10)}` : s.bday) : null,
    anniversary: s.anniversary ? (s.anniversaryNoYear ? `--${s.anniversary.slice(5, 7)}-${s.anniversary.slice(8, 10)}` : s.anniversary) : null,
    phones: JSON.stringify(s.phones.filter((p: any) => p.value.trim())),
    emails: JSON.stringify(s.emails.filter((e: any) => e.value.trim())),
    addresses: JSON.stringify(s.addresses.filter((x: any) => [x.street, x.city, x.region, x.postal, x.country].some((y: string) => (y || "").trim()))),
    categories: s.categories, notes: s.notes
  };
}
const lines = (v: string) => v.split(/\r?\n/).filter(Boolean);
const has = (v: string, line: string) => lines(v).includes(line);
const show = (v: string | null) => "----\n" + v + "----";

// 1. Saved without a change: nothing written.
ok(thunderbirdPatchedVCard(JANE, editorSave(JANE)) === null, "save without a change writes nothing");

// 2. One phone edited in place.
let out = thunderbirdPatchedVCard(JANE, editorSave(JANE, (s) => { s.phones[0].value = "+1 555 0199"; }));
ok(!!out && has(out, "TEL;TYPE=cell;PREF=1:+1 555 0199"), "edited phone keeps its TYPE and PREF", show(out));
ok(!!out && has(out, "TEL;TYPE=work:+1 555 0200"), "other phone unchanged");
ok(!!out && has(out, "FN:Dr. Jane Q. Smith") && has(out, "N:Smith;Jane;Q;Dr.;"), "FN and N untouched by a phone edit", show(out));
ok(!!out && has(out, "VERSION:4.0") && has(out, "UID:abc-123"), "VERSION 4.0 and UID kept");
ok(!!out && has(out, "X-CUSTOM:keep me") && has(out, "PHOTO:data:image/jpeg;base64,AAAA"), "unmodeled lines kept");
ok(!!out && has(out, "ADR:PO Box 77;;;;;;") && has(out, "ADR;TYPE=home:PO Box 9;;1 Main St;Stuart;VA;24171;USA"), "both addresses kept as written", show(out));
ok(!!out && has(out, "IMPP;X-SERVICE-TYPE=Jabber:xmpp:jane@example.com") && has(out, "BDAY;VALUE=DATE:19800415"), "chat address and birthday lines kept");

// 3. First name changed: N and FN follow (FN as the editor makes it).
out = thunderbirdPatchedVCard(JANE, editorSave(JANE, (s) => { s.firstName = "Janet"; }));
ok(!!out && lines(out).some((l) => l.startsWith("N:Smith;Janet;Q;Dr.")) && has(out, "FN:Janet Smith"), "name edit writes N (middle and prefix kept) and FN", show(out));

// 4. A card with only FN: the editor splits it; saving unchanged writes nothing, a phone edit adds no N.
const JOHN = CRLF(`
BEGIN:VCARD
VERSION:4.0
UID:j-1
FN:John Q Doe
TEL:555 0300
END:VCARD`);
ok(thunderbirdPatchedVCard(JOHN, editorSave(JOHN)) === null, "FN-only card saved unchanged writes nothing");
out = thunderbirdPatchedVCard(JOHN, editorSave(JOHN, (s) => { s.phones[0].value = "555 0301"; }));
ok(!!out && !lines(out).some((l) => l.startsWith("N:")) && has(out, "FN:John Q Doe") && has(out, "TEL:555 0301"), "FN-only card: phone edit keeps FN, adds no N", show(out));

// 5. Organization-only card: a new organization renames it.
const ACME = CRLF(`
BEGIN:VCARD
VERSION:4.0
UID:a-1
FN:Acme Feed
ORG:Acme Feed;Sales
END:VCARD`);
ok(thunderbirdPatchedVCard(ACME, editorSave(ACME)) === null, "organization card saved unchanged writes nothing");
out = thunderbirdPatchedVCard(ACME, editorSave(ACME, (s) => { s.org = "Acme Farm Supply"; }));
ok(!!out && has(out, "FN:Acme Farm Supply") && has(out, "ORG:Acme Farm Supply;Sales"), "new organization renames the card, department kept", show(out));

// 6. The label tools send only categories.
out = thunderbirdPatchedVCard(JANE, { categories: "Friends" });
ok(!!out && has(out, "CATEGORIES:Friends") && has(out, "FN:Dr. Jane Q. Smith") && has(out, "TEL;TYPE=cell;PREF=1:+1 555 0100"), "categories-only patch changes only CATEGORIES", show(out));

// 7. Birthday cleared, then a year-less one.
out = thunderbirdPatchedVCard(JANE, editorSave(JANE, (s) => { s.bday = ""; }));
ok(!!out && !lines(out).some((l) => l.startsWith("BDAY")), "birthday cleared", show(out));
out = thunderbirdPatchedVCard(JANE, editorSave(JANE, (s) => { s.bday = "2000-07-04"; s.bdayNoYear = true; }));
ok(!!out && lines(out).some((l) => /^BDAY.*:--07-04$/.test(l)), "year-less birthday written", show(out));

// 8. An address added: the PO-box-only one stays.
out = thunderbirdPatchedVCard(JANE, editorSave(JANE, (s) => { s.addresses.push({ type: "work", street: "2 Mill Rd", city: "Ararat", region: "VA", postal: "24053", country: "" }); }));
ok(!!out && lines(out).some((l) => l.includes("2 Mill Rd;Ararat;VA;24053")) && has(out, "ADR:PO Box 77;;;;;;") && has(out, "ADR;TYPE=home:PO Box 9;;1 Main St;Stuart;VA;24171;USA"), "added address; others kept", show(out));

// 9. An address edited in place keeps its PO box.
out = thunderbirdPatchedVCard(JANE, editorSave(JANE, (s) => { s.addresses[0].street = "3 Main St"; }));
ok(!!out && lines(out).some((l) => l.startsWith("ADR;TYPE=home:PO Box 9;;3 Main St;Stuart")), "edited address keeps its PO box", show(out));

// 10. The work phone removed; the cell keeps PREF.
out = thunderbirdPatchedVCard(JANE, editorSave(JANE, (s) => { s.phones = s.phones.filter((p: any) => !p.value.includes("0200")); }));
ok(!!out && !lines(out).some((l) => l.includes("0200")) && has(out, "TEL;TYPE=cell;PREF=1:+1 555 0100"), "removed phone gone, the other kept as is", show(out));

// 11. A phone's type changed: TYPE follows, PREF stays.
out = thunderbirdPatchedVCard(JANE, editorSave(JANE, (s) => { s.phones[0].type = "home"; }));
ok(!!out && lines(out).some((l) => /^TEL;.*PREF=1/.test(l) && /TYPE=home/i.test(l) && l.endsWith(":+1 555 0100")), "type change keeps PREF", show(out));

// 12. A note edited.
out = thunderbirdPatchedVCard(JANE, editorSave(JANE, (s) => { s.notes = "Met at the fair, 2025"; }));
ok(!!out && has(out, "NOTE:Met at the fair\\, 2025") && has(out, "FN:Dr. Jane Q. Smith"), "note edit", show(out));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exitCode = failed ? 1 : 0;
