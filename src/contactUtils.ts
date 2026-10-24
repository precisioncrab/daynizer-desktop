import { Contact } from "./types";

export function contactCategories(c: Contact): string[] {
  return (c.categories || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Labels this contact carries via CardDAV group cards (Synology labels),
 *  decorated onto the row by the main process. */
export function contactGroupLabels(c: Contact): string[] {
  return (c.group_labels || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Visible labels = own categories merged with any labels inherited from group
 *  cards, de-duplicated case-insensitively. The legacy "Favorite" marker (from
 *  the removed favorites feature) is hidden so stale data doesn't show as a chip. */
export function contactLabels(c: Contact): string[] {
  const own = contactCategories(c).filter((x) => x.toLowerCase() !== "favorite");
  const out: string[] = [...own];
  const seen = new Set(own.map((x) => x.toLowerCase()));
  for (const g of contactGroupLabels(c)) {
    if (!seen.has(g.toLowerCase())) { out.push(g); seen.add(g.toLowerCase()); }
  }
  return out;
}

export type ContactFilter =
  | { kind: "all" }
  | { kind: "book"; value: string }
  | { kind: "label"; value: string };

export function matchesFilter(c: Contact, f: ContactFilter): boolean {
  switch (f.kind) {
    case "all": return true;
    case "book": return c.address_book_id === f.value;
    case "label": return contactLabels(c).includes(f.value);
    default: return true;
  }
}

/** Persisted map of label name -> color hex (stored as a settings JSON blob). */
export type LabelColors = Record<string, string>;

/** Initials for the avatar circle when there's no photo. Falls back to the
 *  formatted name (FN) when structured first/last are empty -- as they are for
 *  contacts synced from servers (e.g. Nextcloud) that only send a single name
 *  field. Splitting FN the same way the editor does (first token, then the
 *  remainder) keeps the two-letter initials stable before AND after an edit. */
export function initials(c: Contact): string {
  const a = (c.first_name || "").trim();
  const b = (c.last_name || "").trim();
  if (a || b) return `${a[0] || ""}${b[0] || ""}`.toUpperCase();
  const parts = (c.fn || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0]?.[0] || "?").toUpperCase();
}

/** A stable avatar fill color derived from the contact's name, so each contact
 *  gets a consistent, distinct hue with no stored color -- and it works
 *  immediately for server-synced contacts (no edit/resave needed). Muted
 *  saturation + partial alpha so the solid circle reads softly (translucent)
 *  over the app's dark background rather than as a harsh block of color. */
export function avatarColor(c: Contact): string {
  const key = ((c.fn || `${c.first_name} ${c.last_name}`).trim() || c.id || "?");
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 42% 52% / 0.72)`;
}
