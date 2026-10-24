/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A vCard as a list of property lines, edited in place.
 *
 * Thunderbird's contacts API replaces a card's whole vCard on update, so a
 * card is never rebuilt from a model: every line this add-on doesn't touch
 * goes back exactly as it came (photos, custom X- fields, groups and all).
 * A changed value keeps its line's group, name and parameters as written.
 *
 * Each property: { raw, group, name, params: [{ key, value }], value }.
 * `raw` is the unfolded line; the other fields are read from it.
 */

/** Parses vCard text into { props }. Lines without a colon are kept as they are. */
export function parseVCard(text) {
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((line) => line.trim() !== "");
  return { props: lines.map(parseLine) };
}

/** vCard text from { props }, lines ending in CRLF. */
export function serializeVCard(card) {
  return card.props.map((p) => p.raw).join("\r\n") + "\r\n";
}

/** A property from one unfolded line. */
export function parseLine(raw) {
  const colon = findUnquoted(raw, ":");
  if (colon < 0) {
    return { raw, group: "", name: "", params: [], value: raw };
  }
  const [head, ...paramParts] = splitUnquoted(raw.slice(0, colon), ";");
  const dot = head.lastIndexOf(".");
  const params = paramParts.map((part) => {
    const eq = part.indexOf("=");
    // A bare parameter ("TEL;CELL:...", vCard 2.1) is a TYPE.
    return eq < 0
      ? { key: "TYPE", value: part }
      : { key: part.slice(0, eq).toUpperCase(), value: part.slice(eq + 1).replace(/^"|"$/g, "") };
  });
  return {
    raw,
    group: dot < 0 ? "" : head.slice(0, dot),
    name: head.slice(dot + 1).toUpperCase(),
    params,
    value: raw.slice(colon + 1),
  };
}

function findUnquoted(text, char) {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      quoted = !quoted;
    } else if (text[i] === char && !quoted) {
      return i;
    }
  }
  return -1;
}

function splitUnquoted(text, char) {
  const parts = [];
  let rest = text;
  for (let i = findUnquoted(rest, char); i >= 0; i = findUnquoted(rest, char)) {
    parts.push(rest.slice(0, i));
    rest = rest.slice(i + 1);
  }
  parts.push(rest);
  return parts;
}

/** Every property with this name (any group), in order. */
export function getAll(card, name) {
  const upper = name.toUpperCase();
  return card.props.filter((p) => p.name === upper);
}

/** The first property with this name, or undefined. */
export function first(card, name) {
  return getAll(card, name)[0];
}

/** Sets a property's value, keeping its group, name and parameters exactly as written. */
export function setValue(prop, value) {
  const colon = findUnquoted(prop.raw, ":");
  const head = colon < 0 ? prop.name : prop.raw.slice(0, colon);
  prop.raw = `${head}:${value}`;
  prop.value = value;
}

/** A new property line. Parameter values with : ; or , are quoted. */
export function makeProp(name, value, params = [], group = "") {
  const quote = (v) => (/[:;,]/.test(v) ? `"${v}"` : v);
  const head = [`${group ? `${group}.` : ""}${name.toUpperCase()}`, ...params.map((p) => `${p.key}=${quote(p.value)}`)].join(";");
  return parseLine(`${head}:${value}`);
}

/** A copy of a property without its group and without the given parameters (for moving it to another card). */
export function withoutGroupAndParams(prop, dropKeys = []) {
  const drop = new Set(dropKeys.map((k) => k.toUpperCase()));
  return makeProp(prop.name, prop.value, prop.params.filter((p) => !drop.has(p.key)));
}

/**
 * Inserts a property after the last one with the same name, or else after
 * `afterName` if given and present, or else before END:VCARD.
 */
export function insertProp(card, prop, afterName) {
  const lastIndex = (name) => card.props.map((p) => p.name).lastIndexOf(name);
  let at = lastIndex(prop.name);
  if (at < 0 && afterName) {
    at = lastIndex(afterName.toUpperCase());
  }
  if (at < 0) {
    const end = card.props.findLastIndex((p) => p.name === "END");
    at = (end < 0 ? card.props.length : end) - 1;
  }
  card.props.splice(at + 1, 0, prop);
  return prop;
}

/** Removes a property (the object itself). */
export function removeProp(card, prop) {
  const at = card.props.indexOf(prop);
  if (at >= 0) {
    card.props.splice(at, 1);
  }
}

/** A property's TYPE values, lowercase, commas split ("TYPE=cell,voice", "TYPE=CELL;TYPE=VOICE"). */
export function typesOf(prop) {
  return prop.params
    .filter((p) => p.key === "TYPE")
    .flatMap((p) => p.value.split(","))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/** A text value's escapes undone (\\, \, \; \n). */
export function unescapeText(value) {
  return String(value).replace(/\\([\\,;nN])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
}

/** A text value escaped for a vCard line. */
export function escapeText(text) {
  return String(text).replace(/[\\,;]/g, "\\$&").replace(/\r?\n/g, "\\n");
}

/** A structured value (N, ADR, ORG) split at its unescaped semicolons, unescaped. */
export function splitStructured(value) {
  return String(value).split(/(?<!\\);/).map(unescapeText);
}

/**
 * The vCard with lines that change on every save (REV, PRODID) and the
 * photo left out, for comparing two versions. (Thunderbird adds a local
 * card's photo to the vCard it gives add-ons, so the photo isn't a change.)
 */
export function comparable(text) {
  return parseVCard(text).props
    .filter((p) => p.name !== "REV" && p.name !== "PRODID" && p.name !== "PHOTO")
    .map((p) => p.raw)
    .join("\n");
}

/** A vCard's PHOTO lines, as one string ("" without a photo). */
export function photoLines(text) {
  return parseVCard(text).props.filter((p) => p.name === "PHOTO").map((p) => p.raw).join("\r\n");
}

/** The vCard without its PHOTO lines. */
export function withoutPhoto(text) {
  const card = parseVCard(text);
  card.props = card.props.filter((p) => p.name !== "PHOTO");
  return serializeVCard(card);
}

/** The vCard with the given PHOTO lines (from photoLines()) in place of its own. */
export function withPhoto(text, lines) {
  const card = parseVCard(withoutPhoto(text));
  for (const raw of lines ? lines.split("\r\n") : []) {
    insertProp(card, parseLine(raw));
  }
  return serializeVCard(card);
}
