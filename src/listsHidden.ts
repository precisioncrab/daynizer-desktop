/**
 * Lists hidden on this computer (right-click a list > Hide, 2026-11-20): left
 * out of the sidebar, the task views, the calendar and the Today pane. They
 * keep syncing and nothing changes in them or on the server; "N hidden" under
 * the lists shows them again. Made for Copy to...: after copying a list to a
 * new server, the old one can be hidden so each item shows once.
 */
const KEY = "hiddenListIds";

export function loadHiddenLists(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function storeHiddenLists(ids: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* not remembered */ }
}
