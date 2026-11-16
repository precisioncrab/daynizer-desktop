/** The line at the top of a list's or address book's right-click menu that says
 *  which server it syncs with (Arlis's request, 2026-11-11). */
export function syncPlace(
  accountId: string | null,
  url: string | null,
  accounts: { id: string; label: string }[]
): string {
  if (!accountId || !url) return "Local only, not synced";
  let host = "";
  try { host = new URL(url).host; } catch { /* keep the label alone */ }
  const label = accounts.find((a) => a.id === accountId)?.label?.trim();
  if (!label) return host ? `On ${host} (account removed)` : "On a server account that was removed";
  if (!host || label.toLowerCase().includes(host.toLowerCase())) return `On ${label}`;
  return `On ${label} (${host})`;
}
