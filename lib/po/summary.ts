import type { CreatePosResult } from "./create";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One plain sentence about what a purchase-order attempt did. Pure. */
export function summarizePoResult(r: CreatePosResult): { ok: boolean; message: string } {
  if (!r.ok) return { ok: false, message: r.error };
  const count = (k: string) => r.outcomes.filter((o) => o.result === k).length;
  const parts: string[] = [];
  if (count("created")) parts.push(`${plural(count("created"), "draft order")} created in Zoho`);
  if (count("dry_run")) parts.push(`${plural(count("dry_run"), "order")} prepared as a preview (nothing was sent to Zoho)`);
  if (count("already")) parts.push(`${plural(count("already"), "order")} already existed and was left alone`);
  if (count("in_progress")) parts.push(`${plural(count("in_progress"), "order")} waiting on an earlier request`);
  if (count("failed")) parts.push(`${plural(count("failed"), "order")} failed`);
  if (count("unknown")) parts.push(`${plural(count("unknown"), "order")} with an unclear answer from Zoho: check Zoho before retrying`);
  if (r.skipped.length) parts.push(`${plural(r.skipped.length, "line")} skipped for want of a vendor mapping`);
  if (parts.length === 0) return { ok: true, message: "Nothing to order in this run." };
  const bad = count("failed") + count("unknown") + r.skipped.length > 0;
  return { ok: !bad, message: `${parts.join("; ")}.` };
}
