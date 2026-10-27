import ICAL from "ical.js";
import { nanoid } from "nanoid";

// Pure vCard (CardDAV) serialization layer -- mirrors ical.ts for calendars.
// Deliberately has NO dependency on db.ts: it speaks a plain ParsedContact
// (arrays for multi-value fields); the sync/UI layer maps that to/from the
// Contact row (which stores the arrays as JSON-text columns). vCard 3.0 on the
// wire for maximum client compatibility (Synology, DAVx5, iOS).

export interface TypedValue {
  type: string; // lowercased vCard TYPE (home/work/cell/...), or ""
  value: string;
}
export interface PostalAddress {
  type: string;
  street: string;
  city: string;
  region: string;
  postal: string;
  country: string;
}
export interface ParsedContact {
  uid: string | null;
  fn: string;
  prefix: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  suffix: string;
  nickname: string;
  org: string;
  title: string;
  bday: string | null; // "YYYY-MM-DD" or "--MM-DD" (year-less)
  anniversary: string | null;
  notes: string;
  categories: string; // comma-separated
  photo: string; // data URI or ""
  phones: TypedValue[];
  emails: TypedValue[];
  addresses: PostalAddress[];
  urls: TypedValue[];
  impps: TypedValue[];
  related: TypedValue[];
}

export function newContactUid(): string {
  return `${nanoid()}@tasks-desktop`;
}

/** A CardDAV "group" card (Apple/DAVx5 convention). Synology stores labels
 *  like "DP21"/"wedding" as these separate cards -- a card per label whose
 *  members are listed by UID -- rather than as CATEGORIES on each contact. */
export interface ParsedGroup {
  uid: string | null;
  name: string;
  memberUids: string[];
}

/** Detect a group card and return its name + member UIDs. Returns null for an
 *  ordinary contact card. Handles both the Apple/DAVx5 X-ADDRESSBOOKSERVER-*
 *  properties (vCard 3.0) and the standard KIND/MEMBER properties (vCard 4). */
export function parseGroupCard(vcf: string): ParsedGroup | null {
  try {
    const comp = new ICAL.Component(ICAL.parse(vcf));
    const kind = String(
      comp.getFirstPropertyValue("x-addressbookserver-kind") ??
      comp.getFirstPropertyValue("kind") ??
      ""
    ).toLowerCase();
    if (kind !== "group") return null;
    const memberProps = [
      ...comp.getAllProperties("x-addressbookserver-member"),
      ...comp.getAllProperties("member")
    ];
    const memberUids = memberProps
      .map((p) => String(p.getFirstValue() ?? ""))
      .map((v) => v.replace(/^urn:uuid:/i, "").replace(/^urn:/i, "").trim())
      .filter(Boolean);
    return {
      uid: (comp.getFirstPropertyValue("uid") as string) || null,
      name:
        (comp.getFirstPropertyValue("fn") as string) ||
        (comp.getFirstPropertyValue("n") as string) ||
        "",
      memberUids
    };
  } catch (err) {
    console.error("Failed to parse group vCard", err);
    return null;
  }
}

export function displayName(c: ParsedContact): string {
  const joined = [c.prefix, c.first_name, c.middle_name, c.last_name, c.suffix]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" ");
  return joined || "Unnamed";
}

/** A property's TYPE parameter as a single lowercased string (vCard allows
 *  several; we keep the first meaningful one). */
function typeOf(prop: ICAL.Property): string {
  const t = prop.getParameter("type");
  if (!t) return "";
  const val = Array.isArray(t) ? t[0] : t;
  return String(val || "").toLowerCase();
}

/** Components of a structured value (N, ADR), as plain strings. */
function structuredParts(prop: ICAL.Property | null): string[] {
  if (!prop) return [];
  const v = prop.getFirstValue();
  if (Array.isArray(v)) return v.map((x) => (x == null ? "" : String(x)));
  return [String(v ?? "")];
}

/** A date-ish value (BDAY/ANNIVERSARY) as a stored string, preserving
 *  year-less forms. */
function dateStr(prop: ICAL.Property | null): string | null {
  if (!prop) return null;
  const v = prop.getFirstValue();
  const s = v == null ? "" : (typeof v === "string" ? v : (v as any).toString?.() ?? String(v));
  return s || null;
}

