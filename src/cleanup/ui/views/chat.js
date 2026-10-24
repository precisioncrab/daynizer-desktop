/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Chat addresses: the one Chat page, in two tabs.
 *   Contacts   every contact with a phone number or chat address (in the
 *              checked address books): their chat address, or the JMP.chat
 *              address their number makes, and whether they're in the chat
 *              list. Check them (or Select all) to add JMP.chat addresses to
 *              their cards or add them to the chat list; chat addresses
 *              Thunderbird can't use are fixed from here too. The selected
 *              contact's editor is in the right-hand panel.
 *   Chat list  Thunderbird's chat list, through OMEMO for Thunderbird: the
 *              names setting, and the chat contacts no card has, each with
 *              Add to a card and New card (the "Who is this?" page).
 * Everything here is free; only calls are in OMEMO for Thunderbird + Calls.
 *
 * Daynizer: the Chat list tab only shows in the Thunderbird add-on, once
 * OMEMO for Thunderbird answers (or, in the trial and free tier only, to
 * offer it: ctx.host.omemoPromo). The desktop app has the Contacts tab alone.
 */

import { h, plural } from "../dom.js";
import { toolbar, row, avatar, change, help, tag, emptyState, selectAll, matches, virtualList } from "../parts.js";
import { contactPanel } from "../contact-panel.js";
import { label } from "../../core/card.js";
import { addChatAddress, applyPrefixFixes, normalizeGateway, DEFAULT_GATEWAY } from "../../core/chat.js";
import { linkFor, linkToCard, newCardFor, chatRows } from "../../core/chat-list.js";
import { MODES, namesRow, omemoTier, STATUS_ORDER } from "../../lib/omemo.js";
import { refreshOmemo, refreshOmemoSoon, currentAccount, chatAccounts, chatLists, accountLabel, changeChatList } from "../omemo-state.js";
import { LINKS, openLink } from "../../lib/links.js";

export const CHAT_HELP = [
  ["Chat address on a card", "Saved with the contact, like an email address. It goes wherever the address book syncs (your CardDAV server, then your phone), where chat apps like Conversations and Cheogram can show the card's name and photo for it. On its own it doesn't put anyone on your chat list."],
  ["JMP.chat address", "A phone number at cheogram.com, like +15551234567@cheogram.com. With an XMPP account registered with JMP.chat (or another Cheogram gateway), texts and calls to it reach that phone number."],
  ["Chat list", "The people in Thunderbird's chat (Chat > Contacts) for one XMPP account: the contact list your XMPP server keeps for it, so your other chat apps on that account have the same list. Adding someone asks for their online status; JMP.chat numbers say yes by themselves."],
  ["Names from your address book", "A chat contact shows its address until it has a name. OMEMO for Thunderbird gives it the name of the card with that phone number (for a JMP.chat or Quicksy address) or that chat address. Thunderbird only: the names show in Thunderbird. Also on the server: your other chat apps show them too."],
];

const gatewayOf = (ctx) => normalizeGateway(ctx.state.settings.gateway) ?? DEFAULT_GATEWAY;

/** Whether the Chat list tab shows: in the add-on, once OMEMO for Thunderbird answers, or to offer it where Daynizer may. */
const chatListShown = (ctx) => ctx.host.addon && (omemoTier(ctx.state.omemo.status) !== "none" || ctx.host.omemoPromo);

/** The help entries that apply here (the chat list ones only with the Chat list tab). */
const chatHelp = (ctx) => (chatListShown(ctx) ? CHAT_HELP : CHAT_HELP.slice(0, 2));

/** A chat address as people read it: a JMP.chat or Quicksy address as its number. */
const shown = (jid) => {
  const link = linkFor(jid);
  return link.kind === "phone" ? link.text : jid;
};

/** Whether a chat contact matches the search box: its address or number. */
function jidMatches(jid, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) {
    return true;
  }
  const digits = q.replace(/\D/g, "");
  return jid.toLowerCase().includes(q) || (digits.length >= 3 && jid.replace(/\D/g, "").includes(digits));
}

