// Daynizer for Thunderbird connects to servers over https only (an
// addons.thunderbird.net rule, 0.9.0 review, 2026-11). The desktop app keeps
// plain http for LAN servers. __ADDON__ is a build-time constant: true in the
// add-on build (thunderbird-addon/vite.config.ts), false in the desktop
// renderer (vite.config.ts), so add-on-only branches are removed from the
// desktop bundle and desktop-only branches from the add-on bundle.
// The add-on's background enforces the same rule: thunderbird-addon/background/https-only.ts.

export const HTTPS_ONLY_MESSAGE =
  "Daynizer for Thunderbird only connects to servers over an encrypted connection (https://). " +
  "Change this account's address to start with https:// (on a Synology NAS: port 5001 instead of 5000). " +
  "If Thunderbird doesn't trust your server's certificate yet, open the https:// address in a Thunderbird tab once and accept it.";

/** True for an https:// URL. Empty values pass (a CardDAV-only account has no CalDAV URL). */
export function isHttpsUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
