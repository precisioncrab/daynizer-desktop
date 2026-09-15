// Built-in sync server (Phase B2 + B3/C3 config surface) — supervise the bundled,
// PyInstaller-frozen Radicale binary as a child of the Electron main process, and
// expose the knobs the Settings "Sync Server" pane needs.
//
// B2 (done): locate the frozen binary, pick+persist a port, generate config +
//   bcrypt htpasswd, spawn/supervise (health-check, auto-restart, clean shutdown),
//   decoupled from the window.
// B3/C3 (this file adds): a user enable toggle, a user-settable fixed port
//   (default 5232 so external clients like DAVx5 / Tasks.org have a stable target),
//   editable credentials (rotate the password live; changing the username is the
//   guarded "start fresh" path since Radicale stores data under /<username>/), a
//   "configured" flag that drives the first-run setup card, and connection-info
//   accessors (one base URL serves both CalDAV and CardDAV).
//
// Still gated behind SERVER_BUILTIN: with it off, init() is a no-op and getStatus()
// reports feature:false so no server UI appears. Mirrors ../src/featureFlags.ts.

import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, X509Certificate } from "node:crypto";
import bcrypt from "bcryptjs";
// Pure-JS self-signed cert generator (wraps node-forge). Used to give the
// bundled server a TLS cert so external clients (Tasks.org direct CalDAV on
// modern Android) will talk to it — plain HTTP is refused there as "cleartext
// communication not permitted". See C4 in NEXT.md.
import selfsigned from "selfsigned";
import { settingsAll, settingSet } from "./db.js";

/** Master switch for the built-in server. OFF until B2/B3 are proven end-to-end.
 *  Flip to true, rebuild, and test one slice at a time (see the plan).
 *  TEMPORARILY ON for B2/B3 testing (2026-09-12) — set back to false before cutting
 *  any release until the server work is signed off. */
export const SERVER_BUILTIN = true;

// ---- persisted settings keys (stored in the same settings table as the rest) ----
const KEY_PORT = "serverPort";           // user's PREFERRED port (default 5232)
const KEY_USER = "serverUser";           // sync-account username
const KEY_PASS = "serverPassword";       // sync-account password (LAN-only)
const KEY_ENABLED = "serverEnabled";     // user toggle: run the server? default "1"
const KEY_CONFIGURED = "serverConfigured"; // "1" once the first-run card is dismissed

const DEFAULT_USER = "daynizer";
const DEFAULT_PORT = 5232; // Radicale's standard port — predictable for external clients

export type ServerStatus = {
  feature: boolean;        // compiled-in (SERVER_BUILTIN)
  enabled: boolean;        // user wants it running (KEY_ENABLED)
  available: boolean;      // frozen binary present for this platform
  running: boolean;        // child spawned AND passed a health check
  configured: boolean;     // first-run setup card dismissed
  port: number | null;     // the port actually bound right now
  preferredPort: number;   // the port the user asked for (may differ if it was taken)
  baseUrl: string | null;  // LAN-facing URL (best-guess IPv4) — give this to phones/other apps
  localUrl: string | null; // 127.0.0.1 URL — for another client on THIS machine
  username: string;
  error: string | null;    // last fatal-ish error, or null
  note: string | null;     // non-fatal note (e.g. preferred port was in use)
  lastActivity: number | null; // epoch ms of the last request from a non-loopback client, or null
  platform: NodeJS.Platform; // so the UI can show OS-specific controls (firewall on Windows)
};

export type ServerInfo = ServerStatus & { password: string };

type Deps = {
  /** Append a line to the app's shared log (main passes syncLog from caldav.ts). */
  log: (line: string) => void;
  /** Called whenever status changes, so main can refresh the tray + notify the renderer. */
  onStatus: (status: ServerStatus) => void;
};

// Crash-loop guard: if the child dies more than MAX_RESTARTS times inside
// RESTART_WINDOW_MS, stop trying and surface an error instead of hot-looping.
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;
const RESTART_DELAY_MS = 1_000;
const HEALTH_TIMEOUT_MS = 20_000;
const HEALTH_POLL_MS = 500;

