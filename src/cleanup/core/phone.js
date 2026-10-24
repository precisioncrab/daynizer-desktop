/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Phone numbers: reading them in any format, and writing them in one.
 *
 * The reading rules match OMEMO for Thunderbird's (its
 * src/contacts/cards.js), so a number this add-on puts on a card matches
 * there the same way: "tel:" links, spaces, dashes, dots and brackets are
 * fine; "00" starts an international number; 10 digits, or 11 starting
 * with 1, are US/Canada (+1). A number without a country code from another
 * country is placed only with a default country picked by the user.
 */

/** Countries a number without a country code can be read as. `trunk` is the national prefix dropped after the country code. */
export const COUNTRIES = [
  { id: "nanp", label: "US and Canada (+1)", code: "1", trunk: "1" },
  { id: "gb", label: "United Kingdom (+44)", code: "44", trunk: "0" },
  { id: "ie", label: "Ireland (+353)", code: "353", trunk: "0" },
  { id: "de", label: "Germany (+49)", code: "49", trunk: "0" },
  { id: "fr", label: "France (+33)", code: "33", trunk: "0" },
  { id: "nl", label: "Netherlands (+31)", code: "31", trunk: "0" },
  { id: "au", label: "Australia (+61)", code: "61", trunk: "0" },
  { id: "nz", label: "New Zealand (+64)", code: "64", trunk: "0" },
  { id: "none", label: "None (leave them as they are)", code: "", trunk: "" },
];

export const countryById = (id) => COUNTRIES.find((c) => c.id === id) ?? COUNTRIES[0];

/** Whether a number has an extension (";ext=12", "x12", "ext. 12", ",12"). */
export function hasExtension(value) {
  return /(;ext=|,\s*\d|\s*(?:ext\.?|x)\s*\d)/i.test(String(value ?? "").replace(/^tel:/i, ""));
}

/**
 * A phone number as +E.164, or null when it can't be told. With the
 * default country (US and Canada) the rules are OMEMO for Thunderbird's
 * exactly. Another country reads a number with its national prefix (0)
 * as that country's.
 */
export function phoneNumber(value, country = COUNTRIES[0]) {
  let text = String(value ?? "").trim().replace(/^tel:/i, "");
  // An extension: ";ext=12", "x12", "ext. 12", ",12" (a pause, then digits).
  text = text.replace(/(;|,|\s*(?:ext\.?|x)\s*\d).*$/i, "");
  if (/[a-z]/i.test(text)) {
    return null;
  }
  // "+44 (0)20 ...": the bracketed national prefix isn't dialled from abroad.
  text = text.replace(/^(\+\d{1,3})[\s.-]*\(0\)/, "$1");
  const plus = text.startsWith("+");
  let digits = text.replace(/\D/g, "");
  if (!plus && digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (!plus) {
    if (country.id === "nanp") {
      // OMEMO's rule: 10 digits, or 1 and 10 digits, are US/Canada.
      if (digits.length === 10 && /^[2-9]/.test(digits)) {
        digits = `1${digits}`;
      } else if (!(digits.length === 11 && digits.startsWith("1"))) {
        return null;
      }
    } else if (country.trunk && digits.startsWith(country.trunk) && digits.length >= 7) {
      digits = country.code + digits.slice(country.trunk.length);
    } else {
      return null;
    }
  }
  return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
}

// Country calling codes are a prefix code: 1 and 7 are one digit, these
// are two, and every other code is three.
const TWO_DIGIT = new Set([
  "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44", "45", "46", "47", "48", "49",
  "51", "52", "53", "54", "55", "56", "57", "58", "60", "61", "62", "63", "64", "65", "66",
  "81", "82", "84", "86", "90", "91", "92", "93", "94", "95", "98",
]);

/** The country code of a +E.164 number ("+4420..." -> "44"). */
export function countryCode(e164) {
  const digits = String(e164).replace(/^\+/, "");
  if (digits[0] === "1" || digits[0] === "7") {
    return digits[0];
  }
  return TWO_DIGIT.has(digits.slice(0, 2)) ? digits.slice(0, 2) : digits.slice(0, 3);
}

/** Digit groups for a national number outside US/Canada: 3-3-4 for ten digits, and so on. */
function groups(n) {
  if (n <= 4) {
    return [n];
  }
  const small = { 5: [2, 3], 6: [3, 3], 7: [3, 4], 8: [4, 4] };
  return small[n] ?? [3, ...groups(n - 3)];
}

/**
 * "+15551234567" written in a style: "international" (+1 555 123 4567) or
 * "compact" (+15551234567). Outside US and Canada, `written` (the digit
 * groups the user typed) is kept, since each country groups its own way.
 */
export function writeNumber(e164, style = "international", separator = " ", written = null) {
  if (style === "compact") {
    return e164;
  }
  const code = countryCode(e164);
  const national = e164.slice(1 + code.length);
  let parts;
  if (code === "1" && national.length === 10) {
    parts = [national.slice(0, 3), national.slice(3, 6), national.slice(6)];
  } else if (written) {
    parts = written;
  } else {
    let at = 0;
    parts = groups(national.length).map((len) => national.slice(at, (at += len)));
  }
  return [`+${code}`, ...parts].join(separator);
}

/**
 * The national number's digit groups as written ("+44 (0)20 7946 0958" ->
 * ["20", "7946", "0958"]), without the country code, "00" or the national
 * prefix; null when it was written as one block or in odd pieces.
 */
export function writtenGroups(value, e164) {
  const text = String(value ?? "")
    .replace(/^tel:/i, "")
    .replace(/(;|,|\s*(?:ext\.?|x)\s*\d).*$/i, "")
    .replace(/^(\+\d{1,3})[\s.-]*\(0\)/, "$1");
  const digitGroups = text.match(/\d+/g) ?? [];
  const national = e164.slice(1 + countryCode(e164).length);
  const all = digitGroups.join("");
  let skip = all.length - national.length;
  if (skip < 0 || all.slice(skip) !== national) {
    return null;
  }
  const out = [];
  for (const group of digitGroups) {
    if (skip >= group.length) {
      skip -= group.length;
      continue;
    }
    out.push(group.slice(skip));
    skip = 0;
  }
  return out.length > 1 && out.length <= 5 ? out : null;
}

/**
 * What a TEL value should become in the chosen style, or a reason it's
 * left alone: { value } or { skip: "extension"|"unknown" }. A "tel:" link
 * stays a link (dashes instead of spaces, as links can't hold spaces).
 */
export function formatPhone(value, { style = "international", country = COUNTRIES[0] } = {}) {
  const text = String(value ?? "").trim();
  const e164 = phoneNumber(text, country);
  if (e164 && hasExtension(text)) {
    return { skip: "extension" };
  }
  if (!e164) {
    return { skip: "unknown" };
  }
  const written = writtenGroups(text, e164);
  if (/^tel:/i.test(text)) {
    return { value: `tel:${writeNumber(e164, style, "-", written)}`, e164 };
  }
  return { value: writeNumber(e164, style, " ", written), e164 };
}

/** A key for comparing two numbers: +E.164, or the last 10 digits when the country can't be told. */
export function phoneKey(value) {
  const e164 = phoneNumber(value);
  if (e164) {
    return e164;
  }
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? `#${digits.slice(-10)}` : null;
}
