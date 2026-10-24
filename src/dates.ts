// Date and time helpers shared by the desktop app and the Thunderbird add-on.
// Every view that shows a date, or turns a stored value into a Date, goes
// through here, so they all use the same locale and the same day rules.

// ---------- Locale ----------

let locale: string | null = null;

/** The locale for all date and time text: the one the runtime chose from the
 *  system settings ("en-US", "de-AT"). Looked up once, on first use. */
export function displayLocale(): string {
  if (locale === null) locale = Intl.DateTimeFormat().resolvedOptions().locale;
  return locale;
}

// ---------- First day of the week ----------

// Regions whose week doesn't start on Monday, by the day it does start on
// (0 = Sunday, 5 = Friday, 6 = Saturday). Only used when the engine has no
// week data of its own (Thunderbird's may not). Every other region starts on
// Monday. Regenerate with `node scripts/gen-week-start.mjs`.
// Generated 2026-10-21 by scripts/gen-week-start.mjs (Node 24.18.0, ICU 78.3).
const WEEK_START_FALLBACK: [day: number, regions: string][] = [
  [0, "AG AS BD BR BS BT BU BW BZ CA CO DM DO ET GT GU HK HN ID IL IN IS JM JP KE KH KR LA MH MM MO MT MX MZ NI NP PA PE PH PK PR PT PY RH SA SG SV TH TT TW UM US VE VI WS YD YE ZA ZW"],
  [5, "MV"],
  [6, "AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY"],
];

type WeekData = { firstDay: number };
type LocaleWithWeek = Intl.Locale & { getWeekInfo?: () => WeekData; weekInfo?: WeekData };

/** The engine's own week start for a locale, Sunday = 0, or null if it has no
 *  week data. Newer engines have getWeekInfo(), some older ones a weekInfo
 *  property; TypeScript's lib knows neither yet. */
function engineWeekStart(loc: LocaleWithWeek): number | null {
  const data = typeof loc.getWeekInfo === "function" ? loc.getWeekInfo() : loc.weekInfo;
  if (!data || typeof data.firstDay !== "number") return null;
  // Week data counts Monday = 1 through Sunday = 7.
  return data.firstDay === 7 ? 0 : data.firstDay;
}

function regionWeekStart(region: string | undefined): number {
  if (region) {
    for (const [day, regions] of WEEK_START_FALLBACK) {
      if (regions.split(" ").includes(region)) return day;
    }
  }
  return 1;
}

/** The day the calendar's week starts on, in the numbering the calendar
 *  library's `firstDay` option and `Date#getDay` both use:
 *  0 = Sunday, 1 = Monday, ... 6 = Saturday.
 *
 *  `override` is the user's manual choice from Settings → Calendars & Lists
 *  (0-6), when they've set one instead of following the OS/locale default —
 *  takes priority over everything below when present. */
export function weekStartDay(override?: number | null): number {
  if (override != null && override >= 0 && override <= 6) return override;

  let loc: LocaleWithWeek;
  try {
    // Fill in the likely region for a bare language ("ja" becomes ja-Jpan-JP),
    // since the week start depends on the region.
    loc = new Intl.Locale(displayLocale()).maximize();
  } catch {
    return 1;
  }
  return engineWeekStart(loc) ?? regionWeekStart(loc.region);
}

// ---------- Reading stored values ----------

/** True for an all-day value ("YYYY-MM-DD"); stored timestamps are longer. */
export function isAllDayValue(value: string): boolean {
  return value.length <= 10;
}

/** A stored date or timestamp as a Date in local time, or null when it's
 *  empty or can't be read.
 *
 *  An all-day "YYYY-MM-DD" must not go through `new Date()`: JavaScript reads
 *  that form as midnight UTC, which is still the previous day anywhere west
 *  of UTC (an all-day task due today showed yesterday and looked overdue).
 *  It's built from its parts instead, at local noon so a DST change at
 *  midnight can't move it either. Timestamps are stored in UTC and parse as is. */
export function readStoredDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  let date: Date;
  if (typeof value !== "string") {
    date = value;
  } else if (isAllDayValue(value)) {
    const parts = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
    if (!parts) return null;
    date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12);
  } else {
    date = new Date(value);
  }
  return isNaN(date.getTime()) ? null : date;
}

/** The local "YYYY-MM-DD" day a stored value falls on. Date-only values pass
 *  through unchanged. Datetimes are stored in UTC, so their own first ten
 *  characters are the UTC day -- for an evening time anywhere west of UTC that
 *  is already tomorrow (8 PM in New York in summer is 00:00 UTC the next day), which put
 *  timed tasks on the wrong day. Compare day keys from this instead. */
export function localDayKey(value: string): string {
  const d = readStoredDate(value);
  if (!d) return value.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** True when both Dates are on the same local calendar day. */
export function sameLocalDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

// ---------- Text for display ----------

// Intl formatters are slow to create and the task list formats a date on
// every row, so each one is made once, the first time it's used.
function lazy<T>(make: () => T): () => T {
  let made: T | undefined;
  return () => {
    if (made === undefined) made = make();
    return made;
  };
}

const shortDateFormat = lazy(() => new Intl.DateTimeFormat(displayLocale(), { month: "short", day: "numeric" }));
const timeFormat = lazy(() => new Intl.DateTimeFormat(displayLocale(), { hour: "numeric", minute: "2-digit" }));
const relativeFormat = lazy(() => new Intl.RelativeTimeFormat(displayLocale(), { numeric: "auto" }));

/** Month and day in the locale's order, no year: "Oct 21", "21. Okt.". */
export function shortDateLabel(value: Date | string | null | undefined): string {
  const date = readStoredDate(value);
  return date === null ? "" : shortDateFormat().format(date);
}

/** Time of day on the locale's clock: "2:30 PM" or "14:30". */
export function timeLabel(value: Date | string | null | undefined): string {
  const date = readStoredDate(value);
  return date === null ? "" : timeFormat().format(date);
}

/** Full date and time, as the locale writes it by default. */
export function dateTimeLabel(value: Date | string | null | undefined): string {
  const date = readStoredDate(value);
  return date === null ? "" : date.toLocaleString(displayLocale());
}

/** Days from today in words: "today", "tomorrow", "in 5 days", "yesterday". */
export function relativeDayLabel(days: number): string {
  return relativeFormat().format(days, "day");
}

/** The text with its first letter capitalized the locale's way, for a word
 *  shown on its own ("today" becomes "Today"). */
export function capitalize(text: string): string {
  const code = text.codePointAt(0);
  if (code === undefined) return text;
  const head = String.fromCodePoint(code);
  return head.toLocaleUpperCase(displayLocale()) + text.slice(head.length);
}
