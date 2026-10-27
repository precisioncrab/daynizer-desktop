// Lists to labels, "Move them into": a Thunderbird mailing list's members get
// the label and move into another address book (one of Thunderbird's, or
// Daynizer's own), the list is deleted, then it's all undone. Through
// labels.js's moveChanges, Contacts Cleanup's history.js, Daynizer's clean-up
// api and the add-on background's writes, against a fake Thunderbird. Also: a
// Thunderbird book that's the same server book as one of Daynizer's is hidden.
import * as bg from "../thunderbird-addon/background/thunderbird";
import * as ab from "../src/cleanup/lib/addressbook.js";
import { applyChanges, undoEntry } from "../src/cleanup/core/history.js";
import { moveChanges } from "../src/cleanup/ui/views/labels.js";
import { readCard } from "../src/cleanup/core/card.js";
import { readThunderbirdBooks, sameAsDaynizer, shownThunderbirdBooks, setThunderbirdSameShown } from "../src/thunderbirdBooks";

let failed = 0;
const ok = (cond: boolean, msg: string, extra?: string) => {
  if (cond) console.log("ok:   " + msg);
  else { failed++; console.log("FAIL: " + msg + (extra ? "\n" + extra : "")); }
};

const card = (uid: string, fn: string) => `BEGIN:VCARD\r\nVERSION:4.0\r\nUID:${uid}\r\nFN:${fn}\r\nEND:VCARD\r\n`;
const uidOf = (vCard: string) => /^UID:(.*)$/m.exec(vCard)?.[1]?.trim() ?? "";
let next = 1;

// Thunderbird: books w2 ("wedding 2") and gm ("Gmail Address Book").
const store: Record<string, { parentId: string; vCard: string }> = {};
let lists: Record<string, { id: string; parentId: string; name: string; nickName: string; description: string; members: string[] }> = {};
// Daynizer's own book "mine" (My Contacts): id -> { uid, vcf }.
const mine: Record<string, { uid: string; vcf: string }> = {};

let bookIds: string[] = [];
function reset() {
  bookIds = ["w2", "gm"];
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(mine)) delete mine[k];
  store.a1 = { parentId: "w2", vCard: card("a1", "Amy Guest") };
  store.b1 = { parentId: "w2", vCard: card("b1", "Ben Guest") };
  store.c1 = { parentId: "w2", vCard: card("c1", "Cy Not Invited") };
  store.b1g = { parentId: "gm", vCard: card("b1g", "Ben Guest") };
  lists = {
    L1: { id: "L1", parentId: "w2", name: "Wedding2", nickName: "w2", description: "the guests", members: ["a1", "b1"] },
    L2: { id: "L2", parentId: "w2", name: "Family", nickName: "", description: "", members: ["a1"] }
  };
}

