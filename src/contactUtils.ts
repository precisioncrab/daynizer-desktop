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
  | { kind: "label"; value: string }
  /** One of Thunderbird's mailing lists (add-on): its members. */
  | { kind: "list"; value: string }
  /** Ctrl/Cmd+click in the sidebar: several books, labels and mailing lists, a contact in any of them shows. */
  | { kind: "multi"; books: string[]; labels: string[]; lists?: string[] };

/** What the sidebar can pick: an address book, a label or (add-on) one of Thunderbird's mailing lists. */
export type FilterKind = "book" | "label" | "list";

/** Mailing list id -> the contact ids on it (Thunderbird's, "tb:<book>»<UID>"). */
export type ListMembers = Map<string, Set<string>>;

export function matchesFilter(c: Contact, f: ContactFilter, listMembers?: ListMembers): boolean {
  const onList = (id: string) => Boolean(listMembers?.get(id)?.has(c.id));
  switch (f.kind) {
    case "all": return true;
    case "book": return c.address_book_id === f.value;
    case "label": return contactLabels(c).includes(f.value);
    case "list": return onList(f.value);
    case "multi": return f.books.includes(c.address_book_id) || contactLabels(c).some((l) => f.labels.includes(l)) || (f.lists ?? []).some(onList);
    default: return true;
  }
}

/** One book, label or list, or several, as the simplest filter that says so (none = all contacts). */
function filterOf(books: string[], labels: string[], lists: string[]): ContactFilter {
  const n = books.length + labels.length + lists.length;
  if (n === 0) return { kind: "all" };
  if (n === 1 && books.length) return { kind: "book", value: books[0] };
  if (n === 1 && labels.length) return { kind: "label", value: labels[0] };
  if (n === 1) return { kind: "list", value: lists[0] };
  return { kind: "multi", books, labels, lists };
}

function filterParts(f: ContactFilter): { books: string[]; labels: string[]; lists: string[] } {
  if (f.kind === "book") return { books: [f.value], labels: [], lists: [] };
  if (f.kind === "label") return { books: [], labels: [f.value], lists: [] };
  if (f.kind === "list") return { books: [], labels: [], lists: [f.value] };
  if (f.kind === "multi") return { books: [...f.books], labels: [...f.labels], lists: [...(f.lists ?? [])] };
  return { books: [], labels: [], lists: [] };
}

const partOf = (parts: ReturnType<typeof filterParts>, kind: FilterKind) =>
  kind === "book" ? parts.books : kind === "label" ? parts.labels : parts.lists;

/** Whether a book, label or list is part of the filter (highlighted in the sidebar). */
export function filterHas(f: ContactFilter, kind: FilterKind, value: string): boolean {
  return partOf(filterParts(f), kind).includes(value);
}

/** Ctrl/Cmd+click: adds the book, label or list to the filter, or takes it out. */
export function toggleInFilter(f: ContactFilter, kind: FilterKind, value: string): ContactFilter {
  const parts = filterParts(f);
  const list = partOf(parts, kind);
  const at = list.indexOf(value);
  if (at >= 0) list.splice(at, 1); else list.push(value);
  return filterOf(parts.books, parts.labels, parts.lists);
}

/** The filter without a book, label or list that's gone (deleted). */
export function dropFromFilter(f: ContactFilter, kind: FilterKind, value: string): ContactFilter {
  return filterHas(f, kind, value) ? toggleInFilter(f, kind, value) : f;
}

/** The address books in the filter (the clean-up tools work on these; none = every book). */
export function filterBooks(f: ContactFilter): string[] {
  return filterParts(f).books;
}

/** The first address book in the filter, where a new contact goes. */
export function filterFirstBook(f: ContactFilter): string | null {
  return filterParts(f).books[0] ?? null;
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
