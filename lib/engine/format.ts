/** Whole-number percentage of a fraction: 0.214 -> 21. */
export const pct = (fraction: number) => Math.round(fraction * 100);

/** One decimal place. */
export const num1 = (n: number) => n.toFixed(1);
