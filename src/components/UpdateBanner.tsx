import { useState } from "react";
import type { ManualUpdate } from "../types";

const DISMISS_KEY = "dismissedUpdateVersion";

/** How to update, per install type. */
function howTo(u: ManualUpdate): { text: string; command?: string } {
  switch (u.kind) {
    case "windows":
      return { text: "It installs the next time Daynizer quits, or restart now." };
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
 *  (same placement as TrialBanner). "Later" hides it until the next version.
 *  On Windows the update is already downloaded, so it offers a restart. */
export default function UpdateBanner({ update }: { update: ManualUpdate }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === update.version; } catch { return false; }
  });
  const [copied, setCopied] = useState(false);
  const [restarting, setRestarting] = useState(false);
  if (dismissed) return null;

  const ready = update.kind === "windows";

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
        color: "var(--text-2)",
        background: "var(--bg-bar)",
        borderTop: "1px solid var(--border)",
        marginTop: "auto",
        flexShrink: 0
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <strong>Daynizer {update.version} is {ready ? "ready to install" : "available"}.</strong> {text}
        {command && <code style={{ marginLeft: 6, padding: "1px 6px", background: "var(--bg-nav-hover)", borderRadius: 4 }}>{command}</code>}
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
      {ready && (
        <button
          className="primary"
          style={button}
          disabled={restarting}
          onClick={() => {
            setRestarting(true);
            window.api.app?.installUpdate().catch(() => setRestarting(false));
          }}
        >
          {restarting ? "Restarting…" : "Restart now"}
        </button>
      )}
      <button style={button} onClick={() => window.open(update.url, "_blank")}>
        {ready ? "What's new" : "Release page"}
      </button>
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
