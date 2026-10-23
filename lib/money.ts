// Quarters and rupee helpers for the manual "money card". Pure.
//
// Quarters are CALENDAR quarters (Jan-Mar = Q1 ... Oct-Dec = Q4), labelled with
// their months so nobody has to guess whether a financial-year convention is meant.

export interface Quarter {
  year: number;
  q: 1 | 2 | 3 | 4;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Quarters that may be entered on the money card: the current calendar quarter and the seven before it. */
export const ENTRY_QUARTER_COUNT = 8;

export const quarterKey = ({ year, q }: Quarter) => `${year}-Q${q}`;

export function parseQuarterKey(key: string): Quarter | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  return m ? { year: Number(m[1]), q: Number(m[2]) as Quarter["q"] } : null;
}

/** Calendar quarter of a "YYYY-MM-DD" date. */
export function quarterOfDate(isoDate: string): Quarter {
  const month = Number(isoDate.slice(5, 7));
  return { year: Number(isoDate.slice(0, 4)), q: (Math.floor((month - 1) / 3) + 1) as Quarter["q"] };
}

export function previousQuarter({ year, q }: Quarter): Quarter {
  return q === 1 ? { year: year - 1, q: 4 } : { year, q: (q - 1) as Quarter["q"] };
}

/** The current quarter and the ones before it, newest first. */
export function recentQuarters(current: Quarter, count: number): Quarter[] {
  const out: Quarter[] = [current];
  while (out.length < count) out.push(previousQuarter(out[out.length - 1]));
  return out;
}

/** "Oct–Dec 2026" */
export function quarterLabel({ year, q }: Quarter): string {
  const first = (q - 1) * 3;
  return `${MONTHS[first]}–${MONTHS[first + 2]} ${year}`;
}

/** The calendar months (1-12) a quarter covers. */
export const quarterMonths = ({ q }: Quarter): number[] => [1, 2, 3].map((i) => (q - 1) * 3 + i);

/** Today's date in IST as "YYYY-MM-DD", whatever the server's time zone. */
export function todayInIst(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

// ---------------------------------------------------------------------------
// Rupees
// ---------------------------------------------------------------------------

export const MAX_RUPEES = 100_000_000_000; // a typo guard (10,000 crore)

/** "₹18,50,000" (Indian digit grouping). */
export function formatInr(rupees: number): string {
  const sign = rupees < 0 ? "-" : "";
  return `${sign}₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.abs(rupees))}`;
}

/** "18.50 lakh" */
export function formatLakh(rupees: number): string {
  return `${(Math.abs(rupees) / 100_000).toFixed(2)} lakh`;
}

/**
 * Parses an amount typed by a person: "1850000", "18,50,000", "₹ 18,50,000".
 * Whole rupees only. Returns null for anything else (blank, decimals, negative, absurd).
 */
export function parseRupees(text: string): number | null {
  const cleaned = text.replace(/[₹\s,]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) && n <= MAX_RUPEES ? n : null;
}

// ---------------------------------------------------------------------------
// "Rs vs last quarter"
// ---------------------------------------------------------------------------

export interface QuarterLoss {
  stockoutLossInr: number;
  writeoffLossInr: number;
}

export const totalLoss = (l: QuarterLoss) => l.stockoutLossInr + l.writeoffLossInr;

export type LossComparison =
  | { status: "ok"; lastTotal: number; thisTotal: number; /** last minus this: positive means less loss than last quarter */ diff: number; direction: "better" | "worse" | "same" }
  | { status: "missing"; missing: ("last" | "this")[] };

/** Rs vs last quarter = last quarter's total loss minus this quarter's total loss. */
export function compareLoss(last: QuarterLoss | null | undefined, current: QuarterLoss | null | undefined): LossComparison {
  const missing: ("last" | "this")[] = [];
  if (!last) missing.push("last");
  if (!current) missing.push("this");
  if (!last || !current) return { status: "missing", missing };
  const lastTotal = totalLoss(last);
  const thisTotal = totalLoss(current);
  const diff = lastTotal - thisTotal;
  return { status: "ok", lastTotal, thisTotal, diff, direction: diff > 0 ? "better" : diff < 0 ? "worse" : "same" };
}
