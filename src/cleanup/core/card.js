/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What one address book card holds, read from its vCard: names, phone
 * numbers, email and chat addresses. Every feature works from this.
 */

import { parseVCard, getAll, first, typesOf, unescapeText, splitStructured } from "./vcard.js";
import { phoneNumber, phoneKey } from "./phone.js";

const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Names that are only a number or an address are no names. */
export const isRealName = (name) => /\p{L}/u.test(name) && !/^[^@\s]+@[^@\s]+$/.test(name.trim());

/**
 * The parameter a chat address line carries so Google Contacts and iCloud
 * keep it as XMPP: written without it, Google stores the address as an
 * "Other" service and sends it back as x-apple:, which Thunderbird and
 * OMEMO for Thunderbird can't use.
 */
export const XMPP_PARAMS = [{ key: "X-SERVICE-TYPE", value: "Jabber" }];

/**
 * The address in a chat address line, whatever it's written as: "xmpp:a@b",
 * Google's "x-apple:a@b", or a bare "a@b"; null for anything else.
 */
export function chatAddressOf(value) {
  const text = String(value ?? "").trim();
  const apple = /^x-apple:(.+)$/i.exec(text);
  if (apple) {
    return bareAddress(apple[1]);
  }
  return xmppAddress(text) ?? (/^[a-z][a-z0-9+.-]*:/i.test(text) ? null : bareAddress(text));
}

/** "xmpp:alice@example.org?message" -> "alice@example.org"; else null. */
export function xmppAddress(value) {
  const match = /^xmpp:(?:\/\/[^/]*\/)?([^?#]+)/i.exec(String(value ?? "").trim());
  return match ? bareAddress(decodeSafe(match[1])) : null;
}

function decodeSafe(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A lowercase bare address (no resource), or null when it isn't one. */
export function bareAddress(value) {
  const address = String(value ?? "").trim().replace(/^mailto:/i, "").split("/")[0].toLowerCase();
  return /^[^@\s:]+@[^@\s:]+\.[^@\s:]+$/.test(address) ? address : null;
}

/** Whether a TEL property is a mobile number (cell, mobile, iPhone). */
export const isMobile = (prop) => typesOf(prop).some((t) => t === "cell" || t === "mobile" || t === "iphone" || t === "x-mobile");

/**
 * A card from a ContactNode ({ id, parentId, vCard, readOnly }) and its
 * address book's name:
 *   name        the display name (FN), unescaped, "" when missing
 *   nameParts   { family, given, additional, prefix, suffix } from N
 *   org, nickname
 *   phones      [{ prop, value, e164, key, mobile }]
 *   emails      [{ prop, address }]
 *   chat        [{ prop, address, kind }]: kind "xmpp" (IMPP:xmpp:...),
 *               "x-apple" (Google's rewrite of one it didn't know as XMPP),
 *               "noscheme" (an IMPP address without its xmpp:, which
 *               Thunderbird's card editor refuses) or "x-jabber" (older
 *               apps' X-JABBER line, which Thunderbird doesn't show)
 *   hasPhoto
 *   labels      the card's labels (CATEGORIES)
 */
export function readCard(node, bookName = "") {
  const vcard = parseVCard(node.vCard);
  const fn = first(vcard, "FN");
  const n = first(vcard, "N");
  const [family = "", given = "", additional = "", prefix = "", suffix = ""] = n ? splitStructured(n.value) : [];
  const org = first(vcard, "ORG");
  const nickname = first(vcard, "NICKNAME");

  const phones = getAll(vcard, "TEL").map((prop) => {
    const value = unescapeText(prop.value);
    return { prop, value, e164: phoneNumber(value), key: phoneKey(value), mobile: isMobile(prop) };
  });
  const emails = getAll(vcard, "EMAIL")
    .map((prop) => ({ prop, address: bareAddress(unescapeText(prop.value)) }))
    .filter((e) => e.address);

  const chat = [];
  for (const prop of getAll(vcard, "IMPP")) {
    const value = unescapeText(prop.value).trim();
    const address = xmppAddress(value);
    if (address) {
      chat.push({ prop, address, kind: "xmpp" });
    } else if (/^x-apple:/i.test(value) && chatAddressOf(value)) {
      chat.push({ prop, address: chatAddressOf(value), kind: "x-apple" });
    } else if (!/^[a-z][a-z0-9+.-]*:/i.test(value) && bareAddress(value)) {
      chat.push({ prop, address: bareAddress(value), kind: "noscheme" });
    }
  }
  for (const prop of getAll(vcard, "X-JABBER")) {
    const address = bareAddress(unescapeText(prop.value).replace(/^xmpp:/i, ""));
    if (address) {
      chat.push({ prop, address, kind: "x-jabber" });
    }
  }

  return {
    id: node.id,
    parentId: node.parentId,
    bookName,
    readOnly: Boolean(node.readOnly),
    vCard: node.vCard,
    vcard,
    name: tidy(fn ? unescapeText(fn.value) : ""),
    nameParts: { family: tidy(family), given: tidy(given), additional: tidy(additional), prefix: tidy(prefix), suffix: tidy(suffix) },
    org: tidy(org ? splitStructured(org.value)[0] : ""),
    nickname: tidy(nickname ? unescapeText(nickname.value) : ""),
    phones,
    emails,
    chat,
    hasPhoto: getAll(vcard, "PHOTO").length > 0,
    // Labels (CATEGORIES), split at unescaped commas.
    labels: [...new Set(getAll(vcard, "CATEGORIES").flatMap((p) => p.value.split(/(?<!\\),/).map(unescapeText)).map((s) => s.trim()).filter(Boolean))],
  };
}

/** "Given Family" from a card's N, or "". */
export function nameFromParts(parts) {
  return tidy([parts.given, parts.additional, parts.family].filter(Boolean).join(" "));
}

/** What to call a card in lists: its name, else N, the organization, an email address, a number. */
export function label(card) {
  return (isRealName(card.name) && card.name)
    || nameFromParts(card.nameParts)
    || card.org
    || card.nickname
    || card.name
    || card.emails[0]?.address
    || card.phones[0]?.value
    || "(no name)";
}

/** Two-letter initials for the avatar circle, the way Daynizer makes them. */
export function initials(card) {
  const { given, family } = card.nameParts;
  if (given || family) {
    return `${given[0] ?? ""}${family[0] ?? ""}`.toUpperCase();
  }
  const words = label(card).split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return (words[0]?.[0] ?? "?").toUpperCase();
}

/** A steady, soft avatar color from the name (Daynizer's formula). */
export function avatarColor(card) {
  const key = label(card) || card.id || "?";
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  }
  return `hsl(${h % 360} 42% 52% / 0.72)`;
}
