// The guardrail for AI-written edge briefs. Pure.
//
// A brief is accepted only if EVERY number in it appears in the data the model
// was given, it stays within the word limit, and it does not recommend an action
// or a quantity. Anything else is replaced by the deterministic template brief.

export const MAX_BRIEF_WORDS = 80;

/** Spelled-out numbers, which would otherwise slip past a digits-only check. "one" and "zero" are left out: they are ordinary prose ("one-off", "no one"). */
const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, lakh: 100000, million: 1000000,
  dozen: 12, double: 2, doubled: 2, doubling: 2, twice: 2, twofold: 2, triple: 3, tripled: 3, tripling: 3, thrice: 3,
  threefold: 3, half: 0.5, halved: 0.5, halving: 0.5,
};

/** Numbers as digits: 1,234 and 1,00,000 and 261.0 and 36%. Signs are ignored. */
const DIGITS = /\d+(?:,\d{2,3})*(?:\.\d+)?|\.\d+/g;

/**
 * Every number in a piece of text, normalised to a JS number, including
 * spelled-out ones. The same function is used on the data given to the model
 * and on the model's brief, so identifiers like SKU001 or 2026-W42 are treated
 * the same way on both sides.
 */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(DIGITS)) out.push(Number(m[0].replace(/,/g, "")));
  for (const m of text.toLowerCase().matchAll(/\b[a-z]+\b/g)) {
    const n = NUMBER_WORDS[m[0]];
    if (n !== undefined) out.push(n);
  }
  return out;
}

/** The numbers present anywhere in the data: numeric values and any digits inside strings. */
export function numbersInData(data: unknown): Set<number> {
  const found = new Set<number>();
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      found.add(Math.abs(v));
      for (const n of extractNumbers(String(v))) found.add(n);
    } else if (typeof v === "string") {
      for (const n of extractNumbers(v)) found.add(n);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(data);
  return found;
}

/** Words that mean the brief is telling the planner what to do, which it must not. */
const ACTION_LANGUAGE = /\b(re-?order(?:s|ed|ing)?|recommend(?:s|ed|ing|ation|ations)?|should|must|ought|advis(?:e|es|ed|able)|suggest(?:s|ed|ion|ions)?|place an order|buy|purchase more|increase (?:the )?(?:order|stock)|decrease (?:the )?(?:order|stock)|pause (?:the )?order)\b/i;

export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export type BriefCheck = { ok: true } | { ok: false; reason: string };

export function checkBrief(brief: string, data: unknown): BriefCheck {
  const text = brief.trim();
  if (!text) return { ok: false, reason: "The brief is empty." };
  if (wordCount(text) > MAX_BRIEF_WORDS) return { ok: false, reason: `The brief is longer than ${MAX_BRIEF_WORDS} words.` };

  const action = ACTION_LANGUAGE.exec(text);
  if (action) return { ok: false, reason: `The brief gives advice ("${action[0]}"), which it must not.` };

  const allowed = numbersInData(data);
  const unknown = [...new Set(extractNumbers(text))].filter((n) => !allowed.has(n));
  if (unknown.length > 0) {
    return { ok: false, reason: `The brief contains number(s) that are not in the data: ${unknown.join(", ")}.` };
  }
  return { ok: true };
}
