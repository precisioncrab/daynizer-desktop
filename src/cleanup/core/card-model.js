/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * One contact as the fields the contact editor shows (like Daynizer's
 * contact panel), and back to vCard text.
 *
 * Writing back works on the card's own lines (src/core/vcard.js): a field
 * the user didn't change keeps its lines exactly as written, a changed
 * value keeps its line's group and parameters (only TYPE follows the type
 * picked), and every line the editor doesn't show (photo, UID, custom X-
 * fields) stays. A new contact is the same writer on an empty vCard.
 */

import { parseVCard, serializeVCard, parseLine, getAll, first, setValue, makeProp, insertProp, removeProp, typesOf, unescapeText, escapeText, splitStructured } from "./vcard.js";
import { XMPP_PARAMS } from "./card.js";

/** The types the editor offers, as stored (vCard TYPE) and shown. "other" is stored as no TYPE. */
export const PHONE_TYPES = [["cell", "mobile"], ["home", "home"], ["work", "work"], ["main", "main"], ["fax", "fax"], ["pager", "pager"], ["other", "other"]];
export const EMAIL_TYPES = [["home", "personal"], ["work", "work"], ["other", "other"]];
export const ADDRESS_TYPES = [["home", "home"], ["work", "work"], ["other", "other"]];

const typeOf = (prop, offered) => {
  const types = typesOf(prop).map((t) => (t === "mobile" || t === "iphone" || t === "x-mobile" ? "cell" : t));
  return offered.map(([value]) => value).find((value) => value !== "other" && types.includes(value)) ?? "other";
};

/** A date as the editor keeps it: "YYYY-MM-DD" (a year-less one with 2000) and whether it has no year. */
export function readDate(text) {
  const value = String(text ?? "").trim();
  let m = /^--(\d{2})-?(\d{2})/.exec(value);
  if (m) {
    return { date: `2000-${m[1]}-${m[2]}`, noYear: true };
  }
  m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(value);
  return m ? { date: `${m[1]}-${m[2]}-${m[3]}`, noYear: false } : { date: "", noYear: false };
}

/** A date written for a vCard: "1987-01-02", or "--01-02" without a year; "" for none. */
export const writeDate = (date, noYear) => (!date ? "" : noYear ? `--${date.slice(5, 7)}-${date.slice(8, 10)}` : date);

const text = (prop) => (prop ? unescapeText(prop.value).trim() : "");
const telText = (prop) => (/^tel:/i.test(prop.value) ? prop.value.trim() : unescapeText(prop.value).trim());

/** An address's seven parts (PO box, extended, street, city, region, postal code, country). */
function parts7(value) {
  const parts = splitStructured(value);
  while (parts.length < 7) {
    parts.push("");
  }
  return parts.slice(0, 7);
}

/**
 * The editor's fields for a vCard. Each value of a field with several
 * (phones, emails, chat addresses, addresses, websites) carries `at`, its
 * line's place among that field's lines, so an edited value keeps its line.
 */
export function cardModel(vCard) {
  const vcard = parseVCard(vCard);
  const n = first(vcard, "N");
  const nParts = n ? splitStructured(n.value) : [];
  const bday = readDate(first(vcard, "BDAY")?.value);
  const anniversary = readDate(first(vcard, "ANNIVERSARY")?.value);
  return {
    fn: text(first(vcard, "FN")),
    given: (nParts[1] ?? "").trim(),
    family: (nParts[0] ?? "").trim(),
    nickname: text(first(vcard, "NICKNAME")),
    org: first(vcard, "ORG") ? splitStructured(first(vcard, "ORG").value)[0].trim() : "",
    title: text(first(vcard, "TITLE")),
    bday: bday.date,
    bdayNoYear: bday.noYear,
    anniversary: anniversary.date,
    anniversaryNoYear: anniversary.noYear,
    phones: getAll(vcard, "TEL").map((p, at) => ({ type: typeOf(p, PHONE_TYPES), value: telText(p), at })),
    emails: getAll(vcard, "EMAIL").map((p, at) => ({ type: typeOf(p, EMAIL_TYPES), value: text(p), at })),
    chats: getAll(vcard, "IMPP").map((p, at) => ({ value: unescapeText(p.value).trim(), at })),
    addresses: getAll(vcard, "ADR").map((p, at) => ({ type: typeOf(p, ADDRESS_TYPES), parts: parts7(p.value), at })),
    urls: getAll(vcard, "URL").map((p, at) => ({ value: unescapeText(p.value).trim(), at })),
    categories: getAll(vcard, "CATEGORIES").flatMap((p) => p.value.split(/(?<!\\),/).map(unescapeText)).map((s) => s.trim()).filter(Boolean).join(", "),
    note: getAll(vcard, "NOTE").map(text).filter(Boolean).join("\n\n"),
  };
}

