import { runEngine } from "@/lib/engine";
import { buildBriefInput } from "@/lib/gemini/brief";
import type { GeminiTransport } from "@/lib/gemini/client";
import type { Catalog } from "@/lib/gemini/events";
import { seedEngineInput } from "./engine-fixtures";

/** SKU001 on the real seed data: the edge case the brief is written for. */
export function sku001Brief() {
  const input = seedEngineInput();
  const item = runEngine(input).items.find((i) => i.skuId === "SKU001")!;
  const sku = input.skus.find((s) => s.skuId === "SKU001")!;
  const brief = buildBriefInput({
    sku: { id: sku.skuId, name: sku.skuName, category: sku.category, perishability: sku.perishability, distributorId: sku.distributorId },
    metrics: item.metrics,
    edgeReasons: item.edgeReasons,
    tags: [],
    recentWeeks: input.rules.surge_recent_weeks,
  });
  return { brief, codes: item.edgeReasons.map((r) => r.code) };
}

export function seedCatalog(): Catalog {
  const input = seedEngineInput();
  return {
    skus: input.skus.map((s) => ({ id: s.skuId, name: s.skuName, category: s.category, distributorId: s.distributorId })),
    distributors: [
      { id: "DIST001", name: "NutriFlow Distributors", region: "Maharashtra" },
      { id: "DIST002", name: "GrainPath Logistics", region: "Maharashtra" },
      { id: "DIST003", name: "PeakSource Supply", region: "Karnataka" },
      { id: "DIST004", name: "Meridian Trade Co.", region: "Gujarat" },
    ],
  };
}

export type Call = { systemInstruction: string; contents: string; schema: object };

/** Returns `text` and records what it was asked. */
export function fixed(text: string): GeminiTransport & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async generateJson(args) {
      calls.push({ systemInstruction: args.systemInstruction, contents: args.contents, schema: args.schema });
      return text;
    },
  };
}

export const failing = (message: string): GeminiTransport => ({
  async generateJson() {
    throw new Error(message);
  },
});

/** Never answers, but rejects when the abort signal fires, like the real SDK does on timeout. */
export const hanging = (): GeminiTransport => ({
  generateJson: ({ signal }) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")))),
});
