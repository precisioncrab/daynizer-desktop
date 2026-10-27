/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What OMEMO for Thunderbird says, shared by the Chat addresses page and
 * the contact editor: whether it's there, each account's chat list, and
 * whether it can add people to the chat list (OMEMO for Thunderbird 0.1.6,
 * the calls version 0.3.4 and later). Kept in ctx.state.omemo.
 */

import { phoneOfChatAddress } from "../core/chat-list.js";

const message = (e) => e?.message ?? String(e);
let refreshTimer = null;

/** Asks OMEMO for Thunderbird whether it's there, for the chat list, and whether it adds contacts. */
export async function refreshOmemo(ctx) {
  const omemo = ctx.state.omemo;
  omemo.loading = true;
  omemo.error = null;
  ctx.render();
  const status = await ctx.omemo.status();
  omemo.status = status;
  omemo.result = null;
  omemo.canAdd = false;
  if (status.installed) {
    try {
      omemo.result = await ctx.omemo.preview();
    } catch (e) {
      omemo.error = message(e);
    }
    omemo.canAdd = await ctx.omemo.canAddContacts();
  }
  omemo.loading = false;
  ctx.render();
}

/** Asks again in a moment: OMEMO names chat contacts 3 seconds after a card changes, and a new chat contact arrives from the server. */
export function refreshOmemoSoon(ctx, wait = 4000) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (!ctx.state.omemo.loading && ctx.state.omemo.status?.installed) {
      refreshOmemo(ctx);
    }
  }, wait);
}

/** Every connected XMPP account OMEMO for Thunderbird reports, with its chat list: [{ jid, mode, contacts }]. */
export const chatAccounts = (ctx) => ctx.state.omemo.result?.accounts ?? [];

/** An account as the page names it: the part before the @ ("alice" for alice@example.org). */
export const accountLabel = (jid) => String(jid ?? "").split("@")[0];

/** The first account (for the places that need one when there's a choice to make later). */
export function currentAccount(ctx) {
  const accounts = chatAccounts(ctx);
  return accounts.find((a) => a.jid === ctx.state.chat.account) ?? accounts[0] ?? null;
}

let listsMemo = { result: null, lists: null };

/**
 * Each account's chat list as a test: { <account jid>: has(address) }, where
 * a JMP.chat or Quicksy address counts by its number; null without OMEMO.
 */
export function chatLists(ctx) {
  const result = ctx.state.omemo.result;
  if (!result?.accounts?.length) {
    return null;
  }
  if (listsMemo.result !== result) {
    const lists = {};
    for (const account of result.accounts) {
      const jids = new Set(account.contacts.map((c) => c.jid.toLowerCase()));
      const phones = new Set(account.contacts.map((c) => phoneOfChatAddress(c.jid)).filter(Boolean));
      lists[account.jid] = (address) => {
        const jid = String(address ?? "").toLowerCase();
        return jids.has(jid) || phones.has(phoneOfChatAddress(jid));
      };
    }
    listsMemo = { result, lists };
  }
  return listsMemo.lists;
}

/** Whether a chat address is in a chat list: one account's, or (without `account`) any; null without OMEMO. */
export function chatListHas(ctx, account = null) {
  const lists = chatLists(ctx);
  if (!lists) {
    return null;
  }
  if (account) {
    return lists[account] ?? (() => false);
  }
  return (address) => Object.values(lists).some((has) => has(address));
}

/**
 * Adds and takes off chat list contacts on one account:
 * add [{ jid, name }], remove [jid]. Returns a line saying what happened.
 */
export async function changeChatList(ctx, { add = [], remove = [] }, account = currentAccount(ctx)?.jid) {
  if (!account || (!add.length && !remove.length)) {
    return "";
  }
  const lines = [];
  const failed = [];
  try {
    if (add.length) {
      const result = await ctx.omemo.addContacts(account, add);
      if (result?.added?.length) {
        lines.push(`Added ${result.added.length} to ${accountLabel(account)}'s chat list`);
      }
      failed.push(...(result?.failed ?? []));
    }
    if (remove.length) {
      const result = await ctx.omemo.removeContacts(account, remove);
      if (result?.removed?.length) {
        lines.push(`Took ${result.removed.length} off ${accountLabel(account)}'s chat list`);
      }
      failed.push(...(result?.failed ?? []));
    }
  } catch (e) {
    failed.push({ jid: "", error: message(e) });
  }
  refreshOmemoSoon(ctx, 2000);
  if (failed.length) {
    lines.push(`Couldn't change on ${account}: ${failed.map((f) => (f.jid ? `${f.jid} (${f.error})` : f.error)).join(", ")}`);
  }
  return `${lines.join(". ")}.`;
}
