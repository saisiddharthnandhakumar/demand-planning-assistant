import { tagsForSku } from "@/lib/engine/events";
import type { EngineInput, EngineItem, EngineResult } from "@/lib/engine/types";
import { buildBriefInput, templateBrief, type BriefInput } from "@/lib/gemini/brief";
import type { GeminiTransport } from "@/lib/gemini/client";
import { generateEdgeBrief, type EdgeBrief } from "@/lib/gemini/service";

/** What the brief writer is allowed to see for one edge SKU, including the event tags that cover it. */
export function briefInputFor(item: EngineItem, input: EngineInput): BriefInput {
  const sku = input.skus.find((s) => s.skuId === item.skuId)!;
  const tags = tagsForSku(input.events ?? [], sku).map((t) => ({
    eventType: t.eventType ?? "other",
    summary: t.summary ?? "",
    startWeek: t.startWeek,
    endWeek: t.endWeek,
  }));
  return buildBriefInput({
    sku: { id: sku.skuId, name: sku.skuName, category: sku.category, perishability: sku.perishability, distributorId: sku.distributorId },
    metrics: item.metrics,
    edgeReasons: item.edgeReasons,
    tags,
    recentWeeks: input.rules.surge_recent_weeks,
  });
}

/** The deterministic brief for an edge item, used when no AI brief exists for it. */
export function fallbackBrief(item: EngineItem, input: EngineInput, reason: string): EdgeBrief {
  return {
    text: templateBrief(briefInputFor(item, input), item.edgeReasons.map((r) => r.code)),
    source: "template",
    fallbackReason: reason,
  };
}

/**
 * Writes a brief for every edge SKU in a run, in parallel. generateEdgeBrief
 * never throws, so this cannot fail a run: a slow or broken Gemini just means
 * template briefs. Only edge SKUs get a brief.
 */
export async function writeEdgeBriefs(result: EngineResult, input: EngineInput, transport: GeminiTransport | null): Promise<Map<string, EdgeBrief>> {
  const edge = result.items.filter((i) => i.isEdge);
  const entries = await Promise.all(
    edge.map(async (item) => [item.skuId, await generateEdgeBrief(transport, briefInputFor(item, input), item.edgeReasons.map((r) => r.code))] as const),
  );
  return new Map(entries);
}