const node = (uid: string) => ({ id: uid, parentId: store[uid].parentId, type: "contact", properties: { vCard: store[uid].vCard } });
(globalThis as any).browser = {
  addressBooks: {
    async get(id: string) { if (!bookIds.includes(id)) throw new Error("no book"); return { id, name: id }; },
    async delete(id: string) {
      bookIds = bookIds.filter((b) => b !== id);
      for (const u of Object.keys(store)) if (store[u].parentId === id) delete store[u];
      for (const l of Object.keys(lists)) if (lists[l].parentId === id) delete lists[l];
    },
    async list() {
      return bookIds.map((id) => ({
        id, name: id === "w2" ? "wedding 2" : "Gmail Address Book", readOnly: false, remote: false, type: "addressBook",
        contacts: Object.keys(store).filter((u) => store[u].parentId === id).map(node),
        mailingLists: Object.values(lists).filter((l) => l.parentId === id)
          .map((l) => ({ id: l.id, name: l.name, nickName: l.nickName, description: l.description, contacts: l.members.map((m) => ({ id: m })) }))
      }));
    }
  },
  contacts: {
    async get(uid: string) { return store[uid] ? node(uid) : null; },
    async update(uid: string, props: any) { store[uid].vCard = props.vCard; },
    async create(book: string, _id: null, props: any) {
      let uid = uidOf(props.vCard);
      if (uid && store[uid]) throw new Error("UID taken");
      let vCard = props.vCard;
      if (!uid) { uid = `n${next++}`; vCard = vCard.replace(/END:VCARD/, `UID:${uid}\r\nEND:VCARD`); }
      store[uid] = { parentId: book, vCard };
      return uid;
    },
    async delete(uid: string) {
      delete store[uid];
      for (const l of Object.values(lists)) l.members = l.members.filter((m) => m !== uid);
    },
    async getPhoto() { return null; }
  },
  mailingLists: {
    async list(book: string) { return Object.values(lists).filter((l) => l.parentId === book); },
    async get(id: string) { const l = lists[id]; if (!l) throw new Error("no list"); return { id, parentId: l.parentId, name: l.name, nickName: l.nickName, description: l.description }; },
    async listMembers(id: string) { return lists[id].members.map((m) => ({ id: m })); },
    async create(book: string, props: any) { const id = `L${next++}`; lists[id] = { id, parentId: book, ...props, members: [] }; return id; },
    async delete(id: string) { delete lists[id]; },
    async addMember(id: string, uid: string) { if (!lists[id].members.includes(uid)) lists[id].members.push(uid); }
  }
};
(globalThis as any).window = globalThis;
const row = (id: string) => ({ id, uid: mine[id].uid, address_book_id: "mine", vcf: mine[id].vcf });
(globalThis as any).api = {
  addressbooks: { all: async () => [{ id: "mine", name: "My Contacts", carddav_addressbook_url: "https://dav.example/mine/" }] },
  contacts: {
    vcards: async (ids?: string[]) => (ids ?? Object.keys(mine)).filter((id) => mine[id]).map(row),
    saveVCard: (id: string, vcf: string) => (id.startsWith("tb:") ? bg.thunderbirdSaveVCard(id, vcf) : Promise.resolve(void (mine[id].vcf = vcf))),
    createVCard: (bookId: string, vcf: string) => {
      if (bookId.startsWith("tb:")) return bg.thunderbirdCreateVCard(bookId, vcf);
      const id = `d${next++}`;
      mine[id] = { uid: uidOf(vcf) || id, vcf };
      return Promise.resolve({ id });
    },
    delete: (id: string) => (id.startsWith("tb:") ? bg.thunderbirdContactDelete(id) : Promise.resolve(void delete mine[id]))
  }
};

async function ctxNow() {
  const books = await ab.loadBooks();
  const allCards = books.flatMap((b: any) => b.contacts.map((n: any) => ({ ...readCard(n, b.name), uid: n.uid, tb: Boolean(n.tb), shadowed: n.shadowed ?? null })));
  return { books, ctx: { state: { books, allCards } } };
}
const labelsOf = (vCard: string) => /^CATEGORIES:(.*)$/m.exec(vCard)?.[1]?.split(",") ?? [];

async function moveWedding(target: string, title: string) {
  const { books, ctx } = await ctxNow();
  const w2 = books.find((b: any) => b.id === "tb:w2");
  const list = w2.lists.find((l: any) => l.name === "Wedding2");
  const members = ctx.state.allCards.filter((c: any) => c.parentId === "tb:w2" && list.members.includes(c.uid));
  const listLabels = (c: any) => w2.lists.filter((l: any) => l.members.includes(c.uid)).map((l: any) => l.name);
  const changes: any[] = moveChanges(ctx, members, target, (c: any) => [...new Set(["Wedding2", ...listLabels(c)])]);
  changes.push({ type: "deleteList", listId: list.id, label: list.name });
  const res = await applyChanges(ab.api, title, changes);
  ok(!res.error, `${title}: applied without an error`, String(res.error));
  return res.entry;
}

// 1. Into Gmail Address Book (Thunderbird); Ben is already there under another ID, so he's copied, not combined.
reset();
let entry = await moveWedding("tb:gm", "into Gmail Address Book");
const inGm = Object.values(store).filter((c) => c.parentId === "gm");
const amy = inGm.find((c) => /FN:Amy/.test(c.vCard));
ok(Boolean(amy) && labelsOf(amy!.vCard).sort().join() === "Family,Wedding2", "Amy is in Gmail with Wedding2 and Family as labels", amy?.vCard);
ok(inGm.filter((c) => /FN:Ben/.test(c.vCard)).length === 2, "Ben's moved copy sits next to the Gmail Ben with another ID (not combined)");
ok(!store.a1 && !store.b1 && Boolean(store.c1), "Amy and Ben left wedding 2; Cy (not in the list) stayed");
ok(!lists.L1 && Boolean(lists.L2) && lists.L2.members.length === 0, "Wedding2 is deleted; Family stays, now empty");
let undone = await undoEntry(ab.api, entry, { force: true });
ok(Boolean(undone.done), "undo ran", JSON.stringify(undone));
const w2Now = Object.values(store).filter((c) => c.parentId === "w2").map((c) => uidOf(c.vCard)).sort();
ok(JSON.stringify(w2Now) === JSON.stringify(["a1", "b1", "c1"]) && Object.values(store).filter((c) => c.parentId === "gm").length === 1,
  "undo: Amy and Ben back in wedding 2 with their IDs, the copies gone from Gmail", JSON.stringify(store));
