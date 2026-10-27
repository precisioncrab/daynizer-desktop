// The Manifest V2 read and write paths against a fake Thunderbird (browser.contacts
// with properties.vCard, as Manifest V2 has it), including one UID in two books.
import * as tb from "../src/thunderbirdBooks";
import * as bg from "../thunderbird-addon/background/thunderbird";
import * as ab from "../src/cleanup/lib/addressbook.js";

let failed = 0;
const ok = (cond: boolean, msg: string, extra?: string) => {
  if (cond) console.log("ok:   " + msg);
  else { failed++; console.log("FAIL: " + msg + (extra ? "\n" + extra : "")); }
};
async function throwsWith(p: Promise<any>, text: string): Promise<boolean> {
  try { await p; return false; } catch (e: any) { return String(e?.message).includes(text); }
}

const card = (uid: string, fn: string, extra = "") =>
  `BEGIN:VCARD\r\nVERSION:4.0\r\nUID:${uid}\r\nFN:${fn}\r\nTEL;TYPE=cell:555 01${uid.slice(1)}\r\n${extra}END:VCARD\r\n`;

// uid -> copies; Thunderbird's get() reaches the LAST copy listed (u2: Synology's).
const store: Record<string, { parentId: string; vCard: string; readOnly?: boolean }[]> = {
  u1: [{ parentId: "b1", vCard: card("u1", "Ann One") }],
  u2: [{ parentId: "b1", vCard: card("u2", "Bea Two") }, { parentId: "b2", vCard: card("u2", "Bea Two") }],
  u3: [{ parentId: "b3", vCard: card("u3", "Cal Three"), readOnly: true }]
};
const books = [
  { id: "b1", name: "Personal Address Book", readOnly: false },
  { id: "b2", name: "Synology", readOnly: false },
  { id: "b3", name: "Company directory", readOnly: true }
];
const calls: any[] = [];
const node = (uid: string, c: any) => ({ id: uid, parentId: c.parentId, type: "contact", readOnly: c.readOnly, properties: { vCard: c.vCard, FirstName: "x" } });
(globalThis as any).browser = {
  addressBooks: {
    async list(complete: boolean) {
      return books.map((b) => ({
        ...b, type: "addressBook",
        contacts: complete ? Object.entries(store).flatMap(([uid, copies]) => copies.filter((c) => c.parentId === b.id).map((c) => node(uid, c))) : undefined
      }));
    },
    onCreated: { addListener() {} }, onUpdated: { addListener() {} }, onDeleted: { addListener() {} }
  },
  contacts: {
    async get(uid: string) { const copies = store[uid]; return copies ? node(uid, copies[copies.length - 1]) : null; },
    async update(uid: string, props: any) { calls.push(["update", uid, props]); const c = store[uid]; c[c.length - 1].vCard = props.vCard; },
    async create(parentId: string, id: string | null, props: any) { calls.push(["create", parentId, id, props]); store.u9 = [{ parentId, vCard: props.vCard }]; return "u9"; },
    async delete(uid: string) { calls.push(["delete", uid]); store[uid].pop(); },
    async getPhoto() { return null; },
    onCreated: { addListener() {} }, onUpdated: { addListener() {} }, onDeleted: { addListener() {} }
  },
  mailingLists: { onMemberAdded: { addListener() {} }, onMemberRemoved: { addListener() {} } }
};
// The tab's window.api for the clean-up layer: Daynizer has no books of its own here.
(globalThis as any).window = globalThis;
(globalThis as any).api = {
  addressbooks: { all: async () => [] },
  contacts: {
    vcards: async () => [],
    saveVCard: async (id: string, vcf: string) => calls.push(["saveVCard", id, vcf]),
    createVCard: async (bookId: string, vcf: string) => { calls.push(["createVCard", bookId, vcf]); return { id: "new" }; },
    delete: async (id: string) => calls.push(["delete-api", id])
  }
};


