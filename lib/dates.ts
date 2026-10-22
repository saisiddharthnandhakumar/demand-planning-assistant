// Pure date helpers for ISO weeks and Excel serial dates. All dates are handled
// in UTC as "YYYY-MM-DD" strings to avoid time-zone surprises.

const DAY_MS = 86_400_000;

export type IsoWeek = { year: number; week: number };

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function formatIsoWeek({ year, week }: IsoWeek): string {
  return `${year}-W${pad(week)}`;
}

/** Parses "2026-W27". Returns null if it is not a real ISO week. */
export function parseIsoWeek(value: string): IsoWeek | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const parsed = { year: Number(m[1]), week: Number(m[2]) };
  if (parsed.week < 1 || parsed.week > 53) return null;
  // Week 53 only exists in some years; round-trip catches that.
  const back = isoWeekOfDate(isoWeekStart(parsed));
  return back.year === parsed.year && back.week === parsed.week ? parsed : null;
}

/** Monday of the given ISO week, as "YYYY-MM-DD". */
export function isoWeekStart({ year, week }: IsoWeek): string {
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7; // Monday = 0
  const week1Monday = jan4 - jan4Dow * DAY_MS;
  return toIsoDate(new Date(week1Monday + (week - 1) * 7 * DAY_MS));
}

/** ISO week (year and number) that contains the given "YYYY-MM-DD" date. */
export function isoWeekOfDate(date: string): IsoWeek {
  const d = fromIsoDate(date);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  // The Thursday of this week decides the ISO year.
  const thursday = new Date(d.getTime() + (3 - dow) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / DAY_MS / 7) + 1;
  return { year, week };
}

/** Moves an ISO week by n weeks (negative goes back). */
export function shiftIsoWeek(w: IsoWeek, n: number): IsoWeek {
  const start = fromIsoDate(isoWeekStart(w));
  return isoWeekOfDate(toIsoDate(new Date(start.getTime() + n * 7 * DAY_MS)));
}

/** Excel serial date (1900 system) to "YYYY-MM-DD". */
export function excelSerialToIsoDate(serial: number): string {
  return toIsoDate(new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * DAY_MS));
}

export function toIsoDate(d: Date): string {
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fromIsoDate(date: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function isValidIsoDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  return toIsoDate(fromIsoDate(date)) === date;
}
