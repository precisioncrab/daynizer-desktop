import type { Entitlement } from "../types";
import { PRO_STORE_URL, openStore } from "./ProWall";

/** Slim, always-visible, never-blocking status bar for the freemium tiers
 *  (THUNDERBIRD-ADDON-FREEMIUM-PLAN.md, "Upgrade banner"): a trial countdown
 *  during the trial, a quiet upgrade note on the free tier, nothing on Pro.
 *  No pop-ups, no remote assets. */
export default function TrialBanner({
  entitlement,
  onEnterLicense
}: {
  entitlement: Entitlement;
  onEnterLicense: () => void;
}) {
  if (entitlement.tier === "pro") return null;

  const trial = entitlement.tier === "trial";
  const days = entitlement.trialDaysLeft;
  // Warm up the color only in the last few days of the trial.
  const urgent = trial && days <= 3;

  const text = trial
    ? `Daynizer Pro trial: ${days} day${days === 1 ? "" : "s"} left with Calendar, Contacts and multiple accounts.`
    : "Free version: tasks on one account. Calendar, Contacts and multiple accounts are part of Daynizer Pro.";

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "4px 16px",
        fontSize: 12,
        color: urgent ? "#e8a23d" : "#9aa0a6",
        background: "#1f2023",
        borderBottom: "1px solid #2c2d31"
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
      {PRO_STORE_URL && (
        <button style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => openStore(trial ? "banner-trial" : "banner-free")}>
          {trial ? "Buy Pro" : "Upgrade"}
        </button>
      )}
      <button style={{ fontSize: 11, padding: "2px 8px" }} onClick={onEnterLicense}>
        Enter license
      </button>
    </div>
  );
}