async function setMode(ctx, jid, mode) {
  const omemo = ctx.state.omemo;
  omemo.loading = true;
  ctx.render();
  try {
    omemo.result = await ctx.omemo.setMode(jid, mode);
    omemo.error = null;
  } catch (e) {
    omemo.error = e?.message ?? String(e);
  }
  omemo.loading = false;
  ctx.render();
}

const unnamedOf = (account) => account.contacts.filter((c) => c.status === "unmatched" || c.status === "ambiguous");
const pendingOf = (account) => account.contacts.filter((c) => (c.status === "set" || c.status === "update") && !c.done);

/* ---------- Contacts tab ---------- */

const FILTERS = [
  ["all", "All"],
  ["none", "Without a chat address"],
  ["notInChat", "Not in the chat list"],
  ["fix", "Chat addresses to fix"],
];

// The rows for every card, made again only when the cards, the chat list, the gateway or the fixes change.
let rowsMemo = { inputs: [], rows: [] };

function allRows(ctx) {
  const inputs = [ctx.state.cards, ctx.state.omemo.result, gatewayOf(ctx), ctx.derived.prefix];
  if (inputs.some((x, i) => x !== rowsMemo.inputs[i])) {
    const fixIds = new Set(ctx.derived.prefix.map((p) => p.card.id));
    rowsMemo = { inputs, rows: chatRows(ctx.state.cards, { lists: chatLists(ctx), gateway: gatewayOf(ctx) }).map((r) => ({ ...r, fix: fixIds.has(r.card.id) })) };
  }
  return rowsMemo.rows;
}

function contactRows(ctx) {
  const filter = ctx.state.chat.filter;
  return allRows(ctx)
    .filter((r) => matches(r.card, ctx.state.search)
      && (filter === "all"
        || (filter === "none" && !r.addresses.length)
        || (filter === "notInChat" && r.inChat === false)
        || (filter === "fix" && r.fix)
        || (filter.startsWith("on:") && r.on.includes(filter.slice(3)))));
}

async function fixAll(ctx) {
  const rows = ctx.derived.prefix;
  await ctx.apply(`Chat address fixes: ${plural(rows.length, "card", "cards")}`,
    rows.map((p) => ({ type: "update", id: p.card.id, vCard: applyPrefixFixes(p.card.vCard, p.fixes), label: label(p.card) })));
}

/** Checked contacts without a chat address get their JMP.chat address on their card. */
async function addJmp(ctx, rows) {
  const todo = rows.filter((r) => !r.addresses.length && r.jmp);
  const entry = await ctx.apply(`JMP.chat addresses: ${plural(todo.length, "card", "cards")}`,
    todo.map((r) => ({ type: "update", id: r.card.id, vCard: addChatAddress(r.card.vCard, r.jmp), label: label(r.card) })),
    { generated: { added: todo.map((r) => [r.card.id, r.jmp]), removed: [] } });
  // The contacts stay checked, so Add to chat list can follow.
  if (entry) {
    ctx.render();
  }
}

/**
 * Checked contacts not on an account's chat list go on it; a card without a
 * chat address gets the JMP.chat address it's added with. They stay checked,
 * for another account.
 */
