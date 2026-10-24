/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Chat page's address book side, for one chat account's contact list
 * (the chat contacts OMEMO for Thunderbird reports):
 *   - a chat contact the address book can't name gets onto a card, so
 *     OMEMO can name it: its phone number for a JMP.chat or Quicksy
 *     address (OMEMO matches those by number only), else its chat address;
 *   - the cards that aren't in the chat list yet, for Add to chat (OMEMO
 *     Pro).
 * Matching follows OMEMO for Thunderbird's own (its src/contacts/cards.js).
 */

import { parseVCard, serializeVCard, getAll, makeProp, insertProp, escapeText, unescapeText } from "./vcard.js";
import { XMPP_PARAMS } from "./card.js";
import { phoneNumber, writeNumber } from "./phone.js";
import { jmpAddress, phoneChoices, hasChatAddress, DEFAULT_GATEWAY } from "./chat.js";

/** The phone number a chat address stands for ("+15551234567@cheogram.com" -> "+15551234567"), or null. */
export function phoneOfChatAddress(jid) {
  const text = String(jid ?? "");
  const node = text.split("@")[0];
  return text.includes("@") && /^\+\d{7,15}$/.test(node) ? node : null;
}

/**
 * What a card needs for OMEMO to name this chat contact:
 * { kind: "phone", e164, text } or { kind: "chat", address, text }.
 */
export function linkFor(jid) {
  const phone = phoneOfChatAddress(jid);
  if (phone) {
    return { kind: "phone", e164: phone, text: writeNumber(phone) };
  }
  const address = String(jid).trim().toLowerCase();
  return { kind: "chat", address, text: `xmpp:${address}` };
}

/** The vCard with what names this chat contact added: a mobile number, or a chat address. Unchanged when the card has it. */
export function linkToCard(vCard, jid) {
  const vcard = parseVCard(vCard);
  const link = linkFor(jid);
  if (link.kind === "phone") {
    if (!getAll(vcard, "TEL").some((p) => phoneNumber(unescapeText(p.value)) === link.e164)) {
      insertProp(vcard, makeProp("TEL", link.text, [{ key: "TYPE", value: "cell" }]), "N");
    }
  } else if (!hasChatAddress(vcard, link.address)) {
    insertProp(vcard, makeProp("IMPP", link.text, XMPP_PARAMS), "EMAIL");
  }
  return serializeVCard(vcard);
}

/** First and last name from a typed name: the last word is the last name ("Patricia Ann Roe" -> "Patricia Ann", "Roe"). */
export function splitName(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return words.length > 1 ? { given: words.slice(0, -1).join(" "), family: words.at(-1) } : { given: words[0] ?? "", family: "" };
}

/** A new card for a chat contact: the name typed, and what names the contact. */
export function newCardFor(jid, name) {
  const { given, family } = splitName(name);
  const lines = [
    "BEGIN:VCARD",
    "VERSION:4.0",
    `FN:${escapeText(name.trim())}`,
    `N:${escapeText(family)};${escapeText(given)};;;`,
    "END:VCARD",
  ];
  return linkToCard(`${lines.join("\r\n")}\r\n`, jid);
}

/**
 * The Chat addresses page's rows: every card with a phone number or a chat
 * address, as [{ card, addresses, jmp, number, address, on, inChat }].
 *   addresses  the card's own chat addresses
 *   jmp        the JMP.chat address its first number (mobile first) makes, at the gateway
 *   number     that number as written
 *   address    the one to add to a chat list: its own (a plain one before a
 *              phone number one), else the JMP.chat address
 *   on         the accounts whose chat list the card is on (one of its
 *              addresses is there, or a JMP.chat or Quicksy contact has one of
 *              its numbers)
 *   inChat     whether it's on any of them; null when there's no chat list to ask
 * `lists` is { <account>: has(jid) } (chatLists in src/ui/omemo-state.js);
 * `has` alone is one list.
 */
export function chatRows(cards, { lists = null, has = null, gateway = DEFAULT_GATEWAY } = {}) {
  const tests = lists ?? (has ? { "": has } : null);
  const rows = [];
  for (const card of cards) {
    // Every chat address the card has, however it's written (a Google x-apple: one too), so none is added twice.
    const addresses = [...new Set(card.chat.map((c) => c.address))];
    const choice = phoneChoices(card)[0];
    if (!addresses.length && !card.phones.length) {
      continue;
    }
    const jmp = choice ? jmpAddress(choice.e164, gateway) : null;
    const on = tests
      ? Object.entries(tests).filter(([, test]) => addresses.some((a) => test(a)) || card.phones.some((p) => p.e164 && test(jmpAddress(p.e164, gateway)))).map(([account]) => account)
      : [];
    rows.push({
      card,
      addresses,
      jmp,
      number: choice?.value ?? card.phones[0]?.value ?? "",
      address: addresses.find((a) => !phoneOfChatAddress(a)) ?? addresses[0] ?? jmp,
      on,
      inChat: tests ? on.length > 0 : null,
    });
  }
  return rows;
}
