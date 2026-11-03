// Checks for the add-on's Thunderbird address books (Manifest V2, 0.9.0):
// thunderbird-patch.test.ts (what the contact editor's save writes into a
// Thunderbird vCard 4.0), thunderbird-write.test.ts (reads and writes
// against a fake Manifest V2 browser.contacts, one UID in two books),
// thunderbird-copies.test.ts (Clean up > In several books on Thunderbird's
// books, through history.js, mailing lists and undo included) and
// thunderbird-lists.test.ts (Thunderbird mailing lists loaded, a list made a
// label and deleted, then undone) and thunderbird-list-move.test.ts (a list's
// members moved into another address book, Thunderbird's or Daynizer's, then undone) and
// thunderbird-hidden-move.test.ts (a book moved out when some contacts share an ID with a hidden book).
// Run: node scripts/test-thunderbird-books.mjs
// Each test is bundled with Rolldown (Vite 8's own bundler) into a temp folder, then run.
import { build } from "rolldown";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const here = import.meta.dirname;
const out = mkdtempSync(join(tmpdir(), "daynizer-tb-test-"));
let failed = false;
try {
  for (const name of ["thunderbird-patch.test.ts", "thunderbird-write.test.ts", "thunderbird-copies.test.ts", "thunderbird-lists.test.ts", "thunderbird-list-move.test.ts", "thunderbird-hidden-move.test.ts"]) {
    const file = join(out, name.replace(/\.ts$/, ".mjs"));
    await build({ input: resolve(here, name), platform: "node", logLevel: "warn", output: { file, format: "esm" } });
    console.log(`\n== ${name}`);
    const run = spawnSync(process.execPath, [file], { stdio: "inherit" });
    if (run.status !== 0) failed = true;
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
