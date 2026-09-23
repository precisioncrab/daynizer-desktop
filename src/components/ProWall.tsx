import type { Entitlement } from "../types";

// Where "Buy Pro" goes. Empty until the Gumroad product page exists; the button
// hides itself while it's empty.
export const PRO_STORE_URL = "";

/** Open a web page in the user's default browser. In the Thunderbird add-on
 *  that's messenger.windows.openDefaultBrowser (a plain link would open inside
 *  Thunderbird); elsewhere a normal new window. */
export function openExternal(url: string) {
  const b = (globalThis as any).browser ?? (globalThis as any).messenger;
  if (b?.windows?.openDefaultBrowser) b.windows.openDefaultBrowser(url);
  else window.open(url, "_blank", "noopener");
}

/** Shown in place of a Pro view (Calendar, Contacts) once the trial has ended.
 *  Only the view is walled -- nothing is unlinked or deleted, so activating a
 *  license brings everything back exactly as it was. */
export default function ProWall({
  feature,
  entitlement,
  onEnterLicense
}: {
  feature: string;
  entitlement: Entitlement;
  onEnterLicense: () => void;
}) {
  const ended = new Date(entitlement.trialEndsAt).toLocaleDateString();
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 440, textAlign: "center", lineHeight: 1.6 }}>
        <h2 style={{ marginBottom: 8 }}>{feature} is a Daynizer Pro feature</h2>
        <p style={{ color: "#9aa0a6", fontSize: 13 }}>
          Your 30-day trial ended on {ended}. Your {feature.toLowerCase()} data is safe: it stays on this
          computer and on your server, and comes back as soon as you activate a license.
        </p>
        <p style={{ color: "#9aa0a6", fontSize: 13 }}>
          Tasks keep working on the free version.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
          {PRO_STORE_URL && (
            <button className="primary" onClick={() => openExternal(PRO_STORE_URL)}>
              Buy Daynizer Pro
            </button>
          )}
          <button onClick={onEnterLicense}>Enter license key</button>
        </div>
      </div>
    </div>
  );
}