async function addToChatList(ctx, rows, account) {
  const todo = rows.filter((r) => r.inChat !== null && !r.on.includes(account) && r.address);
  const cards = todo.filter((r) => !r.addresses.length);
  const go = await ctx.confirm({
    title: `Add ${plural(todo.length, "person", "people")} to ${accountLabel(account)}'s chat list?`,
    body: [
      h("p", {}, `${todo.length === 1 ? `${label(todo[0].card)} goes` : "They go"} on the chat list of ${account}, with the ${todo.length === 1 ? "name from the card" : "names from their cards"}. That list is kept on your XMPP server, so your other chat apps on that account show them too.`),
      cards.length ? h("p", {}, `${plural(cards.length, "card has", "cards have")} no chat address yet, so ${cards.length === 1 ? "it gets" : "they get"} the JMP.chat address ${cards.length === 1 ? "it's" : "they're"} added with (Undo takes it off again).`) : null,
      h("p", {}, "Each one is asked to share their online status; JMP.chat numbers say yes by themselves. To take someone off later: uncheck In chat list in their editor, or right-click them in Thunderbird's chat list, Delete."),
    ],
    ok: todo.length === 1 ? `Add to ${accountLabel(account)}` : `Add ${todo.length} to ${accountLabel(account)}`,
  });
  if (!go) {
    return;
  }
  if (cards.length) {
    const entry = await ctx.apply(`JMP.chat addresses: ${plural(cards.length, "card", "cards")}`,
      cards.map((r) => ({ type: "update", id: r.card.id, vCard: addChatAddress(r.card.vCard, r.jmp), label: label(r.card) })),
      { generated: { added: cards.map((r) => [r.card.id, r.jmp]), removed: [] } });
    if (!entry) {
      return;
    }
  }
  ctx.state.busy = { text: "Adding to the chat list…" };
  ctx.render();
  const line = await changeChatList(ctx, { add: todo.map((r) => ({ jid: r.address, name: label(r.card) })) }, account);
  ctx.state.busy = null;
  ctx.render();
  ctx.toast(line);
}

function contactsTab(ctx) {
  const omemo = ctx.state.omemo;
  const tier = omemoTier(omemo.status);
  const rows = contactRows(ctx);
  const sel = ctx.state.chat.sel;
  const fixes = ctx.derived.prefix.length;
  const accounts = chatAccounts(ctx);
  const canChatList = Boolean(chatLists(ctx) && omemo.canAdd);
  return [
    fixes
      ? h("div", { class: "omemo-banner" },
        h("span", {}, `${plural(fixes, "contact has a chat address", "contacts have chat addresses")} that chat apps can't use as they are: no xmpp: in front, an old X-JABBER field, or turned into x-apple: by Google Contacts (Fix makes them xmpp: again and removes copies).`),
        h("button", { class: "small", onClick: () => {
          ctx.state.chat.filter = "fix";
          ctx.render();
        } }, "Show"),
        h("button", { class: "primary small", disabled: Boolean(ctx.state.busy), onClick: () => fixAll(ctx) }, `Fix ${fixes === 1 ? "it" : `all ${fixes}`}`))
      : null,
    tier === "none" && omemo.status && ctx.host.omemoPromo
      ? h("div", { class: "omemo-banner" },
        h("span", {}, "To see who's in Thunderbird's chat list, add people to it and chat end-to-end encrypted, add OMEMO for Thunderbird (free)."),
        h("button", { class: "primary small", onClick: () => openLink(LINKS.omemo) }, "Get OMEMO for Thunderbird"))
      : null,
    h("div", { class: "toolbar-filters" },
      h("label", {}, "Show",
        h("select", { onChange: (e) => {
          ctx.state.chat.filter = e.target.value;
          ctx.render();
        } }, [
          ...FILTERS.filter(([value]) => value !== "notInChat" || chatLists(ctx)),
          ...accounts.map((a) => [`on:${a.jid}`, `On ${accountLabel(a.jid)}'s chat list`]),
        ].map(([value, text]) => h("option", { value, selected: ctx.state.chat.filter === value }, text)))),
      h("label", {}, "JMP.chat gateway",
        h("input", {
          type: "text",
          id: "gateway",
          class: normalizeGateway(ctx.state.settings.gateway) ? "" : "invalid",
          style: { width: "130px" },
          value: ctx.state.settings.gateway,
          title: "JMP.chat's gateway is cheogram.com. Another Cheogram gateway's domain can go here.",
          onChange: (e) => ctx.saveSettings({ gateway: e.target.value.trim() || DEFAULT_GATEWAY }),
        })),
      h("span", { class: "right" }, selectAll("Select all", rows.map((r) => sel.has(r.card.id)), (value) => {
        for (const r of rows) {
          sel[value ? "add" : "delete"](r.card.id);
        }
        ctx.render();
      }))),
    virtualList("chat-contacts", rows, (r) => row(ctx, {
          key: r.card.id,
          muted: !r.addresses.length && !r.jmp,
          check: { checked: sel.has(r.card.id), disabled: Boolean(r.card.shadowed), title: r.card.shadowed ? `Thunderbird only lets add-ons change the copy in ${r.card.shadowed}. Sort them out under In several books.` : "Select", onChange: (value) => {
            sel[value ? "add" : "delete"](r.card.id);
            ctx.render();
          } },
          lead: avatar(r.card),
          title: label(r.card),
          meta: [
            r.addresses.length
              ? h("span", {}, r.addresses.join(", "))
              : r.jmp
                ? [change(r.number, r.jmp, false), tag("no chat address yet", "plain")]
                : h("span", {}, `${r.number}: no country code, so no JMP.chat address (see Phone numbers)`),
            r.fix ? tag("to fix", "warn") : null,
            r.card.shadowed ? tag(`also in ${r.card.shadowed}: can't change this copy`, "warn") : null,
            // The accounts whose chat list the person is on.
            r.on.map((account) => h("span", { class: "tag", title: `On the chat list of ${account}` }, accountLabel(account))),
          ],
        }), { empty: emptyState(ctx.state.search ? "Nothing matches the search." : "No contacts with a phone number or chat address here.", "") }),
    selectedBar(ctx, canChatList ? accounts : []),
  ];
}