class ServerManager {
  private deps: Deps | null = null;
  private child: ChildProcess | null = null;
  private port: number | null = null;
  private running = false;
  private stopping = false;        // set while an intentional stop is in flight
  private error: string | null = null;
  private note: string | null = null;
  private restartTimes: number[] = [];
  private starting = false;
  private lastActivity: number | null = null; // last request from a non-loopback client

  private tls = false;             // true once a run comes up on HTTPS (else HTTP fallback)

  // Resolved lazily once app paths are known.
  private get dataDir() { return path.join(app.getPath("userData"), "sync-server"); }
  private get configPath() { return path.join(this.dataDir, "config"); }
  private get usersPath() { return path.join(this.dataDir, "users"); }
  private get collectionsDir() { return path.join(this.dataDir, "collections"); }
  private get certPath() { return path.join(this.dataDir, "cert.pem"); }
  private get keyPath() { return path.join(this.dataDir, "key.pem"); }

  private log(line: string) { this.deps?.log(`[server] ${line}`); }

  /** Absolute path to the frozen binary, or null if it isn't shipped for this
   *  platform/build. Packaged: process.resourcesPath/daynizer-radicale/<exe>.
   *  Dev/unpackaged: <repo>/server/dist/daynizer-radicale/<exe> (the freeze output). */
  private binaryPath(): string | null {
    const exe = process.platform === "win32" ? "daynizer-radicale.exe" : "daynizer-radicale";
    const candidates = app.isPackaged
      ? [path.join(process.resourcesPath, "daynizer-radicale", exe)]
      : [path.join(app.getAppPath(), "server", "dist", "daynizer-radicale", exe)];
    for (const c of candidates) {
      try { if (fs.statSync(c).isFile()) return c; } catch { /* keep looking */ }
    }
    return null;
  }

  /** Absolute path to the frozen server binary (or null). Public so main can
   *  build a program-scoped Windows Firewall rule for it (C2). */
  getBinaryPath(): string | null { return this.binaryPath(); }

  /** Compile flag — the tray/UI use this to decide whether to show server controls. */
  isEnabled() { return SERVER_BUILTIN; }
  /** User toggle (defaults ON). Independent of the compile flag. Public so the
   *  window/close logic can decide whether to stay resident (headless) on close. */
  isUserEnabled() { return this.userWantsServer(); }
  private userWantsServer() { return getSetting(KEY_ENABLED) !== "0"; }
  isConfigured() { return getSetting(KEY_CONFIGURED) === "1"; }
  private preferredPort() { return Number(getSetting(KEY_PORT)) || DEFAULT_PORT; }

  /** URL scheme the server is currently reachable on ("https" once TLS is up,
   *  "http" while it isn't running yet or after a graceful TLS fallback). */
  private scheme() { return this.tls ? "https" : "http"; }

  getStatus(): ServerStatus {
    const running = this.running && this.port != null;
    return {
      feature: SERVER_BUILTIN,
      enabled: this.userWantsServer(),
      available: this.binaryPath() !== null,
      running: this.running,
      configured: this.isConfigured(),
      port: this.port,
      preferredPort: this.preferredPort(),
      baseUrl: running ? `${this.scheme()}://${lanIp()}:${this.port}/` : null,
      localUrl: running ? `${this.scheme()}://127.0.0.1:${this.port}/` : null,
      username: getSetting(KEY_USER) || DEFAULT_USER,
      error: this.error,
      note: this.note,
      lastActivity: this.lastActivity,
      platform: process.platform
    };
  }

  /** Like getStatus() but includes the generated password. Fetched on demand
   *  (never broadcast in the status event) for the Settings pane / pairing. */
  getInfo(): ServerInfo {
    return { ...this.getStatus(), password: this.ensureCredentials().password };
  }

  private emit() { this.deps?.onStatus(this.getStatus()); }

