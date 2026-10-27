/**
 * Address books and labels hidden from the Contacts tab, one at a time
 * (right-click > Hide, or View > Contacts Sidebar…), remembered on this
 * computer. A hidden address book is left out with its contacts: the
 * contact list, the sidebar's counts and labels, and the clean-up pages
 * (src/cleanup/lib/addressbook.js marks it `hidden`). Birthdays and the
 * contact editor's label list still see them. A hidden label only comes off
 * the sidebar. Nothing changes in the contacts or on the server.
 *
 * Also the colors of Thunderbird's own address books (add-on), which
 * Thunderbird doesn't keep; Daynizer's books keep theirs in the database.
 */

export interface HiddenItems { books: string[]; labels: string[] }

const KEY = "contactsHiddenItems";
const COLORS_KEY = "thunderbirdBookColors";

export function loadHiddenItems(): HiddenItems {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { books: Array.isArray(v.books) ? v.books : [], labels: Array.isArray(v.labels) ? v.labels : [] };
  } catch {
    return { books: [], labels: [] };
  }
}

export function storeHiddenItems(items: HiddenItems) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* not remembered */ }
}

/** The ids of the hidden address books (Daynizer's and Thunderbird's "tb:" ones). */
export const hiddenContactBooks = () => new Set(loadHiddenItems().books);

/** `items` with one book or label hidden or shown again. */
export function withHidden(items: HiddenItems, kind: "books" | "labels", id: string, hidden: boolean): HiddenItems {
  const list = items[kind].filter((x) => x !== id);
  return { ...items, [kind]: hidden ? [...list, id] : list };
}

export function loadThunderbirdBookColors(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(COLORS_KEY) || "{}"); } catch { return {}; }
}

export function storeThunderbirdBookColors(colors: Record<string, string>) {
  try { localStorage.setItem(COLORS_KEY, JSON.stringify(colors)); } catch { /* not remembered */ }
}
