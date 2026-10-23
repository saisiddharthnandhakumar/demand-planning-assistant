import type { Rules } from "@/lib/rules";

export interface RuleChange {
  path: string;
  from: unknown;
  to: unknown;
}

export interface RulesVersion {
  version: number;
  document: Rules;
  by: string;
  at: Date;
}

export interface TimelineEntry {
  version: number;
  by: string;
  at: Date;
  /** What changed vs the previous version; null for version 1 or when the previous version is unknown. */
  changes: RuleChange[] | null;
  isCurrent: boolean;
}

function flatten(value: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      for (const [p, leaf] of flatten(v, prefix ? `${prefix}.${k}` : k)) out.set(p, leaf);
    }
  } else {
    out.set(prefix, value);
  }
  return out;
}

/** Leaf-level differences between two rules documents, in a stable order. */
export function diffRules(before: Rules, after: Rules): RuleChange[] {
  const a = flatten(before);
  const b = flatten(after);
  const paths = [...new Set([...a.keys(), ...b.keys()])];
  return paths
    .filter((p) => JSON.stringify(a.get(p)) !== JSON.stringify(b.get(p)))
    .map((path) => ({ path, from: a.get(path), to: b.get(path) }));
}

/** Newest first. `versions` = the current rules plus every row of rules_history. */
export function buildTimeline(versions: RulesVersion[], currentVersion: number): TimelineEntry[] {
  const byVersion = new Map(versions.map((v) => [v.version, v]));
  return [...versions]
    .sort((x, y) => y.version - x.version)
    .map((v) => {
      const prev = byVersion.get(v.version - 1);
      return {
        version: v.version,
        by: v.by,
        at: v.at,
        changes: prev ? diffRules(prev.document, v.document) : null,
        isCurrent: v.version === currentVersion,
      };
    });
}