  /** Called once from app.whenReady(). Starts the server if the flag is on AND the
   *  user hasn't turned it off. */
  async init(deps: Deps): Promise<void> {
    this.deps = deps;
    if (!SERVER_BUILTIN) { this.log("feature flag off — not starting"); return; }
    if (!this.userWantsServer()) { this.log("disabled by user setting — not starting"); this.emit(); return; }
    await this.start();
  }

  /** Ensure a persisted username + password exist; generate them once. Returns them. */
  private ensureCredentials(): { user: string; password: string } {
    let user = getSetting(KEY_USER);
    if (!user) { user = DEFAULT_USER; settingSet(KEY_USER, user); }
    let password = getSetting(KEY_PASS);
    if (!password) {
      // URL-safe, ~22 chars of entropy. Only ever used on the LAN against this
      // machine's own server; stored so the account/QR can be reconstructed.
      password = randomBytes(16).toString("base64url");
      settingSet(KEY_PASS, password);
    }
    return { user, password };
  }

  /** Write the bcrypt htpasswd users file (single account). Overwrites — the
   *  built-in server has exactly one auto-generated user. */
  private writeUsersFile(user: string, password: string) {
    const hash = bcrypt.hashSync(password, 10); // $2a$ — Radicale's bcrypt htpasswd reads it
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.usersPath, `${user}:${hash}\n`, { encoding: "utf8", mode: 0o600 });
  }

  /** Render config.template's placeholders and write the runtime config file.
   *  Kept in sync with server/config.template (the canonical, hand-test copy).
   *  When `tls` is set, Radicale serves HTTPS with the generated self-signed
   *  cert/key (C4); when null it stays on plain HTTP (graceful fallback). */
  private writeConfig(port: number, tls: { certPath: string; keyPath: string } | null) {
    fs.mkdirSync(this.collectionsDir, { recursive: true });
    // Forward slashes work on Windows Python and sidestep any backslash/`%`
    // escaping questions in Radicale's configparser.
    const fwd = (p: string) => p.replace(/\\/g, "/");
    const server = [
      "[server]",
      `hosts = 0.0.0.0:${port}`,
    ];
    if (tls) {
      server.push(
        "ssl = True",
        `certificate = ${fwd(tls.certPath)}`,
        `key = ${fwd(tls.keyPath)}`,
      );
    }
    const config = [
      ...server,
      "[auth]",
      "type = htpasswd",
      `htpasswd_filename = ${fwd(this.usersPath)}`,
      "htpasswd_encryption = bcrypt",
      "[storage]",
      `filesystem_folder = ${fwd(this.collectionsDir)}`,
      "[rights]",
      "type = owner_only",
      "[logging]",
      "level = info",
      ""
    ].join("\n");
    fs.writeFileSync(this.configPath, config, "utf8");
  }

  /** Ensure a self-signed cert + key exist on disk (generating them once, with a
   *  multi-year lifetime), and return their paths. Regenerates when either file
   *  is missing or the cert is within 30 days of expiry. SANs cover localhost,
   *  127.0.0.1 and the current LAN IP so clients reach it by any of those.
   *  Returns null (and leaves the server on HTTP) if generation fails for any
   *  reason — never throws, so a cert problem can't brick the server. */
  private ensureCert(): { certPath: string; keyPath: string } | null {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      let needGen = true;
      if (fs.existsSync(this.certPath) && fs.existsSync(this.keyPath)) {
        try {
          const x = new X509Certificate(fs.readFileSync(this.certPath));
          // validTo is a parseable date string; regenerate ~30 days before expiry.
          const expMs = Date.parse(x.validTo);
          needGen = !Number.isFinite(expMs) || expMs - Date.now() < 30 * 24 * 60 * 60 * 1000;
        } catch {
          needGen = true; // unreadable/corrupt — regenerate
        }
      }
      if (needGen) {
        const ip = lanIp();
        const altNames: Array<{ type: number; value?: string; ip?: string }> = [
          { type: 2, value: "localhost" }, // DNS
          { type: 7, ip: "127.0.0.1" },    // IP
        ];
        if (ip && ip !== "127.0.0.1") altNames.push({ type: 7, ip });
        const pems = selfsigned.generate(
          [{ name: "commonName", value: "Daynizer Sync Server" }],
          {
            days: 3650, // ~10 years; clients trust-on-first-use, so a long life avoids churn
            keySize: 2048,
            algorithm: "sha256",
            extensions: [
              { name: "basicConstraints", cA: false },
              {
                name: "keyUsage",
                digitalSignature: true,
                keyEncipherment: true,
              },
              { name: "extKeyUsage", serverAuth: true },
              { name: "subjectAltName", altNames },
            ],
          }
        );
        fs.writeFileSync(this.certPath, pems.cert, { encoding: "utf8", mode: 0o600 });
        fs.writeFileSync(this.keyPath, pems.private, { encoding: "utf8", mode: 0o600 });
        this.log(`generated self-signed cert (SAN: localhost, 127.0.0.1${ip && ip !== "127.0.0.1" ? `, ${ip}` : ""})`);
      }
      return { certPath: this.certPath, keyPath: this.keyPath };
    } catch (err: any) {
      this.log(`cert generation failed (${err?.message || err}) — falling back to HTTP`);
      return null;
    }
  }

  /** Pick the user's preferred port if free, else grab a fresh ephemeral one for
   *  this run (WITHOUT overwriting the preference, so next launch retries it). */
  private async choosePort(): Promise<number> {
    const preferred = this.preferredPort();
    if (await isPortFree(preferred)) { this.note = null; return preferred; }
    const fresh = await ephemeralPort();
    this.note = `Preferred port ${preferred} is in use — using ${fresh} for now.`;
    this.log(this.note);
    return fresh;
  }

  /** Spawn + supervise the frozen server. Idempotent: a no-op if already running. */
  async start(): Promise<void> {
    if (!SERVER_BUILTIN || !this.userWantsServer()) return;
    if (this.child || this.starting) return;
    this.starting = true;
    this.stopping = false;
    this.error = null;
    try {
      const bin = this.binaryPath();
      if (!bin) {
        this.error = "binary-not-found";
        this.log("frozen server binary not found for this platform — server unavailable");
        this.emit();
        return;
      }
      const { user, password } = this.ensureCredentials();
      this.port = await this.choosePort();
      this.writeUsersFile(user, password);
      // TLS on by default; ensureCert() returns null (→ plain HTTP) only if cert
      // generation fails, so a broken cert can never stop the server starting.
      const cert = this.ensureCert();
      this.tls = cert !== null;
      this.writeConfig(this.port, cert);

      if (process.platform !== "win32") {
        // extraResources can drop the exec bit through .deb/.dmg packaging;
        // without this the first launch after install fails with EACCES.
        try { fs.chmodSync(bin, 0o755); } catch { /* best-effort */ }
      }

      this.log(`spawning ${path.basename(bin)} on 0.0.0.0:${this.port} (user ${user}, ${this.tls ? "https" : "http"})`);
      const child = spawn(bin, ["--config", this.configPath], {
        cwd: path.dirname(bin),   // onedir: keep the launcher next to its _internal
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: false           // dies with the parent as a safety net
      });
      this.child = child;

      child.stdout?.on("data", (b) => this.forwardLog(b));
      child.stderr?.on("data", (b) => this.forwardLog(b));
      child.on("error", (err) => {
        this.error = String((err as any)?.message || err);
        this.log(`spawn error: ${this.error}`);
        this.emit();
      });
      child.on("exit", (code, signal) => this.onChildExit(code, signal));

      const healthy = await this.waitForHealthy(this.port);
      this.running = healthy;
      if (healthy) { this.log(`ready — serving on :${this.port}`); }
      else { this.error = this.error || "health-check-timeout"; this.log("health check timed out"); }
      this.emit();
    } finally {
      this.starting = false;
    }
  }

  private forwardLog(buf: Buffer) {
    const text = buf.toString("utf8").trim();
    if (!text) return;
    for (const line of text.split(/\r?\n/)) {
      this.log(`radicale: ${line}`);
      // Best-effort "last device sync" signal: a request logged with a client IP
      // that isn't loopback means another device (a phone, another computer) hit
      // the server. Depends on Radicale logging client IPs; harmless if it doesn't.
      const m = line.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
      if (m && !m[1].startsWith("127.") && m[1] !== "0.0.0.0") {
        const prev = this.lastActivity;
        this.lastActivity = Date.now();
        if (!prev || this.lastActivity - prev > 30_000) this.emit(); // throttle tray refresh
      }
    }
  }

  private onChildExit(code: number | null, signal: NodeJS.Signals | null) {
    this.child = null;
    this.running = false;
    if (this.stopping) { this.log("stopped"); this.emit(); return; }

    // Unexpected exit — auto-restart with a crash-loop guard.
    this.log(`exited unexpectedly (code=${code} signal=${signal}) — will restart`);
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter((t) => now - t < RESTART_WINDOW_MS);
    this.restartTimes.push(now);
    if (this.restartTimes.length > MAX_RESTARTS) {
      this.error = "crash-loop";
      this.log(`too many restarts (${this.restartTimes.length}) in ${RESTART_WINDOW_MS / 1000}s — giving up`);
      this.emit();
      return;
    }
    this.emit();
    setTimeout(() => { if (!this.stopping && SERVER_BUILTIN && this.userWantsServer()) this.start(); }, RESTART_DELAY_MS);
  }

  /** Poll GET / until the server answers with any HTTP status (Radicale replies
   *  302 to `/`, 401 to unauthenticated DAV), or the timeout elapses. */
  private waitForHealthy(port: number): Promise<boolean> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    return new Promise((resolve) => {
      const useTls = this.tls;
      const tick = () => {
        if (this.stopping) return resolve(false);
        pingHttp(port, useTls).then((ok) => {
          if (ok) return resolve(true);
          if (Date.now() >= deadline) return resolve(false);
          setTimeout(tick, HEALTH_POLL_MS);
        });
      };
      tick();
    });
  }

  /** Intentional stop (app quit, user toggle, or a config change that needs a
   *  restart). Kills the child and waits briefly for it to exit. */
  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) { this.running = false; this.emit(); return; }
    this.log("stopping…");
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      child.once("exit", finish);
      try { child.kill(); } catch { /* already gone */ }
      // Windows: a stubborn child gets a hard kill after a grace period.
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* noop */ } finish(); }, 3_000);
    });
    this.child = null;
    this.running = false;
    this.emit();
  }

  async restart(): Promise<void> {
    await this.stop();
    this.stopping = false;
    this.restartTimes = [];
    await this.start();
  }

  // ------------------------- config surface (B3/C3) -------------------------

  /** Turn the built-in server on/off (persisted). Starts or stops the child. */
  async setEnabled(on: boolean): Promise<ServerStatus> {
    settingSet(KEY_ENABLED, on ? "1" : "0");
    if (on) { await this.start(); }
    else { await this.stop(); }
    this.emit();
    return this.getStatus();
  }

  /** Change the preferred port and restart onto it. Falls back to a free port at
   *  start() if the chosen one is taken (surfaced via status.note). */
  async setPort(port: number): Promise<ServerStatus> {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error("Port must be a whole number between 1024 and 65535.");
    }
    settingSet(KEY_PORT, String(port));
    if (this.userWantsServer()) await this.restart();
    else this.emit();
    return this.getStatus();
  }

  /** Update credentials. Password-only is a live rotation. Changing the username
   *  is the "start fresh" path — Radicale stores each user's data under
   *  /<username>/, so the old collections are left behind and the client sees an
   *  empty home under the new name (the caller/UI is responsible for warning). */
  async setCredentials(opts: { username?: string; password?: string }): Promise<ServerStatus> {
    const username = (opts.username ?? "").trim();
    const password = opts.password ?? "";
    // Remember the outgoing username so a first-run change can clean up the
    // storage the previous user left behind (see purgeUserStorage below).
    const previousUser = getSetting(KEY_USER) || DEFAULT_USER;
    let usernameChanged = false;
    if (opts.username !== undefined) {
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(username)) {
        throw new Error("Username may use letters, numbers, dot, dash and underscore (max 64).");
      }
      usernameChanged = username !== previousUser;
      settingSet(KEY_USER, username);
    }
    if (opts.password !== undefined) {
      if (password.length < 4) throw new Error("Password must be at least 4 characters.");
      settingSet(KEY_PASS, password);
    }
    // Rewrite the users file with the effective creds, then restart so a username
    // change re-homes the client onto the new principal.
    const { user, password: pw } = this.ensureCredentials();
    this.writeUsersFile(user, pw);
    if (this.userWantsServer()) await this.restart();
    else this.emit();
    // During first-run setup the username may be changed on the setup card. That
    // re-homes the client to /<newuser>/ and auto-provisions fresh Calendar +
    // Contacts there, but Radicale keeps the old user's collections on disk under
    // collection-root/<previousUser>/ — and with owner_only rights the client,
    // now authenticated as the new user, can never reach them over CalDAV to
    // remove them. So they linger as an orphaned collection-root/<previousUser>/
    // beside the live user. Delete that directory directly from storage. Gated on
    // first-run (never configured): the old collections there are just the empty
    // auto-provisioned defaults, so this can't touch data from a deliberate later
    // "start fresh" (whose documented behavior is to leave the old data behind).
    // Done AFTER the restart so the server is no longer serving the old principal
    // (no open file handles on that tree to block the delete on Windows).
    if (usernameChanged && !this.isConfigured()) {
      this.purgeUserStorage(previousUser);
    }
    return this.getStatus();
  }

  /** Remove one Radicale user's on-disk collection tree
   *  (collection-root/<user>/). Best-effort and never throws — a cleanup failure
   *  must not break a credential change. The username is validated against the
   *  same charset setCredentials enforces (no slashes / dots-only / traversal) so
   *  the join can't escape the collections directory. */
  private purgeUserStorage(user: string): void {
    try {
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(user) || user === "." || user === "..") return;
      const dir = path.join(this.collectionsDir, "collection-root", user);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        this.log(`removed orphaned storage for previous user "${user}"`);
      }
    } catch (err: any) {
      this.log(`could not remove old user storage "${user}": ${err?.message || err}`);
    }
  }

  /** Generate a fresh strong password (returns it via the resulting info). */
  async regeneratePassword(): Promise<ServerInfo> {
    const password = randomBytes(16).toString("base64url");
    await this.setCredentials({ password });
    return this.getInfo();
  }

  /** Mark the first-run setup card as dismissed so it doesn't show again. */
  markConfigured(): ServerStatus {
    settingSet(KEY_CONFIGURED, "1");
    this.emit();
    return this.getStatus();
  }
}

