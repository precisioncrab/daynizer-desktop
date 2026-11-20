/**
 * Copy to... in the desktop app (2026-11-20): picks the accounts, URLs and
 * folder names, runs davcopy.ts (the server-to-server copy, which never writes
 * to the source and never overwrites the target) and links the target
 * collection into Daynizer as a list or address book so the copied items show
 * up after the next sync of the target account.
 *
 * A new target collection takes the source's folder name when it's free there.
 * Copy everything to... copies into a collection that already has that folder
 * name (and is the same kind) instead of making a second one, so running it
 * again only fills in what is missing.
 */
import { accountsAll, addressBooksAll, listsAll } from "./db.js";
import type { CaldavAccount, TaskList } from "./db.js";
import { calendarHomeUrl, connectCalendar, davFetchFor, decryptPassword, discoverCalendars, syncLog } from "./caldav.js";
import { addressBookHomeUrl, connectAddressBook, discoverAddressBooks } from "./carddav.js";
import {
  collectionInfo, collectionKindAt, copyCollection, fileName, freeCollectionUrl, safeDecode, safeSegment,
  type CopyProgress, type CopyReport, type DavEndpoint, type DavKind
} from "./davcopy.js";

export interface CopyTargetCollection { url: string; name: string }

export interface CopyPlan {
  sourceName: string;
  /** The target account's existing collections of this kind. */
  collections: CopyTargetCollection[];
  /** An existing target collection with the source's folder name (an earlier
   *  copy, most likely), offered first in the dialog. */
  sameFolderUrl: string | null;
}

export interface CopyAllItem {
  kind: DavKind;
  url: string;
  name: string;
  /** Where it will go: an existing collection with the same folder name, or null for a new one. */
  existingTargetUrl: string | null;
}

/** What a finished copy hands back: the report, plus the target collection's
 *  Daynizer list or book (null when linking failed) or why it couldn't start. */
export interface CopyOutcome {
  sourceName: string;
  kind: DavKind;
  report: CopyReport | null;
  error: string | null;
  linkedId: string | null;
}

function account(id: string): CaldavAccount {
  const a = accountsAll().find((x) => x.id === id);
  if (!a) throw new Error("Account not found");
  return a;
}

function endpoint(a: CaldavAccount, url: string): DavEndpoint {
  return { username: a.username, password: decryptPassword(a.password_enc), fetch: davFetchFor(url) };
}

const homeOf = (kind: DavKind, a: CaldavAccount) => (kind === "calendar" ? calendarHomeUrl(a) : addressBookHomeUrl(a));

const samePath = (a: string, b: string) => {
  const norm = (u: string) => { try { return decodeURIComponent(new URL(u).pathname).replace(/\/+$/, ""); } catch { return u; } };
  return norm(a) === norm(b);
};

/** The source collection of a Daynizer list or address book. */
function sourceOf(kind: DavKind, sourceId: string): { account: CaldavAccount; url: string; name: string; color: string | null } {
  if (kind === "calendar") {
    const l = listsAll().find((x) => x.id === sourceId);
    if (!l?.caldav_account_id || !l.caldav_calendar_url) throw new Error("This list isn't on a server, so there is nothing to copy from (use Sync to server... instead).");
    return { account: account(l.caldav_account_id), url: l.caldav_calendar_url, name: l.name, color: l.color ?? null };
  }
  const b = addressBooksAll().find((x) => x.id === sourceId);
  if (!b?.carddav_account_id || !b.carddav_addressbook_url) throw new Error("This address book isn't on a server, so there is nothing to copy from.");
  return { account: account(b.carddav_account_id), url: b.carddav_addressbook_url, name: b.name, color: null };
}

async function sameFolderOnTarget(kind: DavKind, target: CaldavAccount, sourceUrl: string): Promise<string | null> {
  const home = (await homeOf(kind, target)).replace(/\/?$/, "/");
  const folder = safeSegment(fileName(sourceUrl));
  if (!folder) return null;
  const url = new URL(`${folder}/`, home).toString();
  return (await collectionKindAt(endpoint(target, url), url)) === kind ? url : null;
}

/** For the Copy to... dialog: the target account's collections and the one
 *  that already has the source's folder name. */
