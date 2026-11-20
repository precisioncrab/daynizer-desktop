/**
 * Copy to... (2026-11-20): copy a calendar (task list) or address book from one
 * CalDAV/CardDAV server to another, server to server.
 *
 * Each item's raw .ics/.vcf is fetched from the source with GET and PUT on the
 * target byte for byte, under the same file name where the target accepts it,
 * so the UID and everything Daynizer doesn't model (alarms, attendees,
 * attachments, other apps' properties) arrive as they were. It never goes
 * through the local database (that is what Merge into... does, and it drops all
 * of that).
 *
 * Safety rules:
 *  - The source only ever sees PROPFIND, REPORT and GET. Nothing on it changes.
 *  - Every PUT carries If-None-Match: *, so nothing on the target is ever
 *    overwritten. An item whose UID is already on the target counts as
 *    "already there", which makes a second run safe (it copies nothing new).
 *  - At most `concurrency` requests run at once (default 4).
 *  - At the end the target is listed again and every source UID is looked up
 *    there; the report says what is missing and why each failure happened.
 *
 * Network only, no database and no Electron: main.ts supplies the URLs,
 * credentials and fetch, and links the result into Daynizer. That keeps it
 * testable against throwaway Radicale servers (scripts/test-dav-copy.mjs).
 */

export type DavKind = "calendar" | "addressbook";

/** The subset of the fetch Response this module reads. */
export interface FetchResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}
export type FetchLike = (url: string, init?: any) => Promise<FetchResponseLike>;

export interface DavEndpoint {
  username: string;
  password: string;
  fetch: FetchLike;
}

export interface CollectionInfo {
  url: string;
  displayName: string | null;
  color: string | null;
  order: string | null;
  description: string | null;
  /** VEVENT, VTODO, ... ; empty = the server didn't say (all allowed). */
  components: string[];
  kind: DavKind | null;
}

export interface CopyItemResult {
  /** The item's file name on the source. */
  name: string;
  uid: string | null;
  /** First SUMMARY / FN, so a failure can be recognized in the report. */
  label: string | null;
  status: "copied" | "already" | "failed";
  reason?: string;
  /** Set when the target got a different file name than the source's. */
  targetName?: string;
}

export interface CopyReport {
  kind: DavKind;
  sourceUrl: string;
  targetUrl: string;
  sourceName: string;
  createdTarget: boolean;
  sourceCount: number;
  targetCountBefore: number;
  targetCountAfter: number;
  copied: number;
  already: number;
  failed: number;
  /** Source items not found on the target in the final check. */
  missing: number;
  /** True when every source item is on the target. */
  complete: boolean;
  /** Failed and renamed items (copied and already-there ones are only counted). */
  items: CopyItemResult[];
}

export interface CopyProgress {
  phase: "reading" | "creating" | "copying" | "checking" | "done";
  done: number;
  total: number;
  /** Which collection, for Copy everything to... */
  collection?: string;
}

export interface CopyOptions {
  kind: DavKind;
  source: DavEndpoint & { url: string };
  target: DavEndpoint & { url: string };
  /** Make the target collection first (MKCALENDAR / extended MKCOL) with these
   *  properties. Omit to copy into an existing collection. */
  create?: CollectionInfo;
  concurrency?: number;
  onProgress?: (p: CopyProgress) => void;
}

const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:ic="http://apple.com/ns/ical/"';

// ---------- HTTP ----------

interface RawResponse { status: number; text: string; body: Uint8Array; contentType: string | null }

function authHeader(ep: DavEndpoint): string {
  const bytes = new TextEncoder().encode(`${ep.username}:${ep.password}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One request. Retries once after a second on a network error or 502/503/504
 *  (Synology and a busy NAS both do this now and then); never retries anything
 *  that reached the server and was answered. */
async function request(
  ep: DavEndpoint,
  method: string,
  url: string,
  opts: { body?: string | Uint8Array; headers?: Record<string, string>; binary?: boolean } = {}
): Promise<RawResponse> {
  const headers: Record<string, string> = { Authorization: authHeader(ep), ...(opts.headers || {}) };
  if (opts.body != null) {
    const len = typeof opts.body === "string" ? new TextEncoder().encode(opts.body).length : opts.body.length;
    // Radicale doesn't read chunked request bodies (CLAUDE.md, C4 gotcha 2).
    headers["Content-Length"] = String(len);
  }
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(1000);
    try {
      const res = await ep.fetch(url, { method, headers, body: opts.body, redirect: "follow" });
      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt === 0) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      let body: Uint8Array;
      let text: string;
      if (opts.binary && res.arrayBuffer) {
        body = new Uint8Array(await res.arrayBuffer());
        text = new TextDecoder().decode(body);
      } else {
        text = await res.text();
        body = new TextEncoder().encode(text);
      }
      return { status: res.status, text, body, contentType: res.headers.get("content-type") };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------- tiny XML reading (multistatus only) ----------

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Inner XML of the first element with this local name (any prefix), or null. */
function elem(xml: string, local: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${local}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${local}\\s*>)`, "i");
  const m = re.exec(xml);
  if (!m) return null;
  return m[1] ?? "";
}