// ----------------------------- helpers -----------------------------

/** Read one setting from the shared settings table. Kept local so this module
 *  doesn't depend on main.ts's SETTING_DEFAULTS. */
function getSetting(key: string): string {
  try { return settingsAll()[key] ?? ""; } catch { return ""; }
}

/** First non-internal IPv4 address, for a LAN-facing base URL (phone pairing).
 *  Falls back to 127.0.0.1 when offline / no LAN NIC. */
function lanIp(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return "127.0.0.1";
}

/** True if we can bind 0.0.0.0:<port> right now (i.e. it's free). */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "0.0.0.0");
  });
}

/** Ask the OS for a free ephemeral port on 0.0.0.0. */
function ephemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "0.0.0.0", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no ephemeral port"))));
    });
  });
}

/** Resolve true if 127.0.0.1:<port> returns ANY HTTP(S) response. Over HTTPS the
 *  server's cert is self-signed, so verification is disabled for this loopback
 *  health probe (rejectUnauthorized:false). */
function pingHttp(port: number, tls: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const opts = { host: "127.0.0.1", port, path: "/", timeout: 2_000 };
    const req = tls
      ? https.get({ ...opts, rejectUnauthorized: false }, (res) => { res.resume(); resolve(true); })
      : http.get(opts, (res) => { res.resume(); resolve(true); });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

export const serverManager = new ServerManager();
