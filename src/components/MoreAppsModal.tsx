import { openExternal } from "./ProWall";

/** View > More from Precision Crab: every Precision Crab app, one line and a
 *  link each. The only place Daynizer links OMEMO for Thunderbird in the paid
 *  add-on and on desktop: quiet, the user goes looking for it. Product names
 *  are always written in full ("OMEMO for Thunderbird + Calls"). */
const APPS: { id: "desktop" | "addon" | "omemo" | "omemoCalls" | "cleanup"; name: string; text: string; url: string }[] = [
  {
    id: "desktop",
    name: "Daynizer for Desktop",
    text: "Tasks, calendar and contacts for Windows, macOS and Linux, synced over CalDAV and CardDAV, with its own sync server if you want one. Free and open source.",
    url: "https://precisioncrab.com/apps/daynizer/"
  },
  {
    id: "addon",
    name: "Daynizer for Thunderbird",
    text: "Daynizer's tasks, calendar and contacts in a Thunderbird tab.",
    url: "https://precisioncrab.com/apps/daynizer-thunderbird/"
  },
  {
    id: "omemo",
    name: "OMEMO for Thunderbird",
    text: "End-to-end encrypted XMPP chat in Thunderbird's own chat, with the encryption Conversations and Cheogram use. Free.",
    // Its page on precisioncrab.com (/apps/omemo-thunderbird/) isn't up yet; switch to it once it is.
    url: "https://precisioncrab.gumroad.com/l/omemo"
  },
  {
    id: "omemoCalls",
    name: "OMEMO for Thunderbird + Calls",
    text: "OMEMO for Thunderbird with audio calls to XMPP apps and JMP.chat numbers.",
    url: "https://precisioncrab.gumroad.com/l/omemo-pro"
  },
  {
    id: "cleanup",
    name: "Contacts Cleanup",
    text: "Cleans up Thunderbird's own address book. Daynizer already has all of its tools in its Contacts tab (Clean up and Chat), for Daynizer's contacts, so you don't need both.",
    // Its addons.thunderbird.net page once it's listed.
    url: "https://github.com/precisioncrab/contacts-cleanup"
  }
];

export default function MoreAppsModal({ isAddon, onClose }: { isAddon: boolean; onClose: () => void }) {
  const current = isAddon ? "addon" : "desktop";
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="settings-modal about-modal more-apps-modal"
        style={{ position: "relative" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>More from Precision Crab</h2>
        <div className="more-apps">
          {APPS.map((app) => (
            <div key={app.id} className="more-app">
              <div className="more-app-text">
                <div className="more-app-name">
                  {app.name}
                  {app.id === current && <span className="more-app-here">You're using this</span>}
                </div>
                <div className="more-app-line">{app.text}</div>
              </div>
              <button onClick={() => openExternal(app.url)} title={app.url}>Open page</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
