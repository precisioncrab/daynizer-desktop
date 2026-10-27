/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Contacts Cleanup's pages inside Daynizer's Contacts tab. This is Contacts
 * Cleanup's src/ui/tab.js without its sidebar, menus and theme, which
 * Daynizer's own (React) Contacts tab provides: it reads the address books,
 * works out the proposals (src/cleanup/core/), draws the page that's open
 * into the main column and right-hand panel Daynizer hands it (mount), and
 * applies what the user kept, recording each change for undo.
 *
 * The pages themselves (src/cleanup/ui/views/) are Contacts Cleanup's,
 * drawn with plain DOM calls, so a fix in one product copies to the other.
 *
 * Kept in this computer's IndexedDB (src/cleanup/lib/store.js):
 *   settings   { phoneStyle, country, gateway, duplicatesAcrossBooks, newCardBook }
 *   dismissed  duplicate pairs marked "Not duplicates"
 *   generated  { <card id>: [chat addresses this page wrote] }
 *   history    applied changes, newest first (src/cleanup/core/history.js)
 *   links      linked copies of a contact, [[card id, ...]] (src/cleanup/core/copies.js)
 *   copiesLeft contacts in several address books left as they are (UIDs)
 */

import { h, fill, plural } from "./ui/dom.js";
import { onPhotosLoaded } from "./ui/parts.js";
import { loadBooks, api } from "./lib/addressbook.js";
import { getMany, setMany } from "./lib/store.js";
import { omemoClient } from "./lib/omemo.js";
import { readCard, label } from "./core/card.js";
import { findDuplicates, suggestPeople } from "./core/duplicates.js";
import { phoneFixes, proposeName } from "./core/fixes.js";
import { prefixFixes, DEFAULT_GATEWAY } from "./core/chat.js";
import { countryById } from "./core/phone.js";
import { applyChanges, undoEntry, addEntry } from "./core/history.js";
import { partnersOf, pruneLinks, followEdit } from "./core/copies.js";
import { comparable } from "./core/vcard.js";
import duplicates from "./ui/views/duplicates.js";
import copies from "./ui/views/copies.js";
import labelsView from "./ui/views/labels.js";
import phones from "./ui/views/phones.js";
import names from "./ui/views/names.js";
import chat from "./ui/views/chat.js";
import changesView from "./ui/views/history.js";
import { refreshOmemo } from "./ui/omemo-state.js";

export const VIEWS = { duplicates, copies, phones, names, labels: labelsView, chat, history: changesView };

const DEFAULT_SETTINGS = { phoneStyle: "international", country: "nanp", gateway: DEFAULT_GATEWAY, duplicatesAcrossBooks: false, newCardBook: null };

/** An OMEMO client that never answers, where there's no OMEMO for Thunderbird to ask (the desktop app). */
const noOmemo = {
  status: async () => ({ installed: false }),
  preview: async () => null,
  setMode: async () => null,
  openOptions: async () => {},
  canAddContacts: async () => false,
  addContacts: async () => ({ added: [], failed: [] }),
  removeContacts: async () => ({ removed: [], failed: [] }),
};

/**
 * The clean-up pages for one Daynizer window.
 *
 * @param {object} options
 * @param {boolean} options.addon - running in the Thunderbird add-on (OMEMO for Thunderbird can be asked)
 * @param {() => boolean} options.omemoPromo - whether links to get OMEMO for Thunderbird may show (the add-on's trial and free tier only)
 * @param {() => void} options.onChanged - contacts were saved, created or deleted (reload them, sync soon)
 * @param {(entry: object) => void} options.onApplied - a change was applied (for Edit > Undo)
 * @param {(view: string) => void} options.onSetView - a page asked to open another page
 * @param {() => void} options.onUpdate - counts, busy or the history changed (redraw the sidebar)
 * @param {() => boolean} [options.hideChatList] - the Chat page's Chat list tab is hidden (View > Contacts Sidebar…)
 * @param {() => string[]} [options.scopeBooks] - the address books selected in the sidebar; the clean-up tools work on these (all when empty)
 */
