import { useEffect, useMemo, useState } from "react";
import type { CaldavAccountPublic, CopyAllItem, CopyOutcome, CopyPlan, CopyProgress, DavKind } from "../types";

/** Copy to... (2026-11-20). Copies a list (calendar) or address book from one
 *  server account to another, server to server (electron/davcopy.ts): the
 *  source is only read, nothing on the target is overwritten, and the same
 *  items can be copied again safely (they count as "already there"). "all"
 *  copies every calendar and address book of an account (Settings > Accounts). */
export type CopyRequest =
  | { mode: "one"; kind: DavKind; sourceId: string; sourceName: string; sourceAccountId: string }
  | { mode: "all"; sourceAccountId: string };

interface Props {
  request: CopyRequest;
  accounts: CaldavAccountPublic[];
  onClose: () => void;
  /** After a copy: sync the target account so the copied items show up. */
  onCopied: (targetAccountId: string) => void;
}

const NEW = "__new__";
const kindWord = (k: DavKind) => (k === "calendar" ? "list" : "address book");

/** Accounts that can take this kind (CalDAV needs a CalDAV URL; CardDAV a CardDAV or server URL). */
function fits(a: CaldavAccountPublic, kind: DavKind | "all") {
  if (kind === "calendar") return !!a.server_url;
  if (kind === "addressbook") return !!(a.carddav_url || a.server_url);
  return true;
}

/** The report as plain text, for "Copy the report". */
function reportText(outcomes: CopyOutcome[]): string {
  const lines: string[] = [];
  for (const o of outcomes) {
    if (!o.report) { lines.push(`${o.sourceName}: could not run: ${o.error}`); continue; }
    const r = o.report;
    lines.push(`${o.sourceName}: copied ${r.copied}, already there ${r.already}, failed ${r.failed}. Source ${r.sourceCount} items, target ${r.targetCountAfter} items.${r.complete ? " Every item is on the target." : ` ${r.missing} not on the target.`}`);
    lines.push(`  ${r.sourceUrl} -> ${r.targetUrl}${r.createdTarget ? " (new)" : ""}`);
    for (const it of r.items) {
      lines.push(it.status === "failed"
        ? `  FAILED ${it.label ? `${it.label} ` : ""}(${it.name}): ${it.reason}`
        : `  renamed ${it.label ? `${it.label} ` : ""}(${it.name} -> ${it.targetName})`);
    }
  }
  return lines.join("\n");
}