/** Under the list while contacts are checked: what can be done with them (`accounts`: the chat lists they can be added to). */
function selectedBar(ctx, accounts) {
  const rows = contactRows(ctx).filter((r) => ctx.state.chat.sel.has(r.card.id) && !r.card.shadowed);
  if (!rows.length) {
    return null;
  }
  const jmp = rows.filter((r) => !r.addresses.length && r.jmp).length;
  const busy = Boolean(ctx.state.busy);
  return h("div", { class: "pending-bar", role: "status" },
    h("span", {}, `${plural(rows.length, "contact", "contacts")} checked.`),
    h("button", { disabled: busy, onClick: () => {
      ctx.state.chat.sel.clear();
      ctx.render();
    } }, "Clear"),
    h("button", { class: "primary", disabled: busy || !jmp, title: jmp ? "" : "Every checked contact has a chat address already", onClick: () => addJmp(ctx, rows) },
      jmp ? `Add JMP.chat address${jmp === 1 ? "" : `es (${jmp})`}` : "Add JMP.chat addresses"),
    // One button per account: "Add to alice", "Add to bob".
    accounts.map((account) => {
      const n = rows.filter((r) => !r.on.includes(account.jid) && r.address).length;
      return h("button", { class: "primary", disabled: busy || !n, title: n ? `Add to the chat list of ${account.jid}` : `Every checked contact is on ${account.jid}'s chat list already`, onClick: () => addToChatList(ctx, rows, account.jid) },
        `Add to ${accountLabel(account.jid)}${n > 1 ? ` (${n})` : ""}`);
    }));
}

/* ---------- Who is this? (Add to a card, New card) ---------- */

/** Opens "Who is this?" for a chat contact, with the cursor in the name box or the search box. */
function openPick(ctx, jid, focus = "pick-name", account = null) {
  ctx.state.chat.pick = { jid, name: "", search: "", account };
  ctx.state.selected = null;
  ctx.render();
  document.getElementById(focus)?.focus();
}

function closePick(ctx) {
  ctx.state.chat.pick = null;
  ctx.render();
}

const writableBooks = (ctx) => {
  const excluded = new Set(ctx.state.settings.excludedBooks);
  return ctx.state.books.filter((b) => !b.readOnly && !b.remote && !excluded.has(b.id));
};

async function createCard(ctx, jid, name, bookId) {
  const entry = await ctx.apply(`New card: ${name}`, [{ type: "create", parentId: bookId, vCard: newCardFor(jid, name), label: name }]);
  if (entry) {
    ctx.state.chat.pick = null;
    await ctx.saveSettings({ newCardBook: bookId });
    refreshOmemoSoon(ctx);
  }
}