function readPhoto(comp: ICAL.Component): string {
  const p = comp.getFirstProperty("photo");
  if (!p) return "";
  const v = String(p.getFirstValue() ?? "");
  if (!v) return "";
  if (v.startsWith("data:") || v.startsWith("http")) return v;
  // vCard 3.0 inline: PHOTO;ENCODING=b;TYPE=JPEG:<base64>
  const enc = p.getParameter("encoding");
  const type = p.getParameter("type");
  if (enc || type) {
    const t = type ? String(Array.isArray(type) ? type[0] : type).toLowerCase() : "jpeg";
    return `data:image/${t};base64,${v}`;
  }
  return v;
}

export function parseVCard(vcf: string): ParsedContact | null {
  try {
    const comp = new ICAL.Component(ICAL.parse(vcf));
    // N: [family, given, additional, prefixes, suffixes]
    const n = structuredParts(comp.getFirstProperty("n"));
    const orgProp = comp.getFirstProperty("org");
    const orgVal = orgProp
      ? (Array.isArray(orgProp.getFirstValue())
          ? (orgProp.getFirstValue() as unknown as string[]).filter(Boolean).join(", ")
          : String(orgProp.getFirstValue() ?? ""))
      : "";
    const cats = comp.getFirstProperty("categories");

    const mapTyped = (name: string): TypedValue[] =>
      comp.getAllProperties(name).map((p) => ({ type: typeOf(p), value: String(p.getFirstValue() ?? "") })).filter((v) => v.value);

    const addresses: PostalAddress[] = comp.getAllProperties("adr").map((p) => {
      // ADR: [pobox, ext, street, city, region, postal, country]
      const a = structuredParts(p);
      return {
        type: typeOf(p),
        street: a[2] || "",
        city: a[3] || "",
        region: a[4] || "",
        postal: a[5] || "",
        country: a[6] || ""
      };
    });

    return {
      uid: (comp.getFirstPropertyValue("uid") as string) || null,
      fn: (comp.getFirstPropertyValue("fn") as string) || "",
      last_name: n[0] || "",
      first_name: n[1] || "",
      middle_name: n[2] || "",
      prefix: n[3] || "",
      suffix: n[4] || "",
      nickname: (comp.getFirstPropertyValue("nickname") as string) || "",
      org: orgVal,
      title: (comp.getFirstPropertyValue("title") as string) || "",
      bday: dateStr(comp.getFirstProperty("bday")),
      anniversary: dateStr(comp.getFirstProperty("anniversary")),
      notes: (comp.getFirstPropertyValue("note") as string) || "",
      categories: cats ? (cats.getValues() as string[]).join(", ") : "",
      photo: readPhoto(comp),
      phones: mapTyped("tel"),
      emails: mapTyped("email"),
      addresses,
      urls: mapTyped("url"),
      impps: mapTyped("impp"),
      related: mapTyped("related")
    };
  } catch (err) {
    console.error("Failed to parse vCard", err);
    return null;
  }
}

function removeAll(comp: ICAL.Component, name: string) {
  let p = comp.getFirstProperty(name);
  while (p) {
    comp.removeProperty(p);
    p = comp.getFirstProperty(name);
  }
}

function setOrClear(comp: ICAL.Component, name: string, value: string) {
  removeAll(comp, name);
  if (value) comp.updatePropertyWithValue(name, value);
}

/** Rewrite a multi-value property from the modeled values. A value the card
 *  already holds keeps its line, so parameters we don't model (a second TYPE,
 *  PREF, X-SERVICE-TYPE on an XMPP address, an Apple item group) survive; only
 *  its TYPE changes, and only when the modeled type differs. */
function rebuildTyped(comp: ICAL.Component, name: string, values: TypedValue[]) {
  const pool = comp.getAllProperties(name);
  removeAll(comp, name);
  for (const v of values) {
    if (!v.value) continue;
    const i = pool.findIndex((p) => String(p.getFirstValue() ?? "") === v.value);
    let p: ICAL.Property;
    if (i >= 0) {
      p = pool.splice(i, 1)[0];
      if (typeOf(p) !== (v.type || "")) {
        if (v.type) p.setParameter("type", v.type);
        else p.removeParameter("type");
      }
    } else {
      p = new ICAL.Property(name, comp);
      p.setValue(v.value);
      if (v.type) p.setParameter("type", v.type);
    }
    comp.addProperty(p);
  }
}

/** The modeled parts of an ADR line, for matching it to a PostalAddress. */
function adrKey(type: string, street: string, city: string, region: string, postal: string, country: string): string {
  return JSON.stringify([type, street, city, region, postal, country]);
}