/** A chat address as written on a card: "xmpp:" added to a bare address, so Thunderbird's card editor takes it. */
export const chatUri = (value) => {
  const t = String(value).trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(t) || !t.includes("@") ? t : `xmpp:${t}`;
};

/** The order fields with several values are kept in, and what a new line goes after when the card has none of them. */
const MULTI = [
  { key: "phones", name: "TEL", after: ["N", "FN"], types: PHONE_TYPES, encode: (v) => (/^tel:/i.test(v) ? v : escapeText(v)) },
  { key: "emails", name: "EMAIL", after: ["TEL", "N", "FN"], types: EMAIL_TYPES, encode: escapeText },
  { key: "chats", name: "IMPP", after: ["EMAIL", "TEL", "N", "FN"], encode: chatUri },
  { key: "addresses", name: "ADR", after: ["IMPP", "EMAIL", "TEL", "N", "FN"], types: ADDRESS_TYPES, encode: (parts) => parts.map((p) => escapeText(String(p).trim())).join(";") },
  { key: "urls", name: "URL", after: ["ADR", "IMPP", "EMAIL", "TEL", "N", "FN"], encode: (v) => String(v).trim() },
];

const isEmpty = (item) => (item.parts ? item.parts.every((p) => !String(p).trim()) : !String(item.value).trim());
const sameList = (a, b) => JSON.stringify(a.map(({ type, value, parts }) => [type ?? "", value ?? "", parts ?? []]))
  === JSON.stringify(b.map(({ type, value, parts }) => [type ?? "", value ?? "", parts ?? []]));

/** Inserts after the last line of the first name in `names` the card has, else before END. */
function insertAfterAny(vcard, prop, names) {
  for (const name of [prop.name, ...names]) {
    if (getAll(vcard, name).length) {
      return insertProp(vcard, prop, name);
    }
  }
  return insertProp(vcard, prop);
}

/** Sets one plain field: replaces its first line's value, adds a line, or removes the field when emptied. */
function setSingle(vcard, name, value, afterNames, encode = escapeText, params = []) {
  const props = getAll(vcard, name);
  if (!value) {
    props.forEach((p) => removeProp(vcard, p));
  } else if (props.length) {
    setValue(props[0], encode(value));
    props.slice(1).forEach((p) => removeProp(vcard, p));
  } else {
    insertAfterAny(vcard, makeProp(name, encode(value), params), afterNames);
  }
}