// Reading (Manifest V2: vCard in properties).
const read = await tb.readThunderbirdBooks();
ok(read.length === 3 && read[0].cards.length === 2 && read[1].cards.length === 1, "books and cards read from properties.vCard", JSON.stringify(read.map((b: any) => [b.id, b.cards.length])));
ok(read[2].readOnly === true && read[2].cards[0].readOnly === true, "read-only book and its card marked");
ok((await tb.readThunderbirdCard("tb:b2»u2"))?.vCard.includes("Bea Two") === true, "readThunderbirdCard reaches Synology's copy");
ok((await tb.readThunderbirdCard("tb:b1»u2")) === null, "readThunderbirdCard refuses the copy Thunderbird doesn't reach");

// Editor update.
const row = tb.thunderbirdContactRow({ id: "tb:b1»u1", parentId: "tb:b1", vCard: store.u1[0].vCard });
const phones = JSON.parse(row.phones); phones[0].value = "555 0177";
await bg.thunderbirdContactUpdate("tb:b1»u1", { address_book_id: "tb:b1", phones: JSON.stringify(phones) });
let last = calls.at(-1);
ok(last?.[0] === "update" && last[1] === "u1" && /TEL;TYPE=cell:555 0177/.test(last[2].vCard) && Object.keys(last[2]).join() === "vCard", "editor edit writes contacts.update(uid, { vCard })", JSON.stringify(last));
calls.length = 0;
await bg.thunderbirdContactUpdate("tb:b1»u1", { address_book_id: "tb:b1", phones: JSON.stringify(phones) });
ok(calls.length === 0, "the same save again writes nothing");
ok(await throwsWith(bg.thunderbirdContactUpdate("tb:b1»u2", { notes: "x" }), "copy in the other one"), "a copy Thunderbird doesn't reach is refused");
ok(await throwsWith(bg.thunderbirdContactUpdate("tb:b3»u3", { notes: "x" }), "read-only"), "a read-only book's contact is refused");
ok(await throwsWith(bg.thunderbirdContactUpdate("tb:b1»u1", { address_book_id: "tb:b2", notes: "x" }), "move a contact"), "moving to another book is refused");
ok(calls.length === 0, "nothing written by the refused ones");

// Clean-up writes.
await bg.thunderbirdSaveVCard("tb:b2»u2", card("u2", "Bea Twofold"));
last = calls.at(-1);
ok(last?.[0] === "update" && last[1] === "u2" && last[2].vCard.includes("Bea Twofold"), "saveVCard writes the whole card");
const created = await bg.thunderbirdCreateVCard("tb:b1", card("u9", "New Person"));
last = calls.at(-1);
ok(created.id === "tb:b1»u9" && last?.[0] === "create" && last[1] === "b1" && last[2] === null && last[3].vCard.includes("New Person"), "createVCard creates in the book and names the new card", JSON.stringify([created, last]));
await bg.thunderbirdContactDelete("tb:b2»u2");
ok(calls.at(-1)?.[0] === "delete" && calls.at(-1)?.[1] === "u2", "delete reaches the right copy");
ok(bg.isThunderbirdBookId("tb:b1") && !bg.isThunderbirdBookId("abc"), "book ids told apart");

// Clean-up layer: the copy Thunderbird doesn't reach is shadowed.
store.u2 = [{ parentId: "b1", vCard: card("u2", "Bea Two") }, { parentId: "b2", vCard: card("u2", "Bea Two") }];
const loaded = await ab.loadBooks();
const b1 = loaded.find((b: any) => b.id === "tb:b1"), b2 = loaded.find((b: any) => b.id === "tb:b2"), b3 = loaded.find((b: any) => b.id === "tb:b3");
ok(b1.contacts.find((c: any) => c.uid === "u2").shadowed === "Synology (Thunderbird)", "the Personal copy of u2 is shadowed by Synology's", JSON.stringify(b1.contacts));
ok(!b2.contacts.find((c: any) => c.uid === "u2").shadowed && !b1.contacts.find((c: any) => c.uid === "u1").shadowed, "reachable copies aren't shadowed");
ok(b1.readOnly === false && b3.readOnly === true, "books' readOnly is Thunderbird's");
calls.length = 0;
await ab.api.update("tb:b1»u1", "BEGIN:VCARD\r\nEND:VCARD\r\n");
ok(calls.at(-1)?.[0] === "saveVCard" && calls.at(-1)?.[1] === "tb:b1»u1", "clean-up api.update sends tb ids through window.api (no refusal)");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exitCode = failed ? 1 : 0;