/** True when a stored contact still carries what its raw card says (UID
 *  aside). A card without FN is stored with the name made from its parts
 *  (displayName), so that counts as the same. */
const MODELED: (keyof ParsedContact)[] = [
  "fn", "prefix", "first_name", "middle_name", "last_name", "suffix", "nickname", "org", "title", "bday",
  "anniversary", "notes", "categories", "photo", "phones", "emails", "addresses", "urls", "impps", "related"
];
function sameModeled(raw: ParsedContact, c: ParsedContact): boolean {
  const r: ParsedContact = { ...raw, fn: raw.fn || displayName(raw) };
  const norm = (v: unknown) => JSON.stringify(v ?? null);
  return MODELED.every((k) => norm(r[k]) === norm(c[k]));
}

/** Serialize a contact to a vCard 3.0 string. If `rawVCard` is given (the card
 *  we last received from the server, or one the clean-up tools saved whole), it
 *  goes back unchanged when the modeled fields still match it; otherwise we
 *  start from it and overwrite only the fields we model -- so photos and any
 *  properties we don't understand survive the round-trip. `fallbackUid` is the
 *  UID for a card that has none yet. */
export function contactToVCard(c: ParsedContact, rawVCard?: string, fallbackUid?: string): { uid: string; vcf: string } {
  // Nothing we model changed since this card was read (or saved whole by the
  // contacts clean-up tools): send it back exactly as it is.
  if (rawVCard) {
    const raw = parseVCard(rawVCard);
    if (raw && raw.uid && (!c.uid || c.uid === raw.uid) && sameModeled(raw, c)) {
      return { uid: raw.uid, vcf: rawVCard };
    }
  }

  let comp: ICAL.Component;
  try {
    comp = rawVCard ? new ICAL.Component(ICAL.parse(rawVCard)) : new ICAL.Component("vcard");
  } catch {
    comp = new ICAL.Component("vcard");
  }

  const uid = c.uid || (comp.getFirstPropertyValue("uid") as string) || fallbackUid || newContactUid();

  comp.updatePropertyWithValue("version", "3.0");
  comp.updatePropertyWithValue("uid", uid);
  comp.updatePropertyWithValue("fn", c.fn || displayName(c));

  // N (structured): family, given, additional, prefixes, suffixes
  removeAll(comp, "n");
  const n = new ICAL.Property("n", comp);
  n.setValue([c.last_name || "", c.first_name || "", c.middle_name || "", c.prefix || "", c.suffix || ""] as any);
  comp.addProperty(n);

  setOrClear(comp, "nickname", c.nickname);
  setOrClear(comp, "org", c.org);
  setOrClear(comp, "title", c.title);
  setOrClear(comp, "bday", c.bday || "");
  setOrClear(comp, "anniversary", c.anniversary || "");
  setOrClear(comp, "note", c.notes);

  removeAll(comp, "categories");
  const catList = c.categories.split(",").map((s) => s.trim()).filter(Boolean);
  if (catList.length) {
    const cp = new ICAL.Property("categories", comp);
    cp.setValues(catList);
    comp.addProperty(cp);
  }

  rebuildTyped(comp, "tel", c.phones);
  rebuildTyped(comp, "email", c.emails);
  rebuildTyped(comp, "url", c.urls);
  rebuildTyped(comp, "impp", c.impps);
  rebuildTyped(comp, "related", c.related);

  // An address the card already holds keeps its line (PO box, extended part
  // and parameters included); new or edited ones are written fresh.
  const adrPool = comp.getAllProperties("adr");
  removeAll(comp, "adr");
  for (const a of c.addresses) {
    if (![a.street, a.city, a.region, a.postal, a.country].some(Boolean)) continue;
    const key = adrKey(a.type || "", a.street || "", a.city || "", a.region || "", a.postal || "", a.country || "");
    const i = adrPool.findIndex((p) => {
      const parts = structuredParts(p);
      return adrKey(typeOf(p), parts[2] || "", parts[3] || "", parts[4] || "", parts[5] || "", parts[6] || "") === key;
    });
    let p: ICAL.Property;
    if (i >= 0) {
      p = adrPool.splice(i, 1)[0];
    } else {
      p = new ICAL.Property("adr", comp);
      p.setValue(["", "", a.street || "", a.city || "", a.region || "", a.postal || "", a.country || ""] as any);
      if (a.type) p.setParameter("type", a.type);
    }
    comp.addProperty(p);
  }

  return { uid, vcf: comp.toString() };
}
