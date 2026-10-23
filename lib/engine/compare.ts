import type { Action, EngineResult, Flag } from "./types";

export interface DecisionSummary {
  flags: Flag[];
  action: Action;
  qty: number;
  isEdge: boolean;
}

export interface DecisionChange {
  skuId: string;
  before: DecisionSummary;
  after: DecisionSummary;
}

const summary = (i: EngineResult["items"][number]): DecisionSummary => ({
  flags: [...i.flags].sort(),
  action: i.action,
  qty: i.qty,
  isEdge: i.isEdge,
});

/** SKUs whose flags, action, quantity or routing differ between two engine runs. */
export function compareResults(before: EngineResult, after: EngineResult): DecisionChange[] {
  const afterById = new Map(after.items.map((i) => [i.skuId, i]));
  const changes: DecisionChange[] = [];
  for (const b of before.items) {
    const a = afterById.get(b.skuId);
    if (!a) continue;
    const sb = summary(b);
    const sa = summary(a);
    if (JSON.stringify(sb) !== JSON.stringify(sa)) changes.push({ skuId: b.skuId, before: sb, after: sa });
  }
  return changes;
}
