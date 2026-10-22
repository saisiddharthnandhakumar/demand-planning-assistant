import type { EventTag, SkuInput } from "./types";

/** Tags that cover this SKU directly, by category, or by its distributor. */
export function tagsForSku(tags: readonly EventTag[], sku: SkuInput): EventTag[] {
  return tags.filter(
    (t) =>
      t.skuIds?.includes(sku.skuId) ||
      t.categories?.includes(sku.category) ||
      t.distributorIds?.includes(sku.distributorId),
  );
}

/** Weeks (from the given list) that fall inside any of the tags' week ranges. */
export function excludedWeeks(tags: readonly EventTag[], weeks: readonly string[]): Set<string> {
  // ISO week strings are zero padded, so string comparison orders them correctly.
  return new Set(
    weeks.filter((w) => tags.some((t) => w >= t.startWeek && w <= t.endWeek)),
  );
}
