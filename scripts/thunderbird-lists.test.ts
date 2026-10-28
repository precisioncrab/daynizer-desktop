// Thunderbird's mailing lists in Daynizer's clean-up pages (Manifest V2): loaded
// with their books, and a list made a label and deleted, then undone, through
// Contacts Cleanup's history.js, Daynizer's clean-up api and the add-on
// background's writes, against a fake Thunderbird.
import * as bg from "../thunderbird-addon/background/thunderbird";
import * as ab from "../src/cleanup/lib/addressbook.js";
import { applyChanges, undoEntry } from "../src/cleanup/core/history.js";
import { addLabels } from "../src/cleanup/core/copies.js";

let failed = 0;
const ok = (cond: boolean, msg: string, extra?: string) => {
  if (cond) console.log("ok:   " + msg);
  else { failed++; console.log("FAIL: " + msg + (extra ? "\n" + extra : "")); }
};

const card = (uid: string, fn: string) => `BEGIN:VCARD\r\nVERSION:4.0\r\nUID:${uid}\r\nFN:${fn}\r\nEND:VCARD\r\n`;
const store: Record<string, { parentId: string; vCard: string }> = {
  a1: { parentId: "w2", vCard: card("a1", "Amy Guest") },
  b1: { parentId: "w2", vCard: card("b1", "Ben Guest") },
  c1: { parentId: "w2", vCard: card("c1", "Cy Not Invited") }
};
let lists: Record<string, { id: string; parentId: string; name: string; nickName: string; description: string; members: string[] }> = {
  L1: { id: "L1", parentId: "w2", name: "Wedding2", nickName: "w2", description: "the guests", members: ["a1", "b1"] }
};
let nextList = 2;
const node = (uid: string) => ({ id: uid, parentId: store[uid].parentId, type: "contact", properties: { vCard: store[uid].vCard } });
(globalThis as any).browser = {
  addressBooks: {
    async list() {
      return [{ id: "w2", name: "wedding 2", readOnly: false, remote: false, type: "addressBook",
        contacts: Object.keys(store).map(node),
        mailingLists: Object.values(lists).map((l) => ({ id: l.id, name: l.name, nickName: l.nickName, description: l.description, contacts: l.members.map((m) => ({ id: m })) })) }];
    }
  },
  contacts: {
    async get(uid: string) { return store[uid] ? node(uid) : null; },
    async update(uid: string, props: any) { store[uid].vCard = props.vCard; },
    async create() { throw new Error("not used"); },
    async delete(uid: string) { delete store[uid]; },
    async getPhoto() { return null; }
  },
  mailingLists: {
    async list(book: string) { return Object.values(lists).filter((l) => l.parentId === book); },
    async get(id: string) { const l = lists[id]; if (!l) throw new Error("no list"); return { id, parentId: l.parentId, name: l.name, nickName: l.nickName, description: l.description }; },
    async listMembers(id: string) { return lists[id].members.map((m) => ({ id: m })); },
    async create(book: string, props: any) { const id = `L${nextList++}`; lists[id] = { id, parentId: book, ...props, members: [] }; return id; },
    async delete(id: string) { delete lists[id]; },
    async addMember(id: string, uid: string) { lists[id].members.push(uid); },
    async removeMember(id: string, uid: string) { lists[id].members = lists[id].members.filter((m) => m !== uid); }
  }
};
(globalThis as any).window = globalThis;
(globalThis as any).api = {
  addressbooks: { all: async () => [] },
  contacts: {
    vcards: async () => [],
    saveVCard: (id: string, vcf: string) => bg.thunderbirdSaveVCard(id, vcf),
    createVCard: (bookId: string, vcf: string) => bg.thunderbirdCreateVCard(bookId, vcf),
    delete: (id: string) => bg.thunderbirdContactDelete(id)
  }
};

