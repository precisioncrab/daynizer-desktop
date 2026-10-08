import { useState } from "react";
import type { ManualUpdate } from "../types";

const DISMISS_KEY = "dismissedUpdateVersion";

/** How to update, per install type (macOS/Linux; Windows updates itself). */
function howTo(u: ManualUpdate): { text: string; command?: string } {
  switch (u.kind) {
    case "flatpak":
      return { text: "Update it in GNOME Software or KDE Discover, or run:", command: "flatpak update" };
    case "deb":
      return {
        text: "Download the .deb from the release page, then install it with:",
        command: `sudo apt install ./daynizer_${u.version}_amd64.deb`
      };
    case "appimage":
      return { text: "Download the new AppImage from the release page." };
    case "mac":
      return { text: "Download the new .dmg from the release page and drag Daynizer into Applications." };
    default:
      return { text: "Download it from the release page." };
  }
}

/** Slim bar at the bottom of the main column when a newer release exists
 *  (same placement as TrialBanner). "Later" hides it until the next version. */
export default function UpdateBanner({ update }: { update: ManualUpdate }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === update.version; } catch { return false; }
  });
  const [copied, setCopied] = useState(false);
  if (dismissed) return null;

  const { text, command } = howTo(update);
  const button = { fontSize: 13, padding: "5px 14px" };

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        fontSize: 13.5,
        color: "#c8ccd1",
        background: "#1f2023",
        borderTop: "1px solid #2c2d31",
        marginTop: "auto",
        flexShrink: 0
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <strong>Daynizer {update.version} is available.</strong> {text}
        {command && <code style={{ marginLeft: 6, padding: "1px 6px", background: "#2a2b2f", borderRadius: 4 }}>{command}</code>}
      </span>
      {command && (
        <button
          style={button}
          onClick={() => {
            navigator.clipboard?.writeText(command).then(() => setCopied(true)).catch(() => {});
          }}
        >
          {copied ? "Copied" : "Copy command"}
        </button>
      )}
      <button style={button} onClick={() => window.open(update.url, "_blank")}>Release page</button>
      <button
        style={button}
        onClick={() => {
          try { localStorage.setItem(DISMISS_KEY, update.version); } catch { /* ignore */ }
          setDismissed(true);
        }}
      >
        Later
      </button>
    </div>
  );
}
