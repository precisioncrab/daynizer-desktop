// Lists to labels moving a whole Thunderbird book (wedding 2) into Gmail when
// some of its contacts share their ID with a copy in a hidden book (Synology
// Contacts, hidden because it has the same contacts as Daynizer's My
// Contacts). Thunderbird reaches only the Synology copy, so wedding 2's copy
// has to go through the "copies" change; before 2026-10-27's fix the hidden
// book was left out of the clean-up data, the move used a plain delete, and
// Thunderbird refused it ("78 contacts are still in it"). Then the emptied
// wedding 2 is deleted.
import * as bg from "../thunderbird-addon/background/thunderbird";
import * as ab from "../src/cleanup/lib/addressbook.js";
import { applyChanges } from "../src/cleanup/core/history.js";
import { moveChanges } from "../src/cleanup/ui/views/labels.js";
import { readCard } from "../src/cleanup/core/card.js";

let failed = 0;
const ok = (cond: boolean, msg: string, extra?: string) => {
  if (cond) console.log("ok:   " + msg);
  else { failed++; console.log("FAIL: " + msg + (extra ? "\n" + extra : "")); }
};

const card = (uid: string, fn: string) => `BEGIN:VCARD\r\nVERSION:4.0\r\nUID:${uid}\r\nFN:${fn}\r\nEND:VCARD\r\n`;
const BOOKS: Record<string, string> = { w2: "wedding 2", syn: "Synology Contacts", gm: "Gmail Address Book" };
let books = Object.keys(BOOKS);

// uid -> copies; Thunderbird's get() reaches the LAST copy listed.
const store: Record<string, { parentId: string; vCard: string }[]> = {
  u2: [{ parentId: "w2", vCard: card("u2", "Bea Both") }, { parentId: "syn", vCard: card("u2", "Bea Both") }],
  u3: [{ parentId: "w2", vCard: card("u3", "Cal Wedding Only") }],
  s1: [{ parentId: "syn", vCard: card("s1", "Sam Synology") }],
  s2: [{ parentId: "syn", vCard: card("s2", "Sue Synology") }],
  g1: [{ parentId: "gm", vCard: card("g1", "Gil Gmail") }]
};
let next = 1;
const node = (uid: string, c: { parentId: string; vCard: string }) => ({ id: uid, parentId: c.parentId, type: "contact", properties: { vCard: c.vCard } });
(globalThis as any).browser = {
  addressBooks: {
    async list() {
      return books.map((id) => ({
        id, name: BOOKS[id], readOnly: false, remote: false, type: "addressBook", mailingLists: [],
        contacts: Object.entries(store).flatMap(([uid, copies]) => copies.filter((c) => c.parentId === id).map((c) => node(uid, c)))
      }));
    },
    async get(id: string) { if (!books.includes(id)) throw new Error("no book"); return { id, name: BOOKS[id] }; },
    async delete(id: string) { books = books.filter((b) => b !== id); }
  },
  contacts: {
    async get(uid: string) { const c = store[uid]; return c?.length ? node(uid, c[c.length - 1]) : null; },
    async update(uid: string, props: any) { store[uid].at(-1)!.vCard = props.vCard; },
    async create(parentId: string, _id: null, props: any) {
      const given = /^UID:(.+)$/m.exec(props.vCard)?.[1]?.trim();
      if (given && store[given]) throw new Error("UID taken");
      const uid = given ?? `n${next++}`;
      (store[uid] ??= []).push({ parentId, vCard: given ? props.vCard : props.vCard.replace("VERSION:4.0\r\n", `VERSION:4.0\r\nUID:${uid}\r\n`) });
      return uid;
    },
    async delete(uid: string) { store[uid].pop(); if (!store[uid].length) delete store[uid]; },
    async getPhoto() { return null; }
  },
  mailingLists: {
    async list() { return []; },
    async listMembers() { return []; },
    async get() { throw new Error("no list"); },
    async addMember() {}
  }
};
(globalThis as any).window = globalThis;
// Daynizer's My Contacts has Synology's contacts (the same server book), so Synology Contacts is hidden.
(globalThis as any).api = {
  addressbooks: { all: async () => [{ id: "mine", name: "My Contacts" }] },
  contacts: {
    // Like the real one: `ids` are Daynizer's own contact ids (nanoids), never a vCard's UID.
    vcards: async (ids?: string[]) => ["u2", "s1", "s2"].map((uid) => ({ id: `d-${uid}`, uid, address_book_id: "mine", vcf: card(uid, uid) }))
      .filter((r) => !ids || ids.includes(r.id)),
    saveVCard: (id: string, vcf: string) => bg.thunderbirdSaveVCard(id, vcf),
    createVCard: (bookId: string, vcf: string) => bg.thunderbirdCreateVCard(bookId, vcf),
    delete: (id: string) => bg.thunderbirdContactDelete(id)
  }
};
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} };

async function cleanupState() {
  const loaded = await ab.loadBooks();
  const allCards = loaded.flatMap((b: any) => b.contacts.map((n: any) => ({ ...readCard(n, b.name), uid: n.uid, tb: Boolean(n.tb), shadowed: n.shadowed ?? null })));
  return { loaded, ctx: { state: { books: loaded, allCards } } };
}

const { loaded, ctx } = await cleanupState();
const syn = loaded.find((b: any) => b.id === "tb:syn");
ok(Boolean(syn?.hidden) && !loaded.find((b: any) => b.id === "tb:w2")?.hidden, "Synology Contacts is hidden but still loaded; wedding 2 isn't hidden",
  JSON.stringify(loaded.map((b: any) => [b.id, b.hidden])));
const w2Cards = ctx.state.allCards.filter((c: any) => c.parentId === "tb:w2");
ok(Boolean(w2Cards.find((c: any) => c.uid === "u2")?.shadowed), "wedding 2's copy of Bea is the one add-ons can't reach");

const changes = moveChanges(ctx, w2Cards, "tb:gm", () => ["wedding 2"]);
ok(changes.some((c: any) => c.type === "copies" && c.uid === "u2"), "Bea's move goes through the copies change", JSON.stringify(changes.map((c: any) => c.type)));
const res = await applyChanges(ab.api, "moved wedding 2", changes);
ok(!res.error, "the move went through without an error", String(res.error));
const inW2 = Object.values(store).flat().filter((c) => c.parentId === "w2").length;
ok(inW2 === 0, "wedding 2 is empty", JSON.stringify(store));
const inGm = Object.values(store).flat().filter((c) => c.parentId === "gm").map((c) => /FN:(.*)/.exec(c.vCard)![1].trim()).sort();
ok(JSON.stringify(inGm) === JSON.stringify(["Bea Both", "Cal Wedding Only", "Gil Gmail"]), "Bea and Cal are in Gmail with Gil", JSON.stringify(inGm));
ok(Object.values(store).flat().filter((c) => c.parentId === "syn").length === 3, "Synology still has its three contacts (Bea's under a new ID)");

const after = await cleanupState();
const emptied = after.loaded.find((b: any) => b.id === "tb:w2");
ok(emptied && emptied.contacts.length === 0, "the clean-up data sees wedding 2 empty, so it can be deleted");
await ab.api.deleteBook("tb:w2");
ok(!books.includes("w2"), "wedding 2 deleted");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exitCode = failed ? 1 : 0;