async function addToCard(ctx, jid, card) {
  const vCard = linkToCard(card.vCard, jid);
  if (vCard === card.vCard) {
    ctx.toast(`${label(card)} has ${shown(jid)} already.`);
    return;
  }
  const entry = await ctx.apply(`Added ${shown(jid)} to ${label(card)}`, [{ type: "update", id: card.id, vCard, label: label(card) }]);
  if (entry) {
    ctx.state.chat.pick = null;
    ctx.render();
    refreshOmemoSoon(ctx);
  }
}

function pickPage(ctx) {
  const pick = ctx.state.chat.pick;
  const link = linkFor(pick.jid);
  const account = chatAccounts(ctx).find((a) => a.jid === pick.account) ?? currentAccount(ctx);
  const books = writableBooks(ctx);
  const bookId = books.some((b) => b.id === pick.book) ? pick.book
    : books.some((b) => b.id === ctx.state.settings.newCardBook) ? ctx.state.settings.newCardBook : books[0]?.id;
  const found = ctx.state.cards.filter((c) => matches(c, pick.search));
  const shownCards = found.slice(0, 50);
  const what = link.kind === "phone" ? "this number" : "this chat address";
  const create = () => {
    if (pick.name.trim() && bookId) {
      createCard(ctx, pick.jid, pick.name.trim(), bookId);
    }
  };
  return [
    h("div", { class: "toolbar" },
      h("button", { onClick: () => closePick(ctx) }, "‹ Back"),
      h("h2", { style: { flex: "1" } }, `Who is ${shown(pick.jid)}?`)),
    h("div", { class: "page", "data-scroll": "pick" },
      h("p", {}, link.kind === "phone"
        ? `Thunderbird's chat list shows ${pick.jid} because no card has the number ${link.text}. Make a card for this person, or add the number to their card (as a mobile number). The chat list then shows their name.`
        : `Thunderbird's chat list shows ${pick.jid} because no card has this chat address. Make a card for this person, or add the address to their card. The chat list then shows their name.`),
      account && account.mode === "off"
        ? h("div", { class: "notice warn" }, `Names are off for ${account.jid}. To see the name in Thunderbird, set "Names from your address book" on the Chat list tab.`)
        : null,

      h("div", { class: "page-section" },
        h("div", { class: "label" }, "New card"),
        h("div", { class: "pick-new" },
          h("input", { type: "text", id: "pick-name", value: pick.name, placeholder: "Their name", "aria-label": "Name", onInput: (e) => {
            pick.name = e.target.value;
            const button = document.getElementById("pick-create");
            if (button) {
              button.disabled = !pick.name.trim() || !bookId || Boolean(ctx.state.busy);
            }
          }, onKeydown: (e) => {
            if (e.key === "Enter") {
              create();
            }
          } }),
          books.length > 1
            ? h("select", { "aria-label": "Address book", onChange: (e) => {
              pick.book = e.target.value;
            } }, books.map((b) => h("option", { value: b.id, selected: b.id === bookId }, b.name)))
            : null,
          h("button", { class: "primary", id: "pick-create", disabled: !pick.name.trim() || !bookId || Boolean(ctx.state.busy), onClick: create }, "Create card")),
        h("p", { class: "hint" }, `The card gets the name and ${link.kind === "phone" ? `the mobile number ${link.text}` : `the chat address xmpp:${link.address}`}. Undo removes it again.`)),

      h("div", { class: "page-section" },
        h("div", { class: "label" }, "Or add it to a card you have"),
        h("input", { type: "search", id: "pick-search", class: "search-box", style: { maxWidth: "480px" }, value: pick.search, placeholder: "Search names, numbers, addresses", onInput: (e) => {
          pick.search = e.target.value;
          ctx.render();
        } }),
        h("div", { class: "chat-list" },
          shownCards.map((card) => row(ctx, {
            key: `pick:${card.id}`,
            lead: avatar(card),
            title: label(card),
            meta: [
              card.phones[0] ? h("span", {}, card.phones[0].value) : null,
              card.emails[0] ? h("span", {}, card.emails[0].address) : null,
              h("span", {}, card.bookName),
            ],
            actions: [h("button", { class: "small", disabled: Boolean(ctx.state.busy), onClick: () => addToCard(ctx, pick.jid, card) }, `Add ${what}`)],
          })),
          found.length > shownCards.length ? h("p", { class: "hint", style: { padding: "8px 16px" } }, `${found.length - shownCards.length} more: search to narrow it down.`) : null,
          found.length === 0 ? h("p", { class: "hint", style: { padding: "8px 16px" } }, "No card matches.") : null))),
  ];
}