// Loaded with the book (members are UIDs, as Lists to labels reads them).
const books = await ab.loadBooks();
const w2 = books.find((b: any) => b.id === "tb:w2");
ok(w2?.lists?.length === 1 && w2.lists[0].name === "Wedding2" && JSON.stringify(w2.lists[0].members) === JSON.stringify(["a1", "b1"]) && w2.lists[0].parentId === "tb:w2",
  "Thunderbird's mailing list is loaded with its book", JSON.stringify(w2?.lists));
ok(JSON.stringify(await ab.api.listsOf("tb:w2»a1")) === JSON.stringify(["L1"]) && JSON.stringify(await ab.api.listsOf("tb:w2»c1")) === "[]", "listsOf finds a member's lists");
const read = await ab.api.getList("L1");
ok(JSON.stringify(read?.members) === JSON.stringify(["tb:w2»a1", "tb:w2»b1"]), "getList names its members by card id", JSON.stringify(read));

// Lists to labels on Wedding2, "Then delete the mailing list" (labels.js listToLabel's changes).
const members = w2.contacts.filter((c: any) => ["a1", "b1"].includes(c.uid));
const changes: any[] = members.map((c: any) => ({ type: "update", id: c.id, vCard: addLabels(c.vCard, ["Wedding2"]), label: c.uid }));
changes.push({ type: "deleteList", listId: "L1", label: "Wedding2" });
const { entry, error } = await applyChanges(ab.api, "Labeled the list Wedding2's members Wedding2 and deleted the list", changes);
ok(!error, "applied without an error", String(error));
ok(/CATEGORIES:Wedding2/.test(store.a1.vCard) && /CATEGORIES:Wedding2/.test(store.b1.vCard) && !/CATEGORIES/.test(store.c1.vCard), "the members got the label, nobody else did");
ok(!lists.L1 && Object.keys(lists).length === 0, "the list is deleted");

// Undo: labels off, the list made again with its members and details.
const undone = await undoEntry(ab.api, entry, { force: true });
ok(Boolean(undone?.done ?? !undone?.error), "undo ran", JSON.stringify(undone));
const again = Object.values(lists);
ok(again.length === 1 && again[0].name === "Wedding2" && again[0].nickName === "w2" && again[0].description === "the guests" && again[0].parentId === "w2",
  "the list is made again in its book with its name, nickname and description", JSON.stringify(again));
ok(JSON.stringify([...(again[0]?.members ?? [])].sort()) === JSON.stringify(["a1", "b1"]), "with its members", JSON.stringify(again[0]?.members));
ok(!/CATEGORIES/.test(store.a1.vCard) && !/CATEGORIES/.test(store.b1.vCard), "the labels are off again");

// A new mailing list, a contact put on it and another taken off Wedding2 (Contacts Cleanup 0.1.26's
// createList and listMember changes), then both undone: the members back, the new list gone.
const made = await applyChanges(ab.api, "New mailing list Party in wedding 2", [{ type: "createList", parentId: "tb:w2", name: "Party", label: "Party" }]);
const party = made.results[0];
ok(!made.error && lists[party]?.name === "Party" && lists[party]?.parentId === "w2", "a new mailing list is made in its book", JSON.stringify(lists[party]));
const w2list = Object.values(lists).find((l) => l.name === "Wedding2")!;
const ticked = await applyChanges(ab.api, "Edited", [
  { type: "listMember", listId: party, id: "tb:w2»c1", add: true, label: "Cy" },
  { type: "listMember", listId: w2list.id, id: "tb:w2»a1", add: false, label: "Amy" }
]);
ok(!ticked.error && JSON.stringify(lists[party].members) === JSON.stringify(["c1"]) && !w2list.members.includes("a1"), "put on one list, taken off another", JSON.stringify(lists));
await undoEntry(ab.api, ticked.entry, { force: true });
ok(lists[party].members.length === 0 && w2list.members.includes("a1"), "undo puts the members back", JSON.stringify(lists));
await undoEntry(ab.api, made.entry, { force: true });
ok(!lists[party], "undo deletes the new list");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exitCode = failed ? 1 : 0;
