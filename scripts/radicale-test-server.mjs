// Throwaway Radicale servers for tests: each gets its own temp folder, plain-text
// htpasswd users, owner_only rights, a free port on 127.0.0.1 and plain http.
// Uses the frozen bundled server (server/dist/daynizer-radicale) when it's
// there, else server/.venv's radicale. Never points at a real server.
//
//   const srv = await startRadicale({ users: { src: "pw" }, maxContentLength: 20000 });
//   srv.url  -> "http://127.0.0.1:PORT/"  (tls: true -> "https://", self-signed)
//   await srv.stop();
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import selfsigned from "selfsigned";

const root = resolve(import.meta.dirname, "..");
const exe = process.platform === "win32" ? ".exe" : "";
const frozen = join(root, "server", "dist", "daynizer-radicale", `daynizer-radicale${exe}`);
const venvRadicale = join(root, "server", ".venv", process.platform === "win32" ? "Scripts" : "bin", `radicale${exe}`);

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.unref();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

async function waitUp(port, ms = 15000) {
  const { connect } = await import("node:net");
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const up = await new Promise((r) => {
      const s = connect(port, "127.0.0.1", () => { s.destroy(); r(true); });
      s.on("error", () => r(false));
    });
    if (up) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Radicale did not start on port ${port}`);
}

export async function startRadicale({ users, maxContentLength, tls } = {}) {
  const bin = existsSync(frozen) ? frozen : venvRadicale;
  if (!existsSync(bin)) throw new Error("No Radicale found: build server/dist or create server/.venv");
  const dir = mkdtempSync(join(tmpdir(), "daynizer-radicale-test-"));
  const coll = join(dir, "collections");
  mkdirSync(coll);
  const usersFile = join(dir, "users");
  writeFileSync(usersFile, Object.entries(users || { test: "test" }).map(([u, p]) => `${u}:${p}`).join("\n") + "\n");
  const port = await freePort();
  const tlsLines = [];
  if (tls) {
    const pems = selfsigned.generate([{ name: "commonName", value: "Daynizer test" }], {
      days: 2, keySize: 2048, algorithm: "sha256",
      extensions: [{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] }]
    });
    writeFileSync(join(dir, "cert.pem"), pems.cert);
    writeFileSync(join(dir, "key.pem"), pems.private);
    tlsLines.push("ssl = True", `certificate = ${join(dir, "cert.pem")}`, `key = ${join(dir, "key.pem")}`);
  }
  const config = join(dir, "config");
  writeFileSync(config, [
    "[server]",
    `hosts = 127.0.0.1:${port}`,
    ...(maxContentLength ? [`max_content_length = ${maxContentLength}`] : []),
    ...tlsLines,
    "[auth]",
    "type = htpasswd",
    `htpasswd_filename = ${usersFile}`,
    "htpasswd_encryption = plain",
    "[storage]",
    `filesystem_folder = ${coll}`,
    "[rights]",
    "type = owner_only",
    "[logging]",
    "level = warning",
    ""
  ].join("\n"));
  const child = spawn(bin, ["--config", config], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  const url = `${tls ? "https" : "http"}://127.0.0.1:${port}/`;
  try {
    await waitUp(port);
  } catch (e) {
    child.kill();
    throw new Error(`${e.message}\n${stderr}`);
  }
  return {
    url,
    dir,
    get log() { return stderr; },
    async stop() {
      if (child.exitCode == null) {
        await new Promise((r) => { child.once("exit", r); child.kill(); });
      }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
    }
  };
}