/* ---------- Chat list tab ---------- */

function notInstalled(ctx) {
  return [
    h("p", {}, "Thunderbird's chat list shows a contact's address, like +15551234567@cheogram.com, until it has a name. With OMEMO for Thunderbird (free), this tab names your XMPP chat contacts from your address book, and lets you put the ones it can't name on a card. It also encrypts your chats end to end with OMEMO, the encryption Conversations, Cheogram, Monal and Gajim use."),
    h("p", {}, "It isn't on addons.thunderbird.net: it needs access to Thunderbird's chat, which add-ons listed there can't have. It's free and open source (MPL-2.0), installed from its own page."),
    h("div", { class: "detail-actions", style: { maxWidth: "460px" } },
      h("button", { class: "primary", onClick: () => openLink(LINKS.omemo) }, "Get OMEMO for Thunderbird"),
      h("button", { onClick: () => refreshOmemo(ctx) }, "Check again")),
    h("div", { class: "notice" }, "Installed already? It needs to be turned on in Add-ons and Themes, and recent enough to answer Daynizer."),
  ];
}

function accountBox(ctx, account) {
  const pending = pendingOf(account);
  const what = MODES.find(([value]) => value === account.mode)?.[2] ?? "";
  return h("div", { class: "account-card" },
    h("div", { class: "row-line" },
      h("span", { class: "jid" }, account.jid),
      h("label", { class: "choice" }, "Names from your address book",
        h("select", {
          id: `names-mode-${accountLabel(account.jid)}`,
          disabled: ctx.state.omemo.loading,
          onChange: (e) => setMode(ctx, account.jid, e.target.value),
        }, MODES.map(([value, text]) => h("option", { value, selected: account.mode === value }, text))))),
    h("p", { class: "summary" }, what),
    pending.length
      ? h("div", { class: "account-actions" },
        h("span", { class: "summary", style: { margin: "0", alignSelf: "center" } }, account.mode === "off"
          ? `${plural(pending.length, "chat contact would get its name", "chat contacts would get their names")} with names on.`
          : `${plural(pending.length, "chat contact is", "chat contacts are")} waiting for ${pending.length === 1 ? "its name" : "their names"}.`),
        account.mode !== "off"
          ? h("button", { class: "primary small", disabled: ctx.state.omemo.loading, onClick: () => setMode(ctx, account.jid, account.mode) }, pending.length === 1 ? "Name it now" : `Name all ${pending.length} now`)
          : null)
      : null);
}

function unnamedSection(ctx, account) {
  const rows = unnamedOf(account).filter((c) => jidMatches(c.jid, ctx.state.search)).sort((a, b) => a.jid.localeCompare(b.jid));
  return [
    h("div", { class: "list-heading" }, `No name yet: ${rows.length}`),
    rows.length === 0
      ? h("p", { class: "hint" }, ctx.state.search ? "None match the search." : "Every chat contact on this account is in your address book.")
      : [
        h("p", { class: "hint" }, "These chat contacts aren't in your address book, so they show as an address. Add each one to the person's card, or make a new card."),
        h("div", { class: "chat-list" }, rows.map((c) => row(ctx, {
          key: `jid:${account.jid}|${c.jid}`,
          lead: h("div", { class: "avatar", style: { background: "var(--border-alt)" }, "aria-hidden": "true" }, "?"),
          title: shown(c.jid),
          meta: [
            shown(c.jid) !== c.jid ? h("span", {}, c.jid) : null,
            c.status === "ambiguous"
              ? h("span", {}, `cards with different names: ${(c.names ?? []).join(", ")}`)
              : h("span", {}, "not in your address book"),
          ],
          actions: c.status === "ambiguous"
            ? [h("button", { class: "small", title: "Cards with different names have this number or address. Merge them, or take it off the wrong card.", onClick: () => {
              ctx.state.search = linkFor(c.jid).kind === "phone" ? linkFor(c.jid).e164 : c.jid;
              ctx.setView("duplicates");
            } }, "Show the cards")]
            : [
              h("button", { class: "small primary", disabled: Boolean(ctx.state.busy), onClick: () => openPick(ctx, c.jid, "pick-search", account.jid) }, "Add to a card"),
              h("button", { class: "small", disabled: Boolean(ctx.state.busy), onClick: () => openPick(ctx, c.jid, "pick-name", account.jid) }, "New card"),
            ],
        }))),
      ],
  ];
}