export async function copyPlan(kind: DavKind, sourceId: string, targetAccountId: string): Promise<CopyPlan> {
  const src = sourceOf(kind, sourceId);
  const target = account(targetAccountId);
  const found = kind === "calendar" ? await discoverCalendars(target) : await discoverAddressBooks(target);
  const collections = found
    .filter((c) => !(target.id === src.account.id && samePath(c.url, src.url)))
    .map((c) => ({ url: c.url, name: c.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name));
  let sameFolderUrl: string | null = null;
  try { sameFolderUrl = await sameFolderOnTarget(kind, target, src.url); } catch { /* offered without it */ }
  if (sameFolderUrl && target.id === src.account.id && samePath(sameFolderUrl, src.url)) sameFolderUrl = null;
  return { sourceName: src.name, collections, sameFolderUrl };
}

/** Link the target collection into Daynizer (reusing a list or book already
 *  linked to it). Returns its id, or null when that fails (the copy itself is
 *  done either way). */
function linkTarget(kind: DavKind, target: CaldavAccount, url: string, name: string, color: string | null): string | null {
  try {
    if (kind === "calendar") {
      const list: TaskList = connectCalendar(target.id, url, name, color);
      return list.id;
    }
    return connectAddressBook(target.id, url, name).id;
  } catch (e: any) {
    syncLog(`copy: couldn't link ${url} into Daynizer: ${e?.message || e}`);
    return null;
  }
}

/** A Daynizer list color from a CalDAV calendar-color (#RRGGBBAA -> #RRGGBB). */
function listColor(davColor: string | null): string | null {
  const m = davColor ? /^#([0-9a-f]{6})/i.exec(davColor.trim()) : null;
  return m ? `#${m[1].toLowerCase()}` : null;
}

async function runOne(
  kind: DavKind,
  src: { account: CaldavAccount; url: string; name: string; color: string | null },
  target: CaldavAccount,
  targetUrl: string | null,
  reuseSameFolder: boolean,
  onProgress: (p: CopyProgress) => void
): Promise<CopyOutcome> {
  const S = { ...endpoint(src.account, src.url), url: src.url };
  try {
    const info = await collectionInfo(S, src.url);
    if (info.kind && info.kind !== kind) throw new Error(`The source is not ${kind === "calendar" ? "a calendar" : "an address book"}.`);
    let url = targetUrl;
    let create = false;
    if (!url && reuseSameFolder) url = await sameFolderOnTarget(kind, target, src.url);
    if (!url) {
      const home = await homeOf(kind, target);
      url = await freeCollectionUrl(endpoint(target, home), home, safeDecode(fileName(src.url)));
      create = true;
    }
    if (target.id === src.account.id && samePath(url, src.url)) throw new Error("The source and the target are the same collection.");
    syncLog(`copy: ${src.url} -> ${url}${create ? " (new)" : ""}`);
    const report = await copyCollection({
      kind,
      source: S,
      target: { ...endpoint(target, url), url },
      create: create ? info : undefined,
      onProgress
    });
    syncLog(`copy: done ${src.name}: copied ${report.copied}, already there ${report.already}, failed ${report.failed}, source ${report.sourceCount}, target ${report.targetCountAfter}${report.complete ? "" : `, ${report.missing} missing on the target`}`);
    for (const it of report.items) if (it.status === "failed") syncLog(`copy: FAILED ${it.name}${it.label ? ` (${it.label})` : ""}: ${it.reason}`);
    const name = info.displayName ?? src.name;
    const linkedId = linkTarget(kind, target, url, name, src.color ?? listColor(info.color));
    return { sourceName: src.name, kind, report, error: null, linkedId };
  } catch (e: any) {
    const cause = e?.cause?.message || e?.cause?.code;
    const error = `${e?.message || e}${cause ? ` (${cause})` : ""}`;
    syncLog(`copy: ${src.name} could not run: ${error}`);
    return { sourceName: src.name, kind, report: null, error, linkedId: null };
  }
}

/** Right-click a list or address book > Copy to...: `targetUrl` is an existing
 *  collection, or null for a new one. */
export async function copyOne(
  kind: DavKind,
  sourceId: string,
  targetAccountId: string,
  targetUrl: string | null,
  onProgress: (p: CopyProgress) => void
): Promise<CopyOutcome> {
  const src = sourceOf(kind, sourceId);
  return runOne(kind, src, account(targetAccountId), targetUrl, false, (p) => onProgress({ ...p, collection: src.name }));
}

/** Copy everything to...: every calendar and address book on the source
 *  account, with where each will go on the target. */
export async function copyAllPlan(sourceAccountId: string, targetAccountId: string): Promise<CopyAllItem[]> {
  const source = account(sourceAccountId);
  const target = account(targetAccountId);
  const out: CopyAllItem[] = [];
  const cals = source.server_url ? await discoverCalendars(source) : [];
  let books: { url: string; displayName: string }[] = [];
  try { books = await discoverAddressBooks(source); } catch { /* no CardDAV on this account */ }
  for (const c of cals) out.push({ kind: "calendar", url: c.url, name: c.displayName, existingTargetUrl: null });
  for (const b of books) out.push({ kind: "addressbook", url: b.url, name: b.displayName, existingTargetUrl: null });
  for (const it of out) {
    try { it.existingTargetUrl = await sameFolderOnTarget(it.kind, target, it.url); } catch { /* new */ }
  }
  return out;
}

export async function copyAll(
  sourceAccountId: string,
  targetAccountId: string,
  items: { kind: DavKind; url: string; name: string }[],
  onProgress: (p: CopyProgress & { index: number; count: number }) => void
): Promise<CopyOutcome[]> {
  const source = account(sourceAccountId);
  const target = account(targetAccountId);
  const out: CopyOutcome[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    // A source collection Daynizer already shows keeps its list color.
    const linked = it.kind === "calendar"
      ? listsAll().find((l) => l.caldav_account_id === source.id && l.caldav_calendar_url && samePath(l.caldav_calendar_url, it.url))
      : undefined;
    const src = { account: source, url: it.url, name: it.name, color: linked?.color ?? null };
    out.push(await runOne(it.kind, src, target, null, true, (p) => onProgress({ ...p, collection: it.name, index: i, count: items.length })));
  }
  return out;
}
