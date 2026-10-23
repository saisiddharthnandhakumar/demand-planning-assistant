import { describe, expect, it } from "vitest";
import { auditLabel, summarizeAudit } from "@/lib/audit";

describe("auditLabel", () => {
  it("uses plain language for known actions and falls back to the raw action", () => {
    expect(auditLabel("system.pause")).toBe("System paused");
    expect(auditLabel("system.resume")).toBe("System resumed");
    expect(auditLabel("something.new")).toBe("something.new");
  });
});

describe("summarizeAudit", () => {
  it("pause: the reason and the runs involved", () => {
    const s = summarizeAudit("system.pause", { reason: "Override rate above 30% in 2 consecutive submitted runs.", runIds: ["aaaaaaaa-1111", "bbbbbbbb-2222"] });
    expect(s).toBe("Override rate above 30% in 2 consecutive submitted runs. Runs: aaaaaaaa, bbbbbbbb.");
  });

  it("resume: the written reason, what was typed and what the pause was about", () => {
    const s = summarizeAudit("system.resume", { reason: "Rules reviewed.", typedConfirmation: "RESUME", previousReason: "Override rate above 30%." });
    expect(s).toContain("“Rules reviewed.”");
    expect(s).toContain("typed RESUME");
    expect(s).toContain("Override rate above 30%.");
  });

  it("rules: version change and what moved", () => {
    expect(summarizeAudit("rules.update", { from_version: 1, to_version: 2, changes: [{ path: "stockout_weeks", from: 6, to: 4 }] })).toBe("v1→v2: stockout_weeks 6→4");
  });

  it("submit: shows the override rate as a percentage", () => {
    expect(summarizeAudit("run.submit", { runId: "cccccccc-3333", overrideRate: 0.1429, overridden: 2, engineDecisions: 14 })).toBe(
      "Run cccccccc: override rate 14.3% (2 of 14 engine decisions)",
    );
    expect(summarizeAudit("run.submit", { runId: "cccccccc-3333", overrideRate: null })).toContain("n/a");
  });

  it("loss: rupees with Indian grouping", () => {
    expect(summarizeAudit("loss.update", { quarter: "2026-Q3", stockoutLossInr: 2000000, writeoffLossInr: 1100000 })).toBe(
      "2026-Q3: stockout ₹20,00,000, write-off ₹11,00,000",
    );
  });

  it("never throws on odd or missing detail, and clips long text", () => {
    expect(summarizeAudit("run.start", null)).toBeTypeOf("string");
    expect(summarizeAudit("unknown", undefined)).toBe("");
    expect(summarizeAudit("unknown", { a: "x".repeat(500) }).length).toBeLessThanOrEqual(160);
  });
});