function namedSection(ctx, account) {
  const rows = account.contacts
    .filter((c) => c.status !== "unmatched" && c.status !== "ambiguous" && jidMatches(c.jid, ctx.state.search))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.jid.localeCompare(b.jid));
  if (!rows.length) {
    return null;
  }
  const open = (ctx.state.chat.namedOpenBy ??= {});
  return h("details", { class: "chat-details", open: Boolean(ctx.state.search) || Boolean(open[account.jid]), onToggle: (e) => {
    open[account.jid] = e.target.open;
  } },
  h("summary", { class: "list-heading" }, `In your address book: ${rows.length}`),
  // The contact's name first (as Thunderbird's chat list shows it), then its number or address.
  h("div", { class: "chat-list" }, rows.map((c) => row(ctx, {
    key: `jid:${account.jid}|${c.jid}`,
    title: c.name || c.current || shown(c.jid),
    meta: [
      h("span", {}, shown(c.jid)),
      shown(c.jid) !== c.jid ? h("span", {}, c.jid) : null,
      c.status === "named" ? null : h("span", {}, namesRow(c, account.mode)),
    ],
  }))));
}

function chatListTab(ctx) {
  const omemo = ctx.state.omemo;
  const tier = omemoTier(omemo.status);
  const accounts = chatAccounts(ctx);
  let body;
  if (!omemo.status || (omemo.loading && !omemo.result && tier !== "none")) {
    body = h("p", {}, "Asking OMEMO for Thunderbird…");
  } else if (tier === "none") {
    body = notInstalled(ctx);
  } else if (!accounts.length) {
    body = h("div", { class: "notice" }, omemo.error
      ? `OMEMO for Thunderbird answered with an error: ${omemo.error}`
      : "No XMPP account is connected right now. Connect one in Thunderbird's chat, then Refresh.");
  } else {
    // One group per XMPP account: its names setting, the chat contacts with no name yet, the named ones.
    body = [
      omemo.error ? h("div", { class: "notice warn" }, `OMEMO for Thunderbird answered with an error: ${omemo.error}`) : null,
      accounts.map((account) => h("section", { class: "account-group" },
        h("h3", { class: "account-heading" }, `${accountLabel(account.jid)}`, h("span", {}, ` ${account.jid} \u00b7 ${plural(account.contacts.length, "chat contact", "chat contacts")}`)),
        accountBox(ctx, account),
        unnamedSection(ctx, account),
        namedSection(ctx, account))),
    ];
  }
  return h("div", { class: "page", "data-scroll": "page" }, body);
}

/* ---------- The page ---------- */