export function createCleanup(options) {
  const state = {
    view: "duplicates",
    loading: true,
    loadError: null,
    books: [],
    allCards: [],
    cards: [],
    settings: { ...DEFAULT_SETTINGS },
    dismissed: new Set(),
    generated: {},
    history: [],
    links: [],
    copiesLeft: new Set(),
    copiesChoice: new Map(),
    copiesShowLeft: false,
    selected: null,
    search: "",
    busy: null,
    phoneOff: new Set(),
    nameEdits: new Map(),
    nameOn: new Map(),
    prefixOff: new Set(),
    chat: { tab: "contacts", account: null, pick: null, sel: new Set(), namedOpen: false, filter: "all" },
    merge: null,
    drafts: new Map(),
    newContact: null,
    omemo: { loading: false, status: null, result: null, error: null, canAdd: false },
  };

  const derived = { duplicates: [], phones: [], names: [], prefix: [] };

  // Where the open page is drawn (null while Daynizer shows its own All contacts).
  let mounted = null;
  // Changes this makes come back as a contacts reload from Daynizer; it reads once when done instead.
  let applying = false;
  // Until then, Daynizer's reload after a change made here is that change (already read).
  let quietUntil = 0;
  let ready = null;

  const ctx = {
    state,
    derived,
    omemo: options.addon ? omemoClient() : noOmemo,
    host: {
      addon: Boolean(options.addon),
      get omemoPromo() {
        return Boolean(options.addon && options.omemoPromo());
      },
      // Hidden under View > Contacts Sidebar… (the Chat page's Chat list tab).
      get hideChatList() {
        return Boolean(options.hideChatList?.());
      },
    },
    render,
    /** Address books the clean-up tools leave out: those not selected in the sidebar (none when no book is selected). */
    excludedBooks,
    select(key) {
      state.selected = key;
      state.newContact = null;
      render();
    },
    setView(view) {
      options.onSetView(view);
    },
    saveSettings,
    dismiss,
    apply,
    undo,
    deleteBook,
    saveLinks,
    leaveCopies,
    renameList,
    askName: (o) => askName(o),
    confirm: (o) => confirmDialog(o),
    toast: (text, o) => toast(text, o),
  };

  /* ---------- Data ---------- */

  function recompute() {
    const s = state.settings;
    const country = countryById(s.country);
    // A copy of Thunderbird's that add-ons can't change (one UID in two of its books,
    // src/cleanup/lib/addressbook.js) is never proposed for a change, as in Contacts Cleanup.
    const cards = state.cards.filter((c) => !c.shadowed);
    // Daynizer's contacts and Thunderbird's are compared each among themselves: a book both sync
    // holds the same contacts twice, which isn't a duplicate to merge.
    const across = { acrossBooks: s.duplicatesAcrossBooks };
    derived.duplicates = [
      ...findDuplicates(cards.filter((c) => !c.tb), state.dismissed, across),
      ...findDuplicates(cards.filter((c) => c.tb), state.dismissed, across),
    ]
      .sort((a, b) => b.cards.length - a.cards.length || label(a.cards[0]).localeCompare(label(b.cards[0])))
      .map((group) => ({ ...group, suggested: suggestPeople(group.cards, state.dismissed) }));
    derived.phones = cards
      .map((card) => ({ card, ...phoneFixes(card, { style: s.phoneStyle, country }) }))
      .filter((p) => p.fixes.length || p.skipped.length);
    derived.names = cards.map((card) => ({ card, proposal: proposeName(card) })).filter((n) => n.proposal);
    derived.prefix = cards.map((card) => ({ card, fixes: prefixFixes(card) })).filter((p) => p.fixes.length);
  }

  async function reload() {
    try {
      state.books = await loadBooks();
      state.loadError = null;
    } catch (e) {
      state.books = [];
      state.loadError = e?.message ?? String(e);
    }
    state.allCards = state.books
      .flatMap((book) => book.contacts.map((node) => ({ ...readCard(node, book.name), uid: node.uid, tb: Boolean(node.tb), shadowed: node.shadowed ?? null })))
      .sort((a, b) => label(a).localeCompare(label(b)));
    const excluded = excludedBooks();
    state.cards = state.allCards.filter((c) => !excluded.has(c.parentId));
    // Links to a card that's gone (deleted, or moved to another address book) go too.
    if (!state.loadError) {
      const exists = new Set(state.allCards.map((c) => c.id));
      const links = pruneLinks(state.links, (id) => exists.has(id));
      if (JSON.stringify(links) !== JSON.stringify(state.links)) {
        await saveLinks(links, false);
      }
    }
    afterScope();
  }

  /**
   * Daynizer: the clean-up tools work on the address books selected in the
   * sidebar (Ctrl+click for several), all of them when none is (Arlis
   * 2026-10-26; Contacts Cleanup's "include" checkboxes became that selection).
   */
  function excludedBooks() {
    const picked = options.scopeBooks?.() ?? [];
    // Daynizer: a hidden Thunderbird book (the same contacts as one of Daynizer's) is always left out.
    const hidden = state.books.filter((b) => b.hidden).map((b) => b.id);
    return new Set([...hidden, ...(picked.length ? state.books.map((b) => b.id).filter((id) => !picked.includes(id)) : [])]);
  }

  /** The cards in scope changed: drops what belonged to cards now out of it, and draws the page again. */
  function afterScope() {
    const ids = new Set(state.cards.map((c) => c.id));
    for (const map of [state.nameEdits, state.nameOn, state.drafts]) {
      for (const id of map.keys()) {
        if (!ids.has(id)) {
          map.delete(id);
        }
      }
    }
    for (const id of state.chat.sel) {
      if (!ids.has(id)) {
        state.chat.sel.delete(id);
      }
    }
    if (state.merge && !state.merge.key.split("|").every((id) => ids.has(id))) {
      state.merge = null;
    }
    recompute();
    state.loading = false;
    render();
  }

  async function saveSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    await setMany({ settings: state.settings });
    recompute();
    render();
  }

  async function dismiss(pairs) {
    for (const pair of pairs) {
      state.dismissed.add(pair);
    }
    await setMany({ dismissed: [...state.dismissed] });
    state.selected = null;
    recompute();
    render();
  }

  async function saveLinks(links, redraw = true) {
    state.links = links;
    await setMany({ links });
    if (redraw) {
      render();
    }
  }

  /** Marks contacts in several address books as left as they are (or asks about them again). */
  async function leaveCopies(uids, left) {
    for (const uid of uids) {
      state.copiesLeft[left ? "add" : "delete"](uid);
    }
    await setMany({ copiesLeft: [...state.copiesLeft] });
    state.selected = null;
    render();
  }

  /** The changes with the same edit made to each linked copy of a changed card, unless the change says `only`. */
  function withLinkedCopies(changes) {
    if (!state.links.length) {
      return changes;
    }
    const touched = new Set(changes.map((c) => c.id).filter(Boolean));
    const more = [];
    for (const change of changes) {
      if (change.type !== "update" || change.only) {
        continue;
      }
      for (const id of partnersOf(state.links, change.id)) {
        const copy = state.allCards.find((c) => c.id === id);
        if (!copy || touched.has(id)) {
          continue;
        }
        const vCard = followEdit(copy.vCard, change.vCard);
        if (comparable(vCard) !== comparable(copy.vCard)) {
          touched.add(id);
          more.push({ type: "update", id, vCard, label: `${change.label} (linked copy in ${copy.bookName})` });
        }
      }
    }
    return [...changes, ...more];
  }

  /** Records chat addresses written (+1) or taken off (-1) by these pages. */
  function trackGenerated(generated, direction) {
    const add = (id, address) => {
      state.generated[id] = [...new Set([...(state.generated[id] ?? []), address])];
    };
    const drop = (id, address) => {
      state.generated[id] = (state.generated[id] ?? []).filter((a) => a !== address);
      if (!state.generated[id].length) {
        delete state.generated[id];
      }
    };
    for (const [id, address] of generated.added ?? []) {
      (direction > 0 ? add : drop)(id, address);
    }
    for (const [id, address] of generated.removed ?? []) {
      (direction > 0 ? drop : add)(id, address);
    }
  }

  /**
   * Applies changes to cards (src/cleanup/core/history.js), and to their
   * linked copies, records them for undo, and offers Undo. `extra.generated`
   * is { added, removed } chat addresses; `extra.onDone(results, entry)` runs
   * before the contacts are read again. Returns the history entry, or null
   * when nothing was changed.
   */
  async function apply(title, changes, extra = {}) {
    if (!changes.length || state.busy) {
      return null;
    }
    // Changes to Thunderbird's own contacts ("tb:" ids) go through the same api since the
    // add-on's Manifest V2 move (0.9.0); the add-on's background writes them to Thunderbird.
    changes = withLinkedCopies(changes);
    applying = true;
    state.busy = { done: 0, total: changes.length };
    render();
    const { entry, error, results } = await applyChanges(api, title, changes, (done, total) => {
      state.busy = { done, total };
      renderProgress();
    });
    if (extra.onDone) {
      await extra.onDone(results, entry);
    }
    const changed = entry.cards.length > 0;
    if (changed) {
      if (extra.generated) {
        const done = new Set(entry.cards.map((c) => c.id));
        entry.generated = {
          added: (extra.generated.added ?? []).filter(([id]) => done.has(id)),
          removed: (extra.generated.removed ?? []).filter(([id]) => done.has(id)),
        };
        trackGenerated(entry.generated, +1);
      }
      state.history = addEntry(state.history, entry);
      // Daynizer: Edit > Undo (Ctrl+Z) gets the change as soon as it's made, before anything below can fail.
      options.onApplied(entry);
      await setMany({ history: state.history, generated: state.generated, dismissed: [...state.dismissed] })
        .catch((e) => console.error("[cleanup] couldn't save the change history", e));
    }
    state.busy = null;
    try {
      await reload();
    } catch (e) {
      console.error("[cleanup] reading the contacts again after a change failed", e);
      state.loading = false;
      render();
    }
    applying = false;
    if (changed) {
      quietUntil = Date.now() + 2000;
      options.onChanged();
    }
    if (error) {
      toast(`Stopped: ${error}${changed ? ` ${plural(entry.cards.length, "card was", "cards were")} changed before that.` : ""}`, { error: true, entry: changed ? entry : null });
    } else {
      toast(`${title}.`, { entry });
    }
    return changed ? entry : null;
  }

  /**
   * Deletes an address book (Thunderbird's: { id, name, contacts, lists }) after
   * asking, unless `asked`. It can't be undone; Undo refuses an earlier change
   * that would put contacts back into it. True when it's gone.
   */
  async function deleteBook(book, { asked = false } = {}) {
    if (!asked) {
      const lists = book.lists?.length ?? 0;
      const what = [
        book.contacts.length ? plural(book.contacts.length, "contact", "contacts") : null,
        lists ? plural(lists, "mailing list", "mailing lists") : null,
      ].filter(Boolean).join(" and ");
      const go = await confirmDialog({
        title: `Delete the address book ${book.name}?`,
        body: [h("p", {}, `${what ? `Thunderbird deletes it with its ${what}.` : "It's empty."} This can't be undone.`)],
        ok: "Delete",
        danger: true,
      });
      if (!go) {
        return false;
      }
    }
    try {
      await api.deleteBook(book.id);
    } catch (e) {
      // Thunderbird refuses its two built-in books with a bare "An unexpected error occurred" (and
      // doesn't tell add-ons which books are built in), so the message says what that usually means.
      console.error("[cleanup] deleting an address book", e);
      toast(`Thunderbird didn't delete ${book.name}, and nothing was changed. It never deletes its two built-in address books (Personal Address Book and Collected Addresses); other address books can be deleted.`, { error: true });
      return false;
    }
    await reload().catch(() => {});
    options.onChanged();
    toast(`Deleted the address book ${book.name}.`);
    return true;
  }

  async function undo(entry) {
    if (!entry || entry.undone || state.busy) {
      return;
    }
    applying = true;
    state.busy = { text: "Undoing…" };
    render();
    let result = await undoEntry(api, entry);
    if (!result.done && result.conflicts.length && !result.error) {
      state.busy = null;
      render();
      const reasons = { changed: "changed since", missing: "deleted since", exists: "is back already" };
      const go = await confirmDialog({
        title: "Some cards changed since",
        body: [
          h("p", {}, `Undoing "${entry.title}" puts these cards back as they were before it, and anything changed on them since is lost:`),
          h("ul", {}, result.conflicts.map((c) => h("li", {}, `${c.label}: ${reasons[c.reason]}`))),
        ],
        ok: "Undo anyway",
        danger: true,
      });
      if (!go) {
        applying = false;
        return;
      }
      state.busy = { text: "Undoing…" };
      render();
      result = await undoEntry(api, entry, { force: true });
    }
    if (result.done) {
      entry.undone = true;
      if (entry.generated) {
        trackGenerated(entry.generated, -1);
      }
      await setMany({ history: state.history, generated: state.generated, dismissed: [...state.dismissed] });
    }
    state.busy = null;
    await reload();
    applying = false;
    quietUntil = Date.now() + 2000;
    options.onChanged();
    toast(result.done ? `Undone: ${entry.title}.` : `Couldn't undo: ${result.error}`, { error: !result.done });
  }

  /* ---------- Toast and dialog (in their own .cleanup layer, over Daynizer) ---------- */

  let layer = null;
  const overlayLayer = () => {
    if (!layer) {
      layer = h("div", { class: "cleanup cleanup-layer" }, h("div", { class: "cleanup-modal-root" }), h("div", { class: "toast", hidden: true }));
      document.body.append(layer);
    }
    return layer;
  };

  let toastTimer = null;

  function toast(text, { entry = null, error = false } = {}) {
    const el = overlayLayer().querySelector(".toast");
    clearTimeout(toastTimer);
    fill(el,
      h("span", {}, text),
      entry && !entry.undone ? h("button", { onClick: () => {
        el.hidden = true;
        undo(entry);
      } }, "Undo") : null,
      h("button", { class: "link", "aria-label": "Close", onClick: () => {
        el.hidden = true;
      } }, "✕"));
    el.className = `toast${error ? " error" : ""}`;
    el.hidden = false;
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, error ? 20000 : 12000);
  }

  /** A dialog asking for a name; the new name, or null (cancelled, empty or unchanged). */
  async function askName({ title, text, value, ok = "Rename" }) {
    let name = value;
    const input = h("input", { type: "text", style: { width: "100%" }, value, onInput: (e) => {
      name = e.target.value;
    }, onKeydown: (e) => {
      if (e.key === "Enter") {
        overlayLayer().querySelector(".cleanup-modal-root .dialog-actions .primary")?.click();
      }
    } });
    const answer = confirmDialog({ title, body: [text ? h("p", {}, text) : null, input], ok });
    input.focus();
    input.select();
    const go = await answer;
    const next = name.trim();
    return go && next && next !== value ? next : null;
  }

  /** Renames one of Thunderbird's mailing lists ({ id, name }); true when it's done. */
  async function renameList(list, name) {
    try {
      await api.renameList(list.id, name);
    } catch (e) {
      console.error("[cleanup] renaming a mailing list", e);
      toast(`Thunderbird didn't rename the list ${list.name}, and nothing was changed: ${e?.message ?? e}`, { error: true });
      return false;
    }
    await reload().catch(() => {});
    options.onChanged();
    toast(`Renamed the list ${list.name} to ${name}.`);
    return true;
  }

  function confirmDialog({ title, body, ok = "OK", cancel = "Cancel", danger = false }) {
    const root = overlayLayer().querySelector(".cleanup-modal-root");
    return new Promise((resolve) => {
      const close = (value) => {
        root.replaceChildren();
        document.removeEventListener("keydown", onKey, true);
        resolve(value);
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close(false);
        }
      };
      document.addEventListener("keydown", onKey, true);
      fill(root, h("div", { class: "overlay", onClick: (e) => {
        if (e.target === e.currentTarget) {
          close(false);
        }
      } },
      h("div", { class: "dialog", role: "dialog", "aria-modal": "true" },
        h("h2", {}, title),
        body,
        h("div", { class: "dialog-actions" },
          h("button", { onClick: () => close(false) }, cancel),
          h("button", { class: danger ? "primary danger" : "primary", onClick: () => close(true) }, ok)))));
      root.querySelector(".dialog-actions .primary")?.focus();
    });
  }

  /* ---------- Rendering ---------- */

  function renderProgress() {
    const el = mounted?.main.querySelector("#cleanup-progress");
    if (el && state.busy) {
      el.textContent = state.busy.text ?? `Saving ${state.busy.done} of ${state.busy.total}…`;
    }
  }

  /** Daynizer: says which address books the page looks at when the sidebar selection narrows it. */
  function scopeNote() {
    const excluded = excludedBooks();
    // A hidden book is left out without asking, so it doesn't make this note show.
    if (state.loading || !state.books.some((b) => !b.hidden && excluded.has(b.id))) {
      return null;
    }
    const names = state.books.filter((b) => !excluded.has(b.id)).map((b) => b.name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    return h("div", { class: "notice scope-note" },
      `Only ${list}, as selected in the sidebar. Ctrl+click an address book to add it or take it out; click All contacts to clean up every address book.`);
  }

  /** Draws the open page, keeping focus, text selection and scroll positions; tells Daynizer counts may have changed. */
  function render() {
    options.onUpdate();
    if (!mounted) {
      return;
    }
    const { main, rail } = mounted;
    const view = VIEWS[state.view];
    const active = document.activeElement;
    const focus = active?.id && (main.contains(active) || rail.contains(active)) ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
    const scroll = {};
    for (const el of [...main.querySelectorAll("[data-scroll]"), ...rail.querySelectorAll("[data-scroll]")]) {
      scroll[el.dataset.scroll] = el.scrollTop;
    }
    let body;
    if (state.loading) {
      body = h("div", { class: "empty-state" }, "Reading the address books…");
    } else if (state.loadError) {
      body = h("div", { class: "empty-state" }, h("div", { class: "big" }, "Couldn't read the address books."), state.loadError);
    } else {
      body = view.main(ctx);
    }
    fill(main, scopeNote(), body, state.busy ? h("div", { class: "toolbar-filters" }, h("span", { id: "cleanup-progress", class: "progress" })) : null);
    fill(rail, h("div", { class: "detail-panel", "data-scroll": "detail" }, state.loading ? null : view.detail(ctx)));
    renderProgress();
    for (const el of [...main.querySelectorAll("[data-scroll]"), ...rail.querySelectorAll("[data-scroll]")]) {
      if (scroll[el.dataset.scroll]) {
        el.scrollTop = scroll[el.dataset.scroll];
      }
    }
    if (focus) {
      const el = document.getElementById(focus.id);
      if (el) {
        el.focus();
        if (typeof focus.start === "number" && el.setSelectionRange) {
          try {
            el.setSelectionRange(focus.start, focus.end);
          } catch {
            // Not a text field.
          }
        }
      }
    }
  }

  async function start() {
    const stored = await getMany(["settings", "dismissed", "generated", "history", "links", "copiesLeft"]);
    state.settings = { ...DEFAULT_SETTINGS, ...stored.settings };
    state.dismissed = new Set(stored.dismissed ?? []);
    // First run: bring over the pairs marked "Not duplicates" in Daynizer's earlier merge screen (same ids, same pair form).
    if (!stored.dismissed) {
      try {
        const old = JSON.parse((await window.api.settings?.all())?.dismissedDupPairs || "[]");
        if (Array.isArray(old)) {
          old.forEach((pair) => state.dismissed.add(pair));
          await setMany({ dismissed: [...state.dismissed] });
        }
      } catch {
        // Nothing to bring over.
      }
    }
    state.generated = stored.generated ?? {};
    state.history = stored.history ?? [];
    state.links = stored.links ?? [];
    state.copiesLeft = new Set(stored.copiesLeft ?? []);
    onPhotosLoaded(render);
    await reload();
    if (options.addon) {
      await refreshOmemo(ctx);
    }
  }

  let reloadTimer = null;

  return {
    ctx,
    /** Reads the contacts; call once. */
    start() {
      ready ??= start();
      return ready;
    },
    /** Daynizer's contacts changed (a sync, an edit in its own editor): read them again soon. */
    contactsChanged() {
      if (applying || Date.now() < quietUntil) {
        return;
      }
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        if (!applying && ready) {
          reload();
        }
      }, 400);
    },
    /** The sidebar selection changed: the clean-up tools look at the selected address books now. */
    scopeChanged() {
      if (state.loading || !state.allCards) {
        return;
      }
      const excluded = excludedBooks();
      state.cards = state.allCards.filter((c) => !excluded.has(c.parentId));
      afterScope();
    },
    /** Draws `view` into these elements (the main column and the right-hand panel). */
    mount(view, main, rail) {
      const changed = state.view !== view;
      if (changed) {
        state.view = view;
        state.selected = null;
        state.newContact = null;
        state.chat.pick = null;
        state.merge = view === "duplicates" ? state.merge : null;
      }
      mounted = { main, rail };
      render();
      VIEWS[view]?.onShow?.(ctx);
    },
    unmount() {
      mounted = null;
    },
    /**
     * A contact was saved in Daynizer's own editor: its linked copies (In
     * several books, Link) get the same details. Not an undo entry, like the
     * edit itself. Returns how many copies changed.
     */
    async followLinked(id) {
      if (!ready) {
        return 0;
      }
      await ready;
      const partners = partnersOf(state.links, id);
      if (!partners.length) {
        return 0;
      }
      const cards = await window.api.contacts.vcards([id, ...partners]);
      const edited = cards.find((c) => c.id === id);
      if (!edited) {
        return 0;
      }
      let changed = 0;
      for (const copy of cards.filter((c) => c.id !== id)) {
        const vCard = followEdit(copy.vcf, edited.vcf);
        if (comparable(vCard) !== comparable(copy.vcf)) {
          await api.update(copy.id, vCard);
          changed++;
        }
      }
      return changed;
    },
    /** The sidebar count for a page (null for none). */
    count(view) {
      return state.loading ? null : VIEWS[view]?.count(ctx) ?? null;
    },
    /** What OMEMO for Thunderbird answered: "none", "free" or "pro". */
    omemoStatus: () => state.omemo.status,
    openOmemoSettings: () => ctx.omemo.openOptions("settings").catch(() => {}),
    /** The newest change not undone yet. */
    lastEntry: () => state.history.find((e) => !e.undone) ?? null,
    undo,
    busy: () => Boolean(state.busy),
  };
}
