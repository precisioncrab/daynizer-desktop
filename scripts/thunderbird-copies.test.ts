// Clean up > In several books on Thunderbird's own books (Manifest V2): one UID
// in two books, Thunderbird reaching only one copy, the copy in a mailing list.
// Runs Contacts Cleanup's history.js (sortCopies, undo) through Daynizer's
// clean-up api and the add-on background's writes, against a fake Thunderbird.
import * as bg from "../thunderbird-addon/background/thunderbird";
import * as ab from "../src/cleanup/lib/addressbook.js";
import { applyChanges, undoEntry } from "../src/cleanup/core/history.js";
import { copiesPlan } from "../src/cleanup/core/copies.js";
import { readCard } from "../src/cleanup/core/card.js";

let failed = 0;
const ok = (cond: boolean, msg: string, extra?: string) => {
  if (cond) console.log("ok:   " + msg);
  else { failed++; console.log("FAIL: " + msg + (extra ? "\n" + extra : "")); }
};

const card = (uid: string, fn: string, extra = "") =>
  `BEGIN:VCARD\r\nVERSION:4.0\r\nUID:${uid}\r\nFN:${fn}\r\n${extra}END:VCARD\r\n`;

// uid -> copies; Thunderbird's get() reaches the LAST copy listed.
const store: Record<string, { parentId: string; vCard: string }[]> = {
  u2: [{ parentId: "b1", vCard: card("u2", "Bea Two", "TEL:555 0102\r\n") }, { parentId: "b2", vCard: card("u2", "Bea Two", "EMAIL:bea@example.com\r\n") }]
};
const lists: Record<string, { id: string; parentId: string; name: string; members: string[] }> = {
  L1: { id: "L1", parentId: "b2", name: "Wedding2", members: ["u2"] }
};
let next = 9;
const calls: string[] = [];
const node = (uid: string, c: any) => ({ id: uid, parentId: c.parentId, type: "contact", properties: { vCard: c.vCard } });
(globalThis as any).browser = {
  addressBooks: { async list() { return []; } },
  contacts: {
    async get(uid: string) { const c = store[uid]; return c?.length ? node(uid, c[c.length - 1]) : null; },
    async update(uid: string, props: any) { calls.push(`update ${uid}@${store[uid].at(-1)!.parentId}`); store[uid].at(-1)!.vCard = props.vCard; },
    async create(parentId: string, _id: null, props: any) {
      const uid = /^UID:(.+)$/m.exec(props.vCard)?.[1]?.trim() ?? `u${next++}`;
      calls.push(`create ${uid}@${parentId}`);
      (store[uid] ??= []).push({ parentId, vCard: props.vCard.includes("UID:") ? props.vCard : props.vCard.replace("VERSION:4.0\r\n", `VERSION:4.0\r\nUID:${uid}\r\n`) });
      return uid;
    },
    async delete(uid: string) { calls.push(`delete ${uid}@${store[uid].at(-1)!.parentId}`); store[uid].pop(); if (!store[uid].length) delete store[uid]; },
    async getPhoto() { return null; }
  },
  mailingLists: {
    async list(book: string) { return Object.values(lists).filter((l) => l.parentId === book).map(({ id, name }) => ({ id, name })); },
    async listMembers(id: string) { return lists[id].members.map((uid) => ({ id: uid })); },
    async get(id: string) { if (!lists[id]) throw new Error("no list"); return { id, parentId: lists[id].parentId }; },
    async addMember(id: string, uid: string) { calls.push(`addMember ${uid}→${id}`); if (!lists[id].members.includes(uid)) lists[id].members.push(uid); }
  }
};
// window.api as the tab has it, with index.ts's routing of "tb:" ids to the background.
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

// Link the copies (keeper: Personal, b1), as copies.js's applyChoice sends it for Thunderbird's books.
const group = {
  uid: "u2",
  cards: [
    readCard({ id: "tb:b1»u2", parentId: "tb:b1", vCard: store.u2[0].vCard }, "Personal Address Book (Thunderbird)"),
    readCard({ id: "tb:b2»u2", parentId: "tb:b2", vCard: store.u2[1].vCard }, "Synology (Thunderbird)")
  ]
};
const plan = copiesPlan(group as any, "link", { keeper: "tb:b1»u2" });
const { entry, error, results } = await applyChanges(ab.api, "Bea Two: linked the copies", [
  { type: "copies", uid: "u2", books: ["tb:b1", "tb:b2"], want: plan.want, label: "Bea Two" }
]);
ok(!error, "applied without an error", String(error));
ok(JSON.stringify(calls.slice(0, 4)) === JSON.stringify(["create u9@b2", "addMember u9→L1", "delete u2@b2", "update u2@b1"]),
  "Synology's (reachable) copy made again with a new ID, kept in its list, old one removed, then Personal's updated", JSON.stringify(calls));
ok(JSON.stringify(results[0]) === JSON.stringify(["tb:b2»u9", "tb:b1»u2"]), "the copies' ids come back for the link", JSON.stringify(results));
ok(store.u2?.length === 1 && store.u2[0].parentId === "b1" && /TEL:555 0102/.test(store.u2[0].vCard) && /EMAIL:bea@example.com/.test(store.u2[0].vCard),
  "Personal's copy keeps u2 and has both copies' details", JSON.stringify(store.u2));
ok(/EMAIL:bea@example.com/.test(store.u9?.[0]?.vCard ?? "") && /TEL:555 0102/.test(store.u9?.[0]?.vCard ?? ""), "the new Synology copy has both copies' details too");
ok(lists.L1.members.includes("u9"), "the new copy is in the Wedding2 list");

// Undo puts it back: the new copy gone, Synology's copy back (in its list), Personal's details back.
calls.length = 0;
const undone = await undoEntry(ab.api, entry, { force: true });
ok(Boolean(undone?.done ?? !undone?.error), "undo ran", JSON.stringify(undone));
ok(!store.u9, "undo removed the new copy", JSON.stringify(store));
ok(store.u2?.some((c) => c.parentId === "b2") && store.u2?.some((c) => c.parentId === "b1"), "both copies of u2 are back", JSON.stringify(store.u2));
ok(lists.L1.members.includes("u2"), "Synology's copy is back in Wedding2");
ok(!/EMAIL:/.test(store.u2?.find((c) => c.parentId === "b1")?.vCard ?? "EMAIL:"), "Personal's copy has its own details again", JSON.stringify(store.u2));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exitCode = failed ? 1 : 0;