export default {
  id: "chat",
  title: "Chat addresses",
  dot: "#20a39e",

  // The chat addresses to fix, and the chat contacts that need a card.
  count: (ctx) => ctx.derived.prefix.length + chatAccounts(ctx).reduce((n, a) => n + unnamedOf(a).length, 0) || null,

  // Asks OMEMO afresh each time the page is shown, so it never shows an old answer.
  onShow(ctx) {
    if (!ctx.state.omemo.loading) {
      refreshOmemo(ctx);
    }
  },

  onCardsChanged(ctx) {
    refreshOmemoSoon(ctx);
  },

  main(ctx) {
    if (ctx.state.chat.pick) {
      return pickPage(ctx);
    }
    const omemo = ctx.state.omemo;
    const tier = omemoTier(omemo.status);
    const tabs = chatListShown(ctx);
    const onList = tabs && ctx.state.chat.tab === "list";
    const unnamed = chatAccounts(ctx).reduce((n, a) => n + unnamedOf(a).length, 0);
    return [
      toolbar(ctx, {
        title: "Chat addresses",
        extra: [
          tier !== "none" ? h("button", { disabled: omemo.loading, onClick: () => refreshOmemo(ctx) }, omemo.loading ? "Checking…" : "Refresh") : null,
        ],
      }),
      tabs && h("div", { class: "view-tabs" },
        h("button", { class: onList ? "" : "active", onClick: () => {
          ctx.state.chat.tab = "contacts";
          ctx.state.selected = null;
          ctx.render();
        } }, "Contacts"),
        h("button", { class: onList ? "active" : "", onClick: () => {
          ctx.state.chat.tab = "list";
          ctx.state.selected = null;
          ctx.render();
        } }, `Chat list${unnamed ? ` (${unnamed} without a name)` : ""}`)),
      onList ? chatListTab(ctx) : contactsTab(ctx),
    ];
  },

  detail(ctx) {
    const helpBox = help("What these mean", chatHelp(ctx));
    if (ctx.state.chat.pick) {
      return [
        h("h3", {}, "Who is this?"),
        h("p", {}, "Type a name and Create card, or find the person's card and add the number (or chat address) to it."),
        h("p", {}, "Once a card has it, OMEMO for Thunderbird gives the chat contact that card's name within a few seconds (when names are on for the account)."),
        h("p", {}, "Undo (the message after, or Changes) takes it back."),
      ];
    }
    const selected = String(ctx.state.selected ?? "");
    if (chatListShown(ctx) && ctx.state.chat.tab === "list") {
      const [accountJid, contactJid] = selected.startsWith("jid:") ? selected.slice(4).split("|") : [];
      const account = chatAccounts(ctx).find((a) => a.jid === accountJid);
      const contact = account?.contacts.find((c) => c.jid === contactJid);
      if (contact) {
        return [
          h("h3", {}, shown(contact.jid)),
          h("p", {}, contact.jid),
          h("p", {}, `On the chat list of ${account.jid}.`),
          h("p", {}, namesRow(contact, account.mode)),
          contact.status === "unmatched"
            ? h("div", { class: "detail-actions" },
              h("button", { class: "primary", onClick: () => openPick(ctx, contact.jid, "pick-search", account.jid) }, "Add to a card"),
              h("button", { onClick: () => openPick(ctx, contact.jid, "pick-name", account.jid) }, "New card"))
            : null,
          helpBox,
        ];
      }
      return [
        h("h3", {}, "Chat list"),
        h("p", {}, "Thunderbird's chat list, one group per XMPP account, through OMEMO for Thunderbird. Chat contacts get their names from your cards; the ones no card has are listed under No name yet, each with Add to a card and New card. Someone on two accounts shows in both groups."),
        helpBox,
      ];
    }
    const card = ctx.state.cards.find((c) => c.id === selected);
    if (card) {
      return contactPanel(ctx, card);
    }
    if (!chatLists(ctx)) {
      return [
        h("h3", {}, "Chat addresses"),
        h("p", {}, "Every contact with a phone number or a chat address. Check some (or Select all), then Add JMP.chat addresses to put the JMP.chat address their number makes on their cards."),
        h("p", {}, "Select a contact to see and change everything on it."),
        helpBox,
      ];
    }
    return [
      h("h3", {}, "Chat addresses"),
      h("p", {}, "Every contact with a phone number or a chat address, with the accounts whose chat list they're on (alice, bob, ...). Check some (or Select all), then Add JMP.chat addresses to put the JMP.chat address their number makes on their cards, or Add to <account> to put them on that account's chat list. Show picks one account's people."),
      h("p", {}, "Select a contact to see and change everything on it. Each chat address has a checkbox per account: checked means it's on that account's chat list."),
      helpBox,
    ];
  },
};
