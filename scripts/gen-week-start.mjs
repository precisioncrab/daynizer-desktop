// Prints the week-start fallback table for src/dates.ts: every region whose
// week doesn't start on Monday, grouped by the day it starts on. Reads the
// week data built into Node's ICU (Intl.Locale getWeekInfo), so run it with a
// current Node (24 or newer) and paste the output over the table in dates.ts.
//   node scripts/gen-week-start.mjs

const names = new Intl.DisplayNames(["en"], { type: "region" });
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const byDay = new Map(); // 0 = Sunday ... 6 = Saturday

for (const a of letters) {
  for (const b of letters) {
    const code = a + b;
    // DisplayNames echoes the code back for anything that isn't a real region.
    if (names.of(code) === code) continue;
    const info = new Intl.Locale(`und-${code}`).getWeekInfo();
    const day = info.firstDay % 7;
    if (day === 1) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(code);
  }
}

console.log(`// Generated ${new Date().toISOString().slice(0, 10)} by scripts/gen-week-start.mjs (Node ${process.versions.node}, ICU ${process.versions.icu}).`);
for (const [day, codes] of [...byDay].sort((x, y) => x[0] - y[0])) {
  console.log(`  [${day}, "${codes.join(" ")}"],`);
}