/** The vCard with the editor's fields written in; untouched fields keep their lines as they are. */
export function modelToVCard(vCard, model) {
  const vcard = parseVCard(vCard);
  const was = cardModel(vCard);
  const trim = (s) => String(s ?? "").trim();
  const fn = trim(model.fn) || [trim(model.given), trim(model.family)].filter(Boolean).join(" ") || trim(model.org);

  if (fn !== was.fn) {
    setSingle(vcard, "FN", fn, ["VERSION"]);
  }
  if (trim(model.given) !== was.given || trim(model.family) !== was.family) {
    const n = first(vcard, "N");
    const parts = n ? splitStructured(n.value) : [];
    while (parts.length < 5) {
      parts.push("");
    }
    parts[0] = trim(model.family);
    parts[1] = trim(model.given);
    const value = parts.map(escapeText).join(";");
    if (n) {
      setValue(n, value);
    } else {
      insertAfterAny(vcard, makeProp("N", value), ["FN", "VERSION"]);
    }
  }
  if (trim(model.nickname) !== was.nickname) {
    setSingle(vcard, "NICKNAME", trim(model.nickname), ["N", "FN"]);
  }
  if (trim(model.org) !== was.org) {
    const org = first(vcard, "ORG");
    if (org && trim(model.org)) {
      // Keep the departments after the organization's name.
      const parts = splitStructured(org.value);
      parts[0] = trim(model.org);
      setValue(org, parts.map(escapeText).join(";"));
    } else {
      setSingle(vcard, "ORG", trim(model.org), ["NICKNAME", "N", "FN"]);
    }
  }
  if (trim(model.title) !== was.title) {
    setSingle(vcard, "TITLE", trim(model.title), ["ORG", "N", "FN"]);
  }
  for (const [key, name] of [["bday", "BDAY"], ["anniversary", "ANNIVERSARY"]]) {
    const value = writeDate(model[key], model[`${key}NoYear`]);
    if (value !== writeDate(was[key], was[`${key}NoYear`])) {
      getAll(vcard, name).forEach((p) => removeProp(vcard, p));
      if (value) {
        insertAfterAny(vcard, makeProp(name, value, [{ key: "VALUE", value: "date" }]), ["TITLE", "ORG", "N", "FN"]);
      }
    }
  }

  for (const field of MULTI) {
    const items = (model[field.key] ?? []).filter((item) => !isEmpty(item));
    if (sameList(items, was[field.key])) {
      continue;
    }
    const old = getAll(vcard, field.name);
    old.forEach((p) => removeProp(vcard, p));
    for (const item of items) {
      const value = field.encode(item.parts ?? item.value);
      const source = item.at !== undefined && item.at !== null ? old[item.at] : null;
      let prop;
      if (source && (!field.types || typeOf(source, field.types) === item.type)) {
        // Same line, same type: its group and parameters stay exactly as written.
        prop = parseLine(source.raw);
        setValue(prop, value);
      } else {
        // A new value, or a new type: the type picked replaces the line's TYPE; PREF and the rest stay.
        const typed = field.types && item.type && item.type !== "other" ? [{ key: "TYPE", value: item.type }] : [];
        // A new chat address is marked as Jabber, so Google Contacts keeps it as XMPP.
        const jabber = field.name === "IMPP" && !source && /^xmpp:/i.test(value) ? XMPP_PARAMS : [];
        prop = makeProp(field.name, value, [...(source ? source.params.filter((p) => p.key !== "TYPE") : []), ...typed, ...jabber], source?.group ?? "");
      }
      insertAfterAny(vcard, prop, field.after);
    }
  }

  const categories = String(model.categories ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (categories.join(", ") !== was.categories) {
    getAll(vcard, "CATEGORIES").forEach((p) => removeProp(vcard, p));
    if (categories.length) {
      insertAfterAny(vcard, makeProp("CATEGORIES", categories.map(escapeText).join(",")), ["NOTE", "URL", "ADR"]);
    }
  }
  if (String(model.note ?? "").trim() !== was.note) {
    setSingle(vcard, "NOTE", String(model.note ?? "").trim(), ["URL", "ADR", "IMPP", "EMAIL", "TEL"]);
  }
  return serializeVCard(vcard);
}

/** An empty contact's fields (for New contact). */
export const emptyModel = () => cardModel("BEGIN:VCARD\r\nVERSION:4.0\r\nEND:VCARD\r\n");

/** A new contact's vCard from the editor's fields. */
export const newContactVCard = (model) => modelToVCard("BEGIN:VCARD\r\nVERSION:4.0\r\nEND:VCARD\r\n", model);