export default function CopyToModal({ request, accounts, onClose, onCopied }: Props) {
  const kind = request.mode === "one" ? request.kind : "all";
  const targets = useMemo(
    () => accounts.filter((a) => fits(a, kind) && (request.mode === "one" || a.id !== request.sourceAccountId)),
    [accounts, kind, request]
  );
  const sourceLabel = accounts.find((a) => a.id === request.sourceAccountId)?.label ?? "";
  // Another account first: copying within one account is allowed but rare.
  const [targetId, setTargetId] = useState(() => (targets.find((a) => a.id !== request.sourceAccountId) ?? targets[0])?.id ?? "");
  const [plan, setPlan] = useState<CopyPlan | null>(null);
  const [allPlan, setAllPlan] = useState<CopyAllItem[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [targetUrl, setTargetUrl] = useState(NEW);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<CopyProgress | null>(null);
  const [outcomes, setOutcomes] = useState<CopyOutcome[] | null>(null);
  const [error, setError] = useState("");
  const [copiedNote, setCopiedNote] = useState("");

  // Where the items can go on the chosen account.
  useEffect(() => {
    if (!targetId || outcomes) return;
    let gone = false;
    setLoading(true); setError(""); setPlan(null); setAllPlan(null);
    (async () => {
      try {
        if (request.mode === "one") {
          const p = await window.api.copy!.plan(request.kind, request.sourceId, targetId);
          if (gone) return;
          setPlan(p);
          setTargetUrl(p.sameFolderUrl ?? NEW);
        } else {
          const items = await window.api.copy!.allPlan(request.sourceAccountId, targetId);
          if (gone) return;
          setAllPlan(items);
          setPicked(new Set(items.map((i) => i.url)));
        }
      } catch (e: any) {
        if (!gone) setError(e?.message || String(e));
      } finally {
        if (!gone) setLoading(false);
      }
    })();
    return () => { gone = true; };
  }, [targetId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => window.api.on("copy:progress", (p: CopyProgress) => setProgress(p)), []);

  async function run() {
    setRunning(true); setError(""); setProgress(null);
    try {
      let out: CopyOutcome[];
      if (request.mode === "one") {
        out = [await window.api.copy!.one(request.kind, request.sourceId, targetId, targetUrl === NEW ? null : targetUrl)];
      } else {
        const items = (allPlan ?? []).filter((i) => picked.has(i.url)).map(({ kind, url, name }) => ({ kind, url, name }));
        out = await window.api.copy!.all(request.sourceAccountId, targetId, items);
      }
      setOutcomes(out);
      onCopied(targetId);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setRunning(false);
    }
  }

  const targetLabel = accounts.find((a) => a.id === targetId)?.label ?? "";
  const title = request.mode === "one" ? `Copy "${request.sourceName}" to…` : `Copy everything from ${sourceLabel} to…`;
  const canRun = !!targetId && !loading && !running && (request.mode === "one" ? !!plan : picked.size > 0);

  return (
    <div className="overlay" onClick={running ? undefined : onClose}>
      <div className="settings-modal" style={{ position: "relative", maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        {!running && <button className="modal-close" onClick={onClose}>×</button>}
        <h2>{title}</h2>

        {!outcomes && (
          <>
            <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 0 }}>
              Copies each item exactly as it is on the server, with its alarms, attendees and everything else.
              Nothing on {sourceLabel || "the source"} is changed, nothing already on the target is replaced,
              and copying again only adds what is missing.
            </p>

            <label>To account</label>
            {targets.length === 0 ? (
              <div style={{ fontSize: 13 }}>No account can take it. Add one in Settings &gt; Accounts first.</div>
            ) : (
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={running}>
                {targets.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}{a.id === request.sourceAccountId ? " (the same account)" : ""}</option>
                ))}
              </select>
            )}

            {loading && <div style={{ fontSize: 13, marginTop: 10, color: "var(--text-muted)" }}>Looking at {targetLabel}…</div>}

            {request.mode === "one" && plan && (
              <>
                <label style={{ marginTop: 10 }}>Into</label>
                <select value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} disabled={running}>
                  <option value={NEW}>New {kindWord(request.kind)} "{plan.sourceName}" (same name, color and kind)</option>
                  {plan.collections.map((c) => (
                    <option key={c.url} value={c.url}>
                      Existing: {c.name}{c.url === plan.sameFolderUrl ? " (same folder name, probably an earlier copy)" : ""}
                    </option>
                  ))}
                </select>
              </>
            )}

            {request.mode === "all" && allPlan && (
              <>
                <label style={{ marginTop: 10 }}>What to copy ({picked.size} of {allPlan.length})</label>
                {allPlan.length === 0 && <div style={{ fontSize: 13 }}>{sourceLabel} has no calendars or address books.</div>}
                <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid var(--border-strong)", borderRadius: 4, padding: "4px 8px" }}>
                  {allPlan.map((i) => (
                    <label key={i.url} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13, margin: "4px 0", fontWeight: "normal" }}>
                      <input
                        type="checkbox"
                        checked={picked.has(i.url)}
                        disabled={running}
                        onChange={(e) => setPicked((was) => {
                          const next = new Set(was);
                          if (e.target.checked) next.add(i.url); else next.delete(i.url);
                          return next;
                        })}
                      />
                      <span style={{ flex: 1 }}>{i.name} <span style={{ color: "var(--text-muted)" }}>({i.kind === "calendar" ? "calendar or list" : "address book"})</span></span>
                      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{i.existingTargetUrl ? "into the existing one with its folder name" : "new"}</span>
                    </label>
                  ))}
                </div>
              </>
            )}

            {running && (
              <div style={{ marginTop: 14, fontSize: 13 }}>
                <ProgressLine p={progress} />
              </div>
            )}

            {error && <div style={{ color: "var(--danger, #d33)", fontSize: 13, marginTop: 10 }}>{error}</div>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={onClose} disabled={running}>Cancel</button>
              <button onClick={run} disabled={!canRun}>{running ? "Copying…" : "Copy"}</button>
            </div>
          </>
        )}

        {outcomes && (
          <>
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              {outcomes.map((o, i) => <Outcome key={i} o={o} />)}
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
              The copies now show under {targetLabel} after its sync. To see each item only once, right-click the old
              {request.mode === "one" && request.kind === "addressbook" ? " address book" : " list"} and choose Hide.
              The full report is also in sync.log.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", marginTop: 8 }}>
              {copiedNote && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{copiedNote}</span>}
              <button onClick={async () => {
                try { await navigator.clipboard.writeText(reportText(outcomes)); setCopiedNote("Copied."); } catch { setCopiedNote("Couldn't copy."); }
              }}>Copy the report</button>
              <button onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProgressLine({ p }: { p: CopyProgress | null }) {
  if (!p) return <div>Starting…</div>;
  const which = p.count && p.count > 1 ? `${p.collection} (${(p.index ?? 0) + 1} of ${p.count})` : p.collection ?? "";
  const step = p.phase === "reading" ? "reading the source"
    : p.phase === "creating" ? "making the new collection"
    : p.phase === "copying" ? `${p.done} of ${p.total} items`
    : p.phase === "checking" ? "checking both sides"
    : "done";
  const pct = p.phase === "copying" && p.total ? Math.round((p.done / p.total) * 100) : p.phase === "checking" || p.phase === "done" ? 100 : 0;
  return (
    <>
      <div>{which}{which ? ": " : ""}{step}</div>
      <div style={{ height: 6, background: "var(--bg-field)", borderRadius: 3, marginTop: 6, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent, #4a8)" }} />
      </div>
    </>
  );
}

function Outcome({ o }: { o: CopyOutcome }) {
  if (!o.report) {
    return (
      <div style={{ marginBottom: 12 }}>
        <strong>{o.sourceName}</strong>
        <div style={{ color: "var(--danger, #d33)", fontSize: 13 }}>Could not run: {o.error}</div>
      </div>
    );
  }
  const r = o.report;
  const failed = r.items.filter((i) => i.status === "failed");
  const renamed = r.items.filter((i) => i.status !== "failed" && i.targetName);
  return (
    <div style={{ marginBottom: 12 }}>
      <strong>{o.sourceName}</strong>{r.createdTarget ? " (new on the target)" : " (into an existing one)"}
      <div style={{ fontSize: 13 }}>
        Copied {r.copied}, already there {r.already}, failed {r.failed}.
        {" "}Source: {r.sourceCount} item(s); target now: {r.targetCountAfter}.
      </div>
      <div style={{ fontSize: 13, color: r.complete ? "var(--text-muted)" : "var(--danger, #d33)" }}>
        {r.complete ? "✓ Every item is on the target." : `${r.missing} item(s) are not on the target.`}
        {o.linkedId ? "" : " (Couldn't add it to Daynizer; connect it in Settings.)"}
      </div>
      {failed.length > 0 && (
        <ul style={{ fontSize: 12, margin: "4px 0 0 0", paddingLeft: 18 }}>
          {failed.map((i) => <li key={i.name}><strong>{i.label ?? i.name}</strong>{i.label ? ` (${i.name})` : ""}: {i.reason}</li>)}
        </ul>
      )}
      {renamed.length > 0 && (
        <details style={{ fontSize: 12, marginTop: 4 }}>
          <summary>{renamed.length} copied under another file name (the target refused the original)</summary>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {renamed.map((i) => <li key={i.name}>{i.label ?? i.name}: {i.name} → {i.targetName}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