interface MsResponse { href: string; ok: string; status: string | null }

/** The <response> blocks of a multistatus, each with its href and the inner XML
 *  of its 200 propstat(s). */
function responses(xml: string): MsResponse[] {
  const out: MsResponse[] = [];
  const re = /<(?:[\w.-]+:)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?response\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const href = decodeXml((elem(block, "href") ?? "").trim());
    let ok = "";
    const ps = /<(?:[\w.-]+:)?propstat(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?propstat\s*>/gi;
    let p: RegExpExecArray | null;
    while ((p = ps.exec(block))) {
      const st = elem(p[1], "status") ?? "";
      if (/\s2\d\d\s/.test(` ${st} `) || st === "") ok += elem(p[1], "prop") ?? "";
    }
    const directStatus = /<(?:[\w.-]+:)?propstat/i.test(block) ? null : elem(block, "status");
    out.push({ href, ok, status: directStatus });
  }
  return out;
}

function abs(href: string, base: string): string {
  return new URL(href, base).toString();
}

function samePath(a: string, b: string): boolean {
  const norm = (u: string) => {
    try { return decodeURIComponent(new URL(u).pathname).replace(/\/+$/, ""); } catch { return u.replace(/\/+$/, ""); }
  };
  return norm(a) === norm(b);
}

/** Last path segment as it appears in the URL (still percent-encoded). */
export function fileName(url: string): string {
  const path = new URL(url).pathname.replace(/\/+$/, "");
  return path.slice(path.lastIndexOf("/") + 1);
}

// ---------- item text ----------

/** UID of the item: the UID of its first VEVENT/VTODO/VJOURNAL/VFREEBUSY (not a
 *  VALARM's), or the VCARD's. Null when it has none. */
export function itemUid(text: string): string | null {
  return topProp(text, "UID");
}

/** SUMMARY of the first component, or FN of the card. */
function itemLabel(text: string): string | null {
  return topProp(text, "SUMMARY") ?? topProp(text, "FN");
}

function topProp(text: string, prop: string): string | null {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const stack: string[] = [];
  const tops = new Set(["VEVENT", "VTODO", "VJOURNAL", "VFREEBUSY", "VCARD"]);
  const re = new RegExp(`^${prop}[;:]`, "i");
  for (const line of lines) {
    const b = /^BEGIN:(.+)$/i.exec(line);
    if (b) { stack.push(b[1].trim().toUpperCase()); continue; }
    if (/^END:/i.test(line)) { stack.pop(); continue; }
    if (re.test(line) && tops.has(stack[stack.length - 1] ?? "")) {
      const i = line.indexOf(":");
      const v = line.slice(i + 1).trim();
      return v || null;
    }
  }
  return null;
}

// ---------- collections ----------