const wedding = Object.values(lists).find((l) => l.name === "Wedding2");
ok(Boolean(wedding) && [...wedding!.members].sort().join() === "a1,b1" && lists.L2.members.join() === "a1",
  "undo: Wedding2 made again with Amy and Ben, Amy back in Family", JSON.stringify(lists));

// 2. Into Daynizer's My Contacts.
reset();
entry = await moveWedding("mine", "into My Contacts");
const mineCards = Object.values(mine);
ok(mineCards.length === 2 && mineCards.every((c) => labelsOf(c.vcf).includes("Wedding2")), "Amy and Ben are in My Contacts with the label", JSON.stringify(mine));
ok(mineCards.every((c) => !["a1", "b1"].includes(c.uid)), "made there with new IDs (Thunderbird's copies are deleted, not shared)");
ok(!store.a1 && !store.b1 && !lists.L1, "gone from wedding 2, list deleted");
undone = await undoEntry(ab.api, entry, { force: true });
ok(Boolean(undone.done) && Object.keys(mine).length === 0 && Boolean(store.a1) && Boolean(store.b1), "undo: back in wedding 2, gone from My Contacts", JSON.stringify(undone));
ok([...(Object.values(lists).find((l) => l.name === "Wedding2")?.members ?? [])].sort().join() === "a1,b1", "undo: Wedding2 made again with its members");

// 3. A Thunderbird book that's the same server book as one of Daynizer's (Synology Contacts and My Contacts):
// told by contact IDs, hidden from the clean-up pages (and the contact list) unless shown.
reset();
const saved: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => saved[k] ?? null, setItem: (k: string, v: string) => { saved[k] = v; } };
mine.d1 = { uid: "b1g", vcf: card("b1g", "Ben Guest") };
const all = await sameAsDaynizer(await readThunderbirdBooks());
ok(all.find((b) => b.id === "tb:gm")?.sameAs === "My Contacts" && all.find((b) => b.id === "tb:w2")?.sameAs === null,
  "Gmail Address Book (all its IDs in My Contacts) is the same as My Contacts; wedding 2 isn't", JSON.stringify(all.map((b) => [b.id, b.sameAs])));
ok(shownThunderbirdBooks(all).map((b) => b.id).join() === "tb:w2", "it's hidden");
let loaded = await ab.loadBooks();
ok(loaded.find((b: any) => b.id === "tb:gm")?.hidden === true && loaded.find((b: any) => b.id === "tb:w2")?.hidden === false, "the clean-up data keeps it, marked hidden (the pages leave it out)");
setThunderbirdSameShown("tb:gm", true);
loaded = await ab.loadBooks();
ok(shownThunderbirdBooks(all).length === 2 && loaded.find((b: any) => b.id === "tb:gm")?.hidden === false, "Show it: back in both");
setThunderbirdSameShown("tb:gm", false);
ok(shownThunderbirdBooks(all).length === 1, "Hide it: hidden again");
mine.d2 = { uid: "zz", vcf: card("zz", "Someone Else") };
delete mine.d1;
ok((await sameAsDaynizer(await readThunderbirdBooks())).every((b) => b.sameAs === null), "no match below 80%: nothing hidden");

// 4. The whole wedding 2 book moved into Gmail, then wedding 2 deleted: Undo refuses (nowhere to put
// the contacts back), so the moved copies in Gmail aren't taken away.
reset();
mine.d1 = { uid: "x", vcf: card("x", "Not Related") };
{
  const { ctx } = await ctxNow();
  const cards = ctx.state.allCards.filter((c: any) => c.parentId === "tb:w2");
  const res = await applyChanges(ab.api, "moved wedding 2", moveChanges(ctx, cards, "tb:gm", () => ["wedding 2"]));
  ok(!res.error && Object.values(store).filter((c) => c.parentId === "w2").length === 0, "wedding 2 emptied into Gmail", String(res.error));
  await ab.api.deleteBook("tb:w2");
  ok(!bookIds.includes("w2"), "wedding 2 deleted");
  const inGmail = Object.values(store).filter((c) => c.parentId === "gm").length;
  const undone = await undoEntry(ab.api, res.entry, { force: true });
  ok(!undone.done && /deleted since/.test(String(undone.error)), "Undo refuses: the book is gone", JSON.stringify(undone));
  ok(Object.values(store).filter((c) => c.parentId === "gm").length === inGmail, "the moved contacts stay in Gmail");
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exitCode = failed ? 1 : 0;
