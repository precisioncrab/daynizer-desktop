/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The contact editor in the right-hand panel, like Daynizer's contact
 * panel: every field of the selected contact, Save and Delete. Shown for
 * the contact selected on any page that lists contacts, and for New
 * contact. Its additions over Daynizer's: "+ JMP.chat address for" each
 * number, and an "In chat list" checkbox on each chat address (through
 * OMEMO for Thunderbird, when it's installed).
 *
 * Edits are kept per contact (ctx.state.drafts) until saved, so moving to
 * another contact and back keeps them. Saving is one change with undo;
 * moving a contact to another address book is a copy there and a delete
 * here (Thunderbird has no move for add-ons), undone together.
 *
 * A contact linked with its copies in other address books (In several
 * books) says so: saving changes the copies too (src/ui/tab.js), unless
 * "Save this copy only" is checked.
 */

import { h } from "./dom.js";
import { avatar } from "./parts.js";
import { label as cardLabel, chatAddressOf } from "../core/card.js";
import { comparable } from "../core/vcard.js";
import { withoutUid } from "../core/history.js";
import { partnersOf, unlink, followEdit, sameDetails } from "../core/copies.js";
import { cardModel, modelToVCard, newContactVCard, emptyModel, PHONE_TYPES, EMAIL_TYPES, ADDRESS_TYPES } from "../core/card-model.js";
import { jmpAddress, normalizeGateway, DEFAULT_GATEWAY } from "../core/chat.js";
import { phoneNumber } from "../core/phone.js";
import { chatLists, chatAccounts, accountLabel, changeChatList } from "./omemo-state.js";
import { LINKS, openLink } from "../lib/links.js";
import { THUNDERBIRD_READ_ONLY } from "../../thunderbirdBooks";

const gatewayOf = (ctx) => normalizeGateway(ctx.state.settings.gateway) ?? DEFAULT_GATEWAY;
// The address in a chat address box, however it's written (xmpp:, Google's x-apple:, bare).
const bareChat = (value) => chatAddressOf(value) ?? "";
const writableBooks = (ctx) => {
  const excluded = ctx.excludedBooks();
  return ctx.state.books.filter((b) => !b.readOnly && !b.remote && !excluded.has(b.id));
};

/** The edits for a contact, made from the card when there are none (or the card changed and nothing was edited). */
function draftFor(ctx, card) {
  let d = ctx.state.drafts.get(card.id);
  // The card changed (saved here or elsewhere): start from it again unless there are real edits waiting.
  const edited = d && d.touched && (d.chatList.size || d.book !== card.parentId || JSON.stringify(d.model) !== JSON.stringify(cardModel(d.base)));
  if (!d || (d.base !== card.vCard && !edited)) {
    d = { base: card.vCard, model: cardModel(card.vCard), book: card.parentId, chatList: new Map(), touched: false };
    ctx.state.drafts.set(card.id, d);
  }
  return d;
}

/** Opens an empty contact in the panel. */
export function startNewContact(ctx) {
  const books = writableBooks(ctx);
  const book = books.some((b) => b.id === ctx.state.settings.newCardBook) ? ctx.state.settings.newCardBook : books[0]?.id;
  ctx.state.newContact = { model: emptyModel(), book, chatList: new Map(), touched: false };
  ctx.state.selected = null;
  ctx.render();
  document.getElementById("cp-given")?.focus();
}

/** Whether saving would change anything. */
function isDirty(ctx, d, card) {
  if (d.chatList.size) {
    return true;
  }
  if (!card) {
    const m = d.model;
    return Boolean(m.fn || m.given || m.family || m.org || m.phones.length || m.emails.length || m.chats.length);
  }
  return d.book !== card.parentId || comparable(modelToVCard(card.vCard, d.model)) !== comparable(card.vCard);
}

/**
 * The chat list changes the checkboxes ask for, per account:
 * { <account>: { add: [{ jid, name }], remove: [jid] } }. d.chatList holds
 * "<account>\n<chat address>" -> wanted.
 */
function chatListChanges(ctx, d, name) {
  const lists = chatLists(ctx);
  const changes = {};
  if (!lists) {
    return changes;
  }
  for (const [key, want] of d.chatList) {
    const [account, jid] = key.split("\n");
    const has = lists[account];
    if (!has) {
      continue;
    }
    const change = (changes[account] ??= { add: [], remove: [] });
    if (want && !has(jid)) {
      change.add.push({ jid, name });
    } else if (!want && has(jid)) {
      change.remove.push(jid);
    }
  }
  return changes;
}

async function save(ctx, card, d) {
  const books = ctx.state.books;
  const bookName = (id) => books.find((b) => b.id === id)?.name ?? "";
  let entry = null;
  let name;
  if (!card) {
    const vCard = newContactVCard(d.model);
    name = cardModel(vCard).fn || "New contact";
    entry = await ctx.apply(`New contact: ${name}`, [{ type: "create", parentId: d.book, vCard, label: name }]);
    if (!entry) {
      return;
    }
    ctx.state.newContact = null;
    ctx.state.selected = entry.cards[0].id;
    await ctx.saveSettings({ newCardBook: d.book });
  } else {
    const vCard = modelToVCard(card.vCard, d.model);
    name = cardModel(vCard).fn || cardLabel(card);
    const changes = d.book !== card.parentId
      ? [{ type: "create", parentId: d.book, vCard: withoutUid(vCard), label: name }, { type: "delete", id: card.id, label: name }]
      : comparable(vCard) !== comparable(card.vCard) ? [{ type: "update", id: card.id, vCard, label: name, only: Boolean(d.only) }] : [];
    if (changes.length) {
      entry = await ctx.apply(changes.length === 2 ? `Moved ${name} to ${bookName(d.book)}` : `Edited ${name}`, changes);
      if (!entry) {
        return;
      }
      if (changes.length === 2) {
        ctx.state.selected = entry.cards[0].id;
      }
    }
    ctx.state.drafts.delete(card.id);
  }
  const lines = [];
  for (const [account, change] of Object.entries(chatListChanges(ctx, d, name))) {
    lines.push(await changeChatList(ctx, change, account));
  }
  if (lines.filter(Boolean).length) {
    ctx.toast(lines.filter(Boolean).join(" "));
  }
  ctx.render();
}

async function remove(ctx, card) {
  const name = cardLabel(card);
  const entry = await ctx.apply(`Deleted ${name}`, [{ type: "delete", id: card.id, label: name }]);
  if (entry) {
    ctx.state.drafts.delete(card.id);
    ctx.state.selected = null;
    ctx.render();
  }
}

/** The contact's linked copies (cards), when it has any. */
const linkedCopies = (ctx, card) => partnersOf(ctx.state.links, card.id).map((id) => ctx.state.allCards.find((c) => c.id === id)).filter(Boolean);

/**
 * Linked copies: where they are, "Save this copy only", Unlink, and (when
 * a copy was changed elsewhere, in Thunderbird or by a sync) an offer to
 * make the others match this one.
 */
function linkedNotice(ctx, card, d) {
  const copies = linkedCopies(ctx, card);
  if (!copies.length) {
    return null;
  }
  const where = copies.map((c) => c.bookName).join(", ");
  const differ = copies.filter((c) => !sameDetails(c.vCard, card.vCard));
  return h("div", { class: "notice" },
    `Linked with the copy in ${where}: saving changes ${copies.length > 1 ? "them" : "it"} too.`,
    differ.length
      ? h("div", {}, `The copy in ${differ.map((c) => c.bookName).join(", ")} differs (changed elsewhere, or by a sync). `,
        h("button", { class: "link", disabled: Boolean(ctx.state.busy), onClick: () => ctx.apply(`Copied ${cardLabel(card)} to its linked copies`, differ.map((c) => ({
          type: "update", id: c.id, vCard: followEdit(c.vCard, card.vCard), label: `${cardLabel(card)} (linked copy in ${c.bookName})`, only: true,
        }))) }, "Make it match this one"))
      : null,
    h("div", { class: "cp-line" },
      h("label", { class: "cp-check" }, h("input", { type: "checkbox", checked: Boolean(d.only), onChange: (e) => {
        d.only = e.target.checked;
      } }), "Save this copy only"),
      h("span", { class: "spacer" }),
      h("button", { class: "link", onClick: () => ctx.saveLinks(unlink(ctx.state.links, card.id)) }, "Unlink")));
}

/**
 * The editor for a contact (or, with card null, the new contact).
 * `before` goes above it (what the page proposes for this contact).
 */
export function contactPanel(ctx, card, { before = null } = {}) {
  const d = card ? draftFor(ctx, card) : ctx.state.newContact;
  if (!d) {
    return null;
  }
  const m = d.model;
  const id = (name) => `cp-${name}`;
  const refreshSave = () => {
    const button = document.getElementById("cp-save");
    if (button) {
      const dirty = isDirty(ctx, d, card);
      button.disabled = !dirty || Boolean(ctx.state.busy) || Boolean(card?.shadowed) || Boolean(card?.tb);
      button.textContent = dirty ? "Save" : "Saved";
    }
  };
  const touch = () => {
    d.touched = true;
    refreshSave();
  };
  // A structural change (a row added or removed): draw the panel again.
  const redraw = () => {
    d.touched = true;
    ctx.render();
  };
  const text = (key, attrs = {}) => h("input", { type: "text", id: id(key), value: m[key] ?? "", ...attrs, onInput: (e) => {
    m[key] = e.target.value;
    touch();
  } });
  const typeSelect = (item, types) => h("select", { class: "cp-type", "aria-label": "Type", onChange: (e) => {
    item.type = e.target.value;
    touch();
  } }, types.map(([value, shown]) => h("option", { value, selected: item.type === value }, shown)));
  const removeButton = (list, item) => h("button", { class: "cp-remove", title: "Remove", "aria-label": "Remove", onClick: () => {
    list.splice(list.indexOf(item), 1);
    redraw();
  } }, "×");
  const addButton = (text, onClick) => h("button", { class: "cp-add", onClick }, text);
  const dateRow = (key) => h("div", { class: "cp-date" },
    h("input", { type: "date", id: id(key), value: m[key] ?? "", onChange: (e) => {
      m[key] = e.target.value;
      touch();
    } }),
    h("label", { class: "cp-check" }, h("input", { type: "checkbox", checked: Boolean(m[`${key}NoYear`]), onChange: (e) => {
      m[`${key}NoYear`] = e.target.checked;
      touch();
    } }), "no year"));

  // Chat lists: one checkbox per XMPP account, shown when OMEMO for Thunderbird answers and can add people.
  const lists = chatLists(ctx);
  const accounts = chatAccounts(ctx);
  const canChatList = Boolean(lists && ctx.state.omemo.canAdd);
  const name = m.fn || [m.given, m.family].filter(Boolean).join(" ") || (card ? cardLabel(card) : "");
  const gateway = gatewayOf(ctx);
  const chatJids = new Set(m.chats.map((c) => bareChat(c.value)).filter(Boolean));
  const jmpChoices = [];
  for (const p of m.phones) {
    const e164 = phoneNumber(p.value);
    const address = e164 ? jmpAddress(e164, gateway) : null;
    if (address && !chatJids.has(address.toLowerCase()) && !jmpChoices.some((c) => c.address === address)) {
      jmpChoices.push({ number: p.value.trim(), address });
    }
  }
  const allLabels = [...new Set(ctx.state.cards.flatMap((c) => c.labels))].sort();
  const mine = new Set(m.categories.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  const books = writableBooks(ctx);
  const dirty = isDirty(ctx, d, card);

  return h("div", { class: "contact-panel" },
    card
      ? h("div", { class: "detail-head" }, avatar(card, true), h("div", { class: "who" }, h("div", { class: "name" }, cardLabel(card)), h("div", { class: "book" }, card.bookName)))
      : h("h3", {}, "New contact"),
    before,
    card?.shadowed
      ? h("div", { class: "notice warn" }, `This contact is also in ${card.shadowed}, with the same contact ID. Thunderbird only lets add-ons change one of the copies, the one in ${card.shadowed}, so this copy (in ${card.bookName}) can't be saved or deleted here. `,
        h("button", { class: "link", onClick: () => {
          ctx.setView("copies");
          ctx.select(`copies:${card.uid}`);
        } }, "Sort out the copies"))
      : null,
    // Daynizer: a contact in Thunderbird's own address books is read-only for now.
    card?.tb ? h("div", { class: "notice warn" }, THUNDERBIRD_READ_ONLY) : null,
    card && !card.shadowed ? linkedNotice(ctx, card, d) : null,
    card && d.touched && d.base !== card.vCard
      ? h("div", { class: "notice warn" }, "This contact changed (by a sync, or in its other editor) while you were editing it. Saving writes your changes over it. ",
        h("button", { class: "link", onClick: () => {
          ctx.state.drafts.delete(card.id);
          ctx.render();
        } }, "Discard my changes"))
      : null,

    h("label", { for: id("book") }, "Address book"),
    h("select", { id: id("book"), onChange: (e) => {
      d.book = e.target.value;
      touch();
    } }, books.map((b) => h("option", { value: b.id, selected: b.id === d.book }, b.name))),

    h("label", { for: id("fn") }, "Display name"),
    text("fn", { placeholder: [m.given, m.family].filter(Boolean).join(" ") || "From first and last name" }),
    h("div", { class: "detail-row" },
      h("div", {}, h("label", { for: id("given") }, "First name"), text("given")),
      h("div", {}, h("label", { for: id("family") }, "Last name"), text("family"))),
    h("label", { for: id("nickname") }, "Nickname"), text("nickname"),
    h("label", { for: id("org") }, "Organization"), text("org"),
    h("label", { for: id("title") }, "Title"), text("title"),
    h("label", { for: id("bday") }, "Birthday"), dateRow("bday"),
    h("label", { for: id("anniversary") }, "Anniversary"), dateRow("anniversary"),

    h("label", {}, "Phones"),
    m.phones.map((p, i) => h("div", { class: "cp-line" },
      typeSelect(p, PHONE_TYPES),
      h("input", { type: "text", id: id(`phone-${i}`), value: p.value, "aria-label": "Phone", onInput: (e) => {
        p.value = e.target.value;
        touch();
      }, onChange: () => ctx.render() }),
      removeButton(m.phones, p))),
    addButton("+ Add phone", () => {
      m.phones.push({ type: "cell", value: "" });
      redraw();
      document.getElementById(id(`phone-${m.phones.length - 1}`))?.focus();
    }),

    h("label", {}, "Emails"),
    m.emails.map((e, i) => h("div", { class: "cp-line" },
      typeSelect(e, EMAIL_TYPES),
      h("input", { type: "text", id: id(`email-${i}`), value: e.value, "aria-label": "Email", onInput: (ev) => {
        e.value = ev.target.value;
        touch();
      } }),
      removeButton(m.emails, e))),
    addButton("+ Add email", () => {
      m.emails.push({ type: "home", value: "" });
      redraw();
      document.getElementById(id(`email-${m.emails.length - 1}`))?.focus();
    }),

    h("label", {}, "Chat addresses"),
    m.chats.map((c, i) => {
      const jid = bareChat(c.value);
      return h("div", { class: "cp-chat" },
        h("div", { class: "cp-line" },
          h("input", { type: "text", id: id(`chat-${i}`), value: c.value, placeholder: "xmpp:name@example.org", "aria-label": "Chat address", onInput: (e) => {
            c.value = e.target.value;
            touch();
          }, onChange: () => ctx.render() }),
          removeButton(m.chats, c)),
        canChatList && jid
          ? h("div", { class: "cp-accounts" }, h("span", { class: "cp-hint" }, "In the chat list of:"),
            accounts.map((account) => {
              const key = `${account.jid}\n${jid}`;
              const on = d.chatList.has(key) ? d.chatList.get(key) : lists[account.jid](jid);
              return h("label", { class: "cp-check", title: `Thunderbird's chat list for ${account.jid}` }, h("input", { type: "checkbox", checked: on, onChange: (e) => {
                d.chatList.set(key, e.target.checked);
                touch();
              } }), accountLabel(account.jid));
            }))
          : null);
    }),
    jmpChoices.map((choice) => addButton(`+ JMP.chat address for ${choice.number}`, () => {
      m.chats.push({ value: `xmpp:${choice.address}` });
      redraw();
    })),
    addButton("+ Add chat address", () => {
      m.chats.push({ value: "" });
      redraw();
      document.getElementById(id(`chat-${m.chats.length - 1}`))?.focus();
    }),
    // Daynizer: the hint about Thunderbird's chat list only in the add-on, and its "get OMEMO" link only where Daynizer may offer it.
    m.chats.length && !canChatList && ctx.host.addon && (ctx.state.omemo.status?.installed || ctx.host.omemoPromo)
      ? h("p", { class: "cp-hint" }, ctx.state.omemo.status?.installed
        ? "To add people to Thunderbird's chat list from here, update OMEMO for Thunderbird and connect an XMPP account."
        : ["To add people to Thunderbird's chat list from here: ", h("button", { class: "link", onClick: () => openLink(LINKS.omemo) }, "get OMEMO for Thunderbird"), " (free)."])
      : null,

    h("label", {}, "Addresses"),
    m.addresses.map((a) => h("div", { class: "cp-address" },
      h("div", { class: "cp-line" }, typeSelect(a, ADDRESS_TYPES), h("span", { class: "spacer" }), removeButton(m.addresses, a)),
      ...[[2, "Street"], [3, "City"], [4, "State"], [5, "Postal code"], [6, "Country"]].map(([at, placeholder]) => h("input", {
        type: "text", value: a.parts[at] ?? "", placeholder, "aria-label": placeholder, class: `cp-adr-${at}`, onInput: (e) => {
          a.parts[at] = e.target.value;
          touch();
        },
      })))),
    addButton("+ Add address", () => {
      m.addresses.push({ type: "home", parts: ["", "", "", "", "", "", ""] });
      redraw();
    }),

    h("label", {}, "Websites"),
    m.urls.map((u, i) => h("div", { class: "cp-line" },
      h("input", { type: "text", id: id(`url-${i}`), value: u.value, "aria-label": "Website", onInput: (e) => {
        u.value = e.target.value;
        touch();
      } }),
      removeButton(m.urls, u))),
    addButton("+ Add website", () => {
      m.urls.push({ value: "" });
      redraw();
      document.getElementById(id(`url-${m.urls.length - 1}`))?.focus();
    }),

    h("label", { for: id("categories") }, "Labels (comma-separated)"),
    text("categories"),
    allLabels.filter((l) => !mine.has(l.toLowerCase())).length
      ? h("select", { "aria-label": "Add an existing label", onChange: (e) => {
        if (e.target.value) {
          m.categories = [...m.categories.split(",").map((s) => s.trim()).filter(Boolean), e.target.value].join(", ");
          redraw();
        }
      } }, h("option", { value: "" }, "+ Add existing label…"), allLabels.filter((l) => !mine.has(l.toLowerCase())).map((l) => h("option", { value: l }, l)))
      : null,

    h("label", { for: id("note") }, "Notes"),
    h("textarea", { id: id("note"), value: m.note, placeholder: "Add notes…", onInput: (e) => {
      m.note = e.target.value;
      touch();
    } }),

    h("div", { class: "detail-actions" },
      h("button", { class: "primary", id: "cp-save", disabled: !dirty || Boolean(ctx.state.busy) || Boolean(card?.shadowed) || Boolean(card?.tb), onClick: () => save(ctx, card, d) }, dirty ? "Save" : "Saved"),
      card
        ? h("button", { class: "danger", disabled: Boolean(ctx.state.busy) || Boolean(card.shadowed) || Boolean(card.tb), onClick: () => remove(ctx, card) }, "Delete")
        : h("button", { onClick: () => {
          ctx.state.newContact = null;
          ctx.render();
        } }, "Cancel")),
    card && d.touched && dirty
      ? h("div", { class: "detail-actions", style: { marginTop: "6px" } }, h("button", { class: "link", onClick: () => {
        ctx.state.drafts.delete(card.id);
        ctx.render();
      } }, "Undo my edits"))
      : null,
    card ? h("p", { class: "cp-hint" }, "Save and Delete can be undone (the message after, or Changes).") : null);
}
