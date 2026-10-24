/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Proposed fixes for one card at a time: phone numbers in one format, and
 * a display name for cards without one. Each proposal says what changes;
 * apply* functions turn the ones the user kept into the card's new vCard.
 */

import { parseVCard, serializeVCard, getAll, first, setValue, makeProp, insertProp, unescapeText, escapeText } from "./vcard.js";
import { formatPhone } from "./phone.js";
import { isRealName, nameFromParts } from "./card.js";

/**
 * The card's phone numbers that aren't in the chosen format:
 * { fixes: [{ index, from, to }], skipped: [{ index, value, reason }] }.
 * `index` is the number's place among the card's TEL lines.
 */
export function phoneFixes(card, options) {
  const fixes = [];
  const skipped = [];
  card.phones.forEach((phone, index) => {
    const result = formatPhone(phone.value, options);
    if (result.skip) {
      skipped.push({ index, value: phone.value, reason: result.skip });
    } else if (result.value !== phone.value) {
      fixes.push({ index, from: phone.value, to: result.value });
    }
  });
  return { fixes, skipped };
}

/** The vCard with the given phone fixes made. */
export function applyPhoneFixes(vCard, fixes) {
  const vcard = parseVCard(vCard);
  const tels = getAll(vcard, "TEL");
  for (const fix of fixes) {
    const prop = tels[fix.index];
    // Only if the line still holds what the proposal was made from.
    if (prop && unescapeText(prop.value) === fix.from) {
      // A written number holds only digits, "+", spaces, dashes and "tel:".
      setValue(prop, fix.to);
    }
  }
  return serializeVCard(vcard);
}

/** "jane.doe-smith" -> "Jane Doe Smith"; words with digits only are dropped. */
function nameFromEmail(address) {
  const local = address.split("@")[0].replace(/\+.*$/, "");
  const words = local.split(/[._\-\s]+/).filter((w) => /\p{L}/u.test(w));
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/**
 * A display name for a card that has none (or only a number or an email
 * address as its name): { name, source, guess } or null.
 * source: "name" (first and last name), "organization", "nickname",
 * "email". `guess` is true for a one-word name from an email address,
 * which starts unchecked.
 */
export function proposeName(card) {
  if (isRealName(card.name)) {
    return null;
  }
  const fromParts = nameFromParts(card.nameParts);
  if (isRealName(fromParts)) {
    return { name: fromParts, source: "name", guess: false };
  }
  if (isRealName(card.org)) {
    return { name: card.org, source: "organization", guess: false };
  }
  if (isRealName(card.nickname)) {
    return { name: card.nickname, source: "nickname", guess: false };
  }
  for (const email of card.emails) {
    const name = nameFromEmail(email.address);
    if (name) {
      return { name, source: "email", guess: !name.includes(" ") };
    }
  }
  return null;
}

/** The vCard with its display name (FN) set. */
export function applyName(vCard, name) {
  const vcard = parseVCard(vCard);
  const fn = first(vcard, "FN");
  if (fn) {
    setValue(fn, escapeText(name));
  } else {
    insertProp(vcard, makeProp("FN", escapeText(name)), "VERSION");
  }
  return serializeVCard(vcard);
}
