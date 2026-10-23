// Plain-language labels and one-line summaries for audit_log rows. Pure.

const LABELS: Record<string, string> = {
  "system.pause": "System paused",
  "system.resume": "System resumed",
  "rules.update": "Rules changed",
  "run.start": "Run started",
  "run.skipped": "Run skipped (paused)",
  "run.failed": "Run failed",
  "run.bulk_approve": "Bulk approval",
  "run.submit": "Run submitted",
  "loss.update": "Quarter losses entered",
};

export const auditLabel = (action: string) => LABELS[action] ?? action;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const short = (id: unknown) => String(id).slice(0, 8);
const clip = (s: string, max = 160) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function summarizeAudit(action: string, detail: unknown): string {
  const d = obj(detail);
  switch (action) {
    case "system.pause": {
      const ids = Array.isArray(d.runIds) ? d.runIds.map(short).join(", ") : "";
      return clip(`${d.reason ?? ""}${ids ? ` Runs: ${ids}.` : ""}`.trim());
    }
    case "system.resume":
      return clip(`Reason: “${d.reason ?? ""}” (typed ${d.typedConfirmation ?? "?"}). Was paused: ${d.previousReason ?? "no reason recorded"}`);
    case "rules.update": {
      const changes = Array.isArray(d.changes) ? d.changes.map((c) => obj(c)) : [];
      const list = changes.map((c) => `${c.path} ${JSON.stringify(c.from)}→${JSON.stringify(c.to)}`).join(", ");
      return clip(`v${d.from_version}→v${d.to_version}${list ? `: ${list}` : ""}`);
    }
    case "run.submit":
      return `Run ${short(d.runId)}: override rate ${d.overrideRate === null || d.overrideRate === undefined ? "n/a" : `${(Number(d.overrideRate) * 100).toFixed(1)}%`} (${d.overridden ?? "?"} of ${d.engineDecisions ?? "?"} engine decisions)`;
    case "run.start":
      return `Run ${short(d.runId)} as of ${d.asOfDate}, rules v${d.rulesVersion}, ${d.items} SKUs`;
    case "run.bulk_approve":
      return `Run ${short(d.runId)}: ${d.count} engine decisions approved`;
    case "run.skipped":
    case "run.failed":
      return clip(`Run ${short(d.runId)}: ${d.reason ?? ""}`);
    case "loss.update":
      return `${d.quarter}: stockout ₹${Number(d.stockoutLossInr).toLocaleString("en-IN")}, write-off ₹${Number(d.writeoffLossInr).toLocaleString("en-IN")}`;
    default:
      return clip(detail === null || detail === undefined ? "" : JSON.stringify(detail));
  }
}