/** Name, color, order, description, component types and kind of a collection. */
export async function collectionInfo(ep: DavEndpoint, url: string): Promise<CollectionInfo> {
  const body = `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop>` +
    "<d:displayname/><d:resourcetype/><ic:calendar-color/><ic:calendar-order/>" +
    "<c:calendar-description/><card:addressbook-description/><c:supported-calendar-component-set/>" +
    "</d:prop></d:propfind>";
  const res = await request(ep, "PROPFIND", url, { body, headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" } });
  if (res.status !== 207) throw new Error(`Couldn't read the collection (HTTP ${res.status})`);
  const r = responses(res.text)[0];
  const props = r?.ok ?? "";
  const txt = (local: string) => {
    const v = elem(props, local);
    return v == null ? null : (decodeXml(v).trim() || null);
  };
  const rt = elem(props, "resourcetype") ?? "";
  const kind: DavKind | null = /<(?:[\w.-]+:)?calendar[\s/>]/i.test(rt)
    ? "calendar"
    : /<(?:[\w.-]+:)?addressbook[\s/>]/i.test(rt) ? "addressbook" : null;
  const set = elem(props, "supported-calendar-component-set") ?? "";
  const components = [...set.matchAll(/name\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1].toUpperCase());
  return {
    url,
    displayName: txt("displayname"),
    color: txt("calendar-color"),
    order: txt("calendar-order"),
    description: txt("calendar-description") ?? txt("addressbook-description"),
    components,
    kind
  };
}

/** Does a collection (or anything) exist at this URL? Returns its kind, or
 *  "other" for a non-DAV-collection, or null when nothing is there. */
export async function collectionKindAt(ep: DavEndpoint, url: string): Promise<DavKind | "other" | null> {
  const body = `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop><d:resourcetype/></d:prop></d:propfind>`;
  const res = await request(ep, "PROPFIND", url, { body, headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" } });
  if (res.status === 404) return null;
  if (res.status !== 207) return "other";
  const rt = elem(responses(res.text)[0]?.ok ?? "", "resourcetype") ?? "";
  if (/<(?:[\w.-]+:)?calendar[\s/>]/i.test(rt)) return "calendar";
  if (/<(?:[\w.-]+:)?addressbook[\s/>]/i.test(rt)) return "addressbook";
  return "other";
}

function xmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Make a collection like `info` at `url`: same name, color, order, description
 *  and component types. Throws when the server refuses. */
export async function createCollection(ep: DavEndpoint, url: string, kind: DavKind, info: CollectionInfo): Promise<void> {
  const props: string[] = [];
  if (info.displayName) props.push(`<d:displayname>${xmlText(info.displayName)}</d:displayname>`);
  if (kind === "calendar") {
    if (info.color) props.push(`<ic:calendar-color>${xmlText(info.color)}</ic:calendar-color>`);
    if (info.order) props.push(`<ic:calendar-order>${xmlText(info.order)}</ic:calendar-order>`);
    if (info.description) props.push(`<c:calendar-description>${xmlText(info.description)}</c:calendar-description>`);
    if (info.components.length) {
      props.push(`<c:supported-calendar-component-set>${info.components.map((c) => `<c:comp name="${xmlText(c)}"/>`).join("")}</c:supported-calendar-component-set>`);
    }
    const body = `<?xml version="1.0" encoding="utf-8"?><c:mkcalendar ${NS}><d:set><d:prop>${props.join("")}</d:prop></d:set></c:mkcalendar>`;
    const res = await request(ep, "MKCALENDAR", url, { body, headers: { "Content-Type": "application/xml; charset=utf-8" } });
    if (res.status !== 201) throw new Error(`The target server refused to create the calendar (HTTP ${res.status})`);
  } else {
    if (info.description) props.push(`<card:addressbook-description>${xmlText(info.description)}</card:addressbook-description>`);
    const body = `<?xml version="1.0" encoding="utf-8"?><d:mkcol ${NS}><d:set><d:prop>` +
      `<d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>${props.join("")}` +
      "</d:prop></d:set></d:mkcol>";
    const res = await request(ep, "MKCOL", url, { body, headers: { "Content-Type": "application/xml; charset=utf-8" } });
    if (res.status !== 201) throw new Error(`The target server refused to create the address book (HTTP ${res.status})`);
  }
}

/** A free folder URL under `homeUrl` for `wanted`: `wanted` itself when nothing
 *  is there, else wanted-2, wanted-3, ... */
export async function freeCollectionUrl(ep: DavEndpoint, homeUrl: string, wanted: string): Promise<string> {
  const home = homeUrl.replace(/\/?$/, "/");
  const base = safeSegment(wanted) || "collection";
  for (let i = 1; i < 100; i++) {
    const url = abs(`${i === 1 ? base : `${base}-${i}`}/`, home);
    if ((await collectionKindAt(ep, url)) === null) return url;
  }
  throw new Error("No free folder name on the target");
}

/** A folder or file name segment Radicale and SabreDAV both accept: letters,
 *  digits and . _ - @ + = ~ ; anything else becomes "-". Percent-encoded input
 *  is decoded first. */
export function safeSegment(s: string): string {
  let d = s;
  try { d = decodeURIComponent(s); } catch { /* keep as is */ }
  return d.replace(/[^A-Za-z0-9._@+=~-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(0, 120);
}

interface ListedItem { url: string; name: string; etag: string | null }

/** Every item (non-collection member) of a collection. */
export async function listItems(ep: DavEndpoint, collUrl: string): Promise<ListedItem[]> {
  const body = `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>`;
  const res = await request(ep, "PROPFIND", collUrl, { body, headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" } });
  if (res.status !== 207) throw new Error(`Couldn't list the collection (HTTP ${res.status})`);
  const out: ListedItem[] = [];
  for (const r of responses(res.text)) {
    if (!r.href) continue;
    const url = abs(r.href, collUrl);
    if (samePath(url, collUrl)) continue;
    if (/<(?:[\w.-]+:)?collection[\s/>]/i.test(elem(r.ok, "resourcetype") ?? "")) continue;
    const etag = elem(r.ok, "getetag");
    out.push({ url, name: fileName(url), etag: etag == null ? null : decodeXml(etag).trim() });
  }
  return out;
}

/** UID of every item in a collection, by item URL. Uses a multiget REPORT in
 *  batches of 50 (one GET per item when the server won't do multiget). */
export async function itemUids(ep: DavEndpoint, collUrl: string, kind: DavKind, items: ListedItem[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const dataEl = kind === "calendar" ? "c:calendar-data" : "card:address-data";
  const reportEl = kind === "calendar" ? "c:calendar-multiget" : "card:addressbook-multiget";
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const hrefs = batch.map((it) => `<d:href>${xmlText(new URL(it.url).pathname)}</d:href>`).join("");
    const body = `<?xml version="1.0" encoding="utf-8"?><${reportEl} ${NS}><d:prop><d:getetag/><${dataEl}/></d:prop>${hrefs}</${reportEl}>`;
    let got = false;
    try {
      const res = await request(ep, "REPORT", collUrl, { body, headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" } });
      if (res.status === 207) {
        for (const r of responses(res.text)) {
          const data = elem(r.ok, kind === "calendar" ? "calendar-data" : "address-data");
          if (data == null) continue;
          out.set(abs(r.href, collUrl), itemUid(decodeXml(data)));
        }
        got = true;
      }
    } catch { /* fall back to GET below */ }
    for (const it of batch) {
      if (got && [...out.keys()].some((k) => samePath(k, it.url))) continue;
      const res = await request(ep, "GET", it.url);
      if (res.status === 200) out.set(it.url, itemUid(res.text));
    }
  }
  // Key by the listed URL so callers can look items up by what listItems gave.
  const byListed = new Map<string, string | null>();
  for (const it of items) {
    const hit = [...out.entries()].find(([k]) => samePath(k, it.url));
    if (hit) byListed.set(it.url, hit[1]);
  }
  return byListed;
}

// ---------- the copy ----------

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function shortReason(status: number, text: string): string {
  const t = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  const what: Record<number, string> = {
    400: "the target server rejected the item",
    401: "the target refused the login",
    403: "the target refused (no permission, or it doesn't accept this item)",
    409: "conflict on the target",
    413: "too large for the target server",
    415: "the target doesn't accept this kind of item",
    507: "the target server is out of space"
  };
  return `HTTP ${status}${what[status] ? `, ${what[status]}` : ""}${t ? ` (${t})` : ""}`;
}

/** Copy every item of one collection to another. Never changes the source and
 *  never overwrites the target. Throws only when the copy can't start (source
 *  unreadable, target can't be created or listed); per-item problems go in the
 *  report. */
export async function copyCollection(opts: CopyOptions): Promise<CopyReport> {
  const { kind, source, target } = opts;
  const conc = opts.concurrency ?? 4;
  const progress = opts.onProgress ?? (() => {});
  const ext = kind === "calendar" ? ".ics" : ".vcf";
  const defaultType = kind === "calendar" ? "text/calendar; charset=utf-8" : "text/vcard; charset=utf-8";

  progress({ phase: "reading", done: 0, total: 0 });
  const srcInfo = await collectionInfo(source, source.url);
  const srcItems = await listItems(source, source.url);

  let createdTarget = false;
  if (opts.create) {
    progress({ phase: "creating", done: 0, total: srcItems.length });
    await createCollection(target, target.url, kind, opts.create);
    createdTarget = true;
  }

  const tgtBefore = createdTarget ? [] : await listItems(target, target.url);
  const tgtUids = new Set<string>();
  const tgtNames = new Set<string>(tgtBefore.map((t) => safeDecode(t.name)));
  if (tgtBefore.length) {
    for (const uid of (await itemUids(target, target.url, kind, tgtBefore)).values()) if (uid) tgtUids.add(uid);
  }

  const results: CopyItemResult[] = [];
  const srcUidByUrl = new Map<string, string | null>();
  let done = 0;
  progress({ phase: "copying", done, total: srcItems.length });

  const put = (url: string, body: Uint8Array, type: string) =>
    request(target, "PUT", url, { body, headers: { "If-None-Match": "*", "Content-Type": type } });

  await pool(srcItems, conc, async (it) => {
    const r: CopyItemResult = { name: safeDecode(it.name), uid: null, label: null, status: "failed" };
    try {
      const got = await request(source, "GET", it.url, { binary: true });
      if (got.status !== 200) {
        r.reason = `Couldn't read it from the source (HTTP ${got.status})`;
        return;
      }
      r.uid = itemUid(got.text);
      r.label = itemLabel(got.text);
      srcUidByUrl.set(it.url, r.uid);
      if (r.uid && tgtUids.has(r.uid)) { r.status = "already"; return; }
      // No UID to compare (allowed in vCard 3.0): the same file name on the
      // target is taken as the same item, so a second run doesn't copy it again.
      if (!r.uid && tgtNames.has(safeDecode(it.name))) { r.status = "already"; return; }

      const type = got.contentType && /calendar|vcard|directory/i.test(got.contentType) ? got.contentType : defaultType;
      const fallback = `${safeSegment(r.uid ?? "") || `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}${ext}`;
      const first = tgtNames.has(safeDecode(it.name)) ? fallback : it.name;
      const tryNames = first === fallback ? [fallback] : [first, fallback];

      for (const name of tryNames) {
        const url = abs(name, target.url.replace(/\/?$/, "/"));
        const res = await put(url, got.body, type);
        if (res.status === 201 || res.status === 204) {
          r.status = "copied";
          if (safeDecode(name) !== safeDecode(it.name)) r.targetName = safeDecode(name);
          return;
        }
        if (res.status === 409 && /no-uid-conflict/i.test(res.text)) { r.status = "already"; return; }
        if (res.status === 412) {
          // Something already has this file name. The same item -> already there;
          // a different one -> try the UID-based name.
          const there = await request(target, "GET", url);
          if (there.status === 200 && r.uid && itemUid(there.text) === r.uid) { r.status = "already"; return; }
          r.reason = "a different item already has this file name on the target";
          continue;
        }
        // A file name the target won't take: try the UID-based one. Anything
        // else is about the item itself: report it.
        r.reason = shortReason(res.status, res.text);
        if (!(res.status === 400 || res.status === 403 || res.status === 404) || name === fallback) return;
      }
    } catch (e: any) {
      r.reason = `Network error: ${e?.message || e}`;
    } finally {
      if (r.status !== "failed") delete r.reason;
      results.push(r);
      done++;
      progress({ phase: "copying", done, total: srcItems.length });
    }
  });

  progress({ phase: "checking", done: srcItems.length, total: srcItems.length });
  const tgtAfter = await listItems(target, target.url);
  const afterUids = new Set<string>();
  const afterNames = new Set<string>(tgtAfter.map((t) => safeDecode(t.name)));
  for (const uid of (await itemUids(target, target.url, kind, tgtAfter)).values()) if (uid) afterUids.add(uid);

  let missing = 0;
  for (const r of results) {
    const there = r.uid ? afterUids.has(r.uid) : afterNames.has(r.targetName ?? r.name);
    if (!there) {
      missing++;
      if (r.status !== "failed") {
        r.status = "failed";
        r.reason = "not found on the target in the final check";
      }
    }
  }

  const count = (s: CopyItemResult["status"]) => results.filter((r) => r.status === s).length;
  progress({ phase: "done", done: srcItems.length, total: srcItems.length });
  return {
    kind,
    sourceUrl: source.url,
    targetUrl: target.url,
    sourceName: srcInfo.displayName ?? safeDecode(fileName(source.url)),
    createdTarget,
    sourceCount: srcItems.length,
    targetCountBefore: tgtBefore.length,
    targetCountAfter: tgtAfter.length,
    copied: count("copied"),
    already: count("already"),
    failed: count("failed"),
    missing,
    complete: missing === 0 && results.length === srcItems.length,
    items: results
      .filter((r) => r.status === "failed" || r.targetName)
      .sort((a, b) => a.name.localeCompare(b.name))
  };
}

export function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}
