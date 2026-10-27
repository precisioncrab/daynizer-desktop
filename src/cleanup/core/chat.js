/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Chat addresses on cards.
 *
 * Always written as IMPP:xmpp:user@host. Thunderbird's own card editor
 * refuses a chat address without its "xmpp:" (the field turns red and Save
 * is blocked), so addresses without it, and older apps' X-JABBER lines,
 * are offered a fix.
 *
 * A JMP.chat address is a phone number at a Cheogram gateway
 * (xmpp:+15551234567@cheogram.com): an XMPP account registered with
 * JMP.chat texts and calls that number through it. This add-on only ever
 * removes a chat address it wrote itself (`generated`, per card id).
 */

import { parseVCard, serializeVCard, getAll, setValue, makeProp, insertProp, removeProp, unescapeText } from "./vcard.js";
import { xmppAddress, chatAddressOf, XMPP_PARAMS } from "./card.js";

export const DEFAULT_GATEWAY = "cheogram.com";

/** A gateway domain as typed ("@Cheogram.com ", "xmpp:cheogram.com"), or null when it isn't one. */
export function normalizeGateway(text) {
  const domain = String(text ?? "").trim().toLowerCase().replace(/^xmpp:/, "").replace(/^@/, "").replace(/\/.*$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

/** "+15551234567" at a gateway: "+15551234567@cheogram.com". */
export const jmpAddress = (e164, gateway = DEFAULT_GATEWAY) => `${e164}@${gateway}`;

/** The card's numbers that can be turned into a JMP.chat address, mobile numbers first, each number once. */
export function phoneChoices(card) {
  const seen = new Set();
  const choices = [];
  for (const phone of [...card.phones.filter((p) => p.mobile), ...card.phones.filter((p) => !p.mobile)]) {
    if (phone.e164 && !seen.has(phone.e164)) {
      seen.add(phone.e164);
      choices.push({ value: phone.value, e164: phone.e164, mobile: phone.mobile });
    }
  }
  return choices;
}

/**
 * Where a phone contact stands:
 *   state     "none" (no chat address), "ours" (a JMP.chat address this
 *             add-on wrote), "theirs" (chat addresses from elsewhere only),
 *             "no-phone" (no number with a known country)
 *   choices   phoneChoices()
 *   addresses the card's chat addresses (any kind)
 *   ours      the addresses this add-on wrote that are still on the card
 */
export function chatState(card, generated = []) {
  const choices = phoneChoices(card);
  const addresses = [...new Set(card.chat.map((c) => c.address))];
  const xmpp = new Set(card.chat.filter((c) => c.kind === "xmpp").map((c) => c.address));
  const ours = generated.filter((a) => xmpp.has(a));
  let state;
  if (ours.length) {
    state = "ours";
  } else if (addresses.length) {
    state = "theirs";
  } else {
    state = choices.length ? "none" : "no-phone";
  }
  return { state, choices, addresses, ours };
}

/** Whether the vCard has this chat address, written any way (xmpp:, x-apple:, bare, X-JABBER). */
export function hasChatAddress(vcard, address) {
  const wanted = String(address).toLowerCase();
  return [...getAll(vcard, "IMPP"), ...getAll(vcard, "X-JABBER")].some((p) => chatAddressOf(unescapeText(p.value)) === wanted);
}

/** The vCard with IMPP;X-SERVICE-TYPE=Jabber:xmpp:<address> added, unless it has the address already. */
export function addChatAddress(vCard, address) {
  const vcard = parseVCard(vCard);
  if (!hasChatAddress(vcard, address)) {
    insertProp(vcard, makeProp("IMPP", `xmpp:${address}`, XMPP_PARAMS), "EMAIL");
  }
  return serializeVCard(vcard);
}

/** The vCard without the IMPP lines for this address. */
export function removeChatAddress(vCard, address) {
  const vcard = parseVCard(vCard);
  for (const prop of getAll(vcard, "IMPP")) {
    if (xmppAddress(unescapeText(prop.value)) === address.toLowerCase()) {
      removeProp(vcard, prop);
    }
  }
  return serializeVCard(vcard);
}

/**
 * Chat addresses Thunderbird can't use as they are: [{ kind, address, text, copies }].
 * "noscheme": an IMPP address without "xmpp:", which gets it.
 * "x-jabber": an X-JABBER line with no matching IMPP, which gets one (the
 *   X-JABBER line stays, for the apps that read it).
 * "x-apple": Google's rewrite of a chat address it didn't know as XMPP
 *   (`copies` of them, from adding it again): the first becomes xmpp: again
 *   and the other copies go; all go when the card has it as xmpp: already.
 */
export function prefixFixes(card) {
  const xmpp = new Set(card.chat.filter((c) => c.kind === "xmpp").map((c) => c.address));
  const fixes = [];
  const seen = new Set();
  for (const chat of card.chat) {
    if (chat.kind === "xmpp" || seen.has(chat.address) || (chat.kind !== "x-apple" && xmpp.has(chat.address))) {
      continue;
    }
    seen.add(chat.address);
    const copies = card.chat.filter((c) => c.kind === chat.kind && c.address === chat.address).length;
    fixes.push({ kind: chat.kind, address: chat.address, text: unescapeText(chat.prop.value).trim(), copies, hasXmpp: xmpp.has(chat.address) });
  }
  return fixes;
}

/** Removes a line, and the lines of its vCard group (Google's ITEMn.X-ABLABEL) when nothing else uses the group. */
function removeWithGroup(vcard, prop) {
  removeProp(vcard, prop);
  const group = prop.group.toLowerCase();
  if (group && !vcard.props.some((p) => p.group.toLowerCase() === group && p.name !== "X-ABLABEL")) {
    vcard.props.filter((p) => p.group.toLowerCase() === group).forEach((p) => removeProp(vcard, p));
  }
}

/** The vCard with the given prefix fixes made. */
export function applyPrefixFixes(vCard, fixes) {
  const vcard = parseVCard(vCard);
  for (const fix of fixes) {
    if (fix.kind === "noscheme") {
      const prop = getAll(vcard, "IMPP").find((p) => unescapeText(p.value).trim().toLowerCase() === fix.address);
      if (prop) {
        setValue(prop, `xmpp:${fix.address}`);
      }
    } else if (fix.kind === "x-jabber" && !getAll(vcard, "IMPP").some((p) => xmppAddress(unescapeText(p.value)) === fix.address)) {
      insertProp(vcard, makeProp("IMPP", `xmpp:${fix.address}`, XMPP_PARAMS), "X-JABBER");
    } else if (fix.kind === "x-apple") {
      const apple = getAll(vcard, "IMPP").filter((p) => /^x-apple:/i.test(unescapeText(p.value).trim()) && chatAddressOf(unescapeText(p.value)) === fix.address);
      const keep = getAll(vcard, "IMPP").some((p) => xmppAddress(unescapeText(p.value)) === fix.address) ? null : apple[0];
      if (keep) {
        // The first copy becomes xmpp: in its own place and group, marked as Jabber.
        const params = [...keep.params.filter((p) => p.key !== "X-SERVICE-TYPE"), ...XMPP_PARAMS];
        const fixed = makeProp("IMPP", `xmpp:${fix.address}`, params, keep.group);
        vcard.props.splice(vcard.props.indexOf(keep), 1, fixed);
      }
      apple.filter((p) => p !== keep).forEach((p) => removeWithGroup(vcard, p));
    }
  }
  return serializeVCard(vcard);
}
