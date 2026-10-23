import { describe, expect, it } from "vitest";
import {
  breachWarning,
  formatPct,
  nextKillState,
  pauseReason,
  resumeSchema,
  verdictFor,
  type KillConfig,
  type KillState,
  type RunVerdict,
} from "@/lib/killswitch";
import { overrideRate, type ReviewItem } from "@/lib/override-rate";

const CONFIG: KillConfig = { threshold: 0.3, consecutiveRuns: 2 };
const RUNNING: KillState = { paused: false, consecutiveBreaches: 0, breachRunIds: [] };

/** Plays a sequence of verdicts as submitted runs r1, r2, ... and returns every state along the way. */
function play(verdicts: RunVerdict[], config = CONFIG, start = RUNNING) {
  const states: { state: KillState; justPaused: boolean }[] = [];
  let state = start;
  verdicts.forEach((v, i) => {
    const t = nextKillState(state, v, `r${i + 1}`, config);
    state = t.state;
    states.push(t);
  });
  return states;
}

describe("verdictFor (the 30% line is strict)", () => {
  it("is a breach only when strictly above the threshold", () => {
    expect(verdictFor(0.31, 0.3)).toBe("breach");
    expect(verdictFor(0.3, 0.3)).toBe("clean");
    expect(verdictFor(3 / 10, 0.3)).toBe("clean"); // exactly 30% as a fraction of ten
    expect(verdictFor(6 / 20, 0.3)).toBe("clean");
    expect(verdictFor(0.05, 0.3)).toBe("clean");
    expect(verdictFor(0, 0.3)).toBe("clean");
  });

  it("a run with no rate is no_data", () => {
    expect(verdictFor(null, 0.3)).toBe("no_data");
  });

  it("works from real decisions: 4 of 14 is clean, 5 of 14 is a breach", () => {
    const run = (overridden: number): ReviewItem[] =>
      Array.from({ length: 14 }, (_, i) => ({ isEdge: false, decisionStatus: i < overridden ? "edited" : "approved" }));
    expect(verdictFor(overrideRate(run(4)), 0.3)).toBe("clean");
    expect(verdictFor(overrideRate(run(5)), 0.3)).toBe("breach");
  });

  it("uses whatever threshold the rules hold", () => {
    expect(verdictFor(0.25, 0.2)).toBe("breach");
    expect(verdictFor(0.25, 0.5)).toBe("clean");
  });
});

describe("two consecutive breaches pause the system", () => {
  it("the first breach counts but does not pause", () => {
    const [a] = play(["breach"]);
    expect(a.state).toEqual({ paused: false, consecutiveBreaches: 1, breachRunIds: ["r1"] });
    expect(a.justPaused).toBe(false);
  });

  it("the second breach in a row pauses, recording both runs involved", () => {
    const [, b] = play(["breach", "breach"]);
    expect(b.state).toEqual({ paused: true, consecutiveBreaches: 2, breachRunIds: ["r1", "r2"] });
    expect(b.justPaused).toBe(true);
  });

  it("a breach, a clean run, then a breach does NOT pause (the clean run reset the counter)", () => {
    const states = play(["breach", "clean", "breach"]);
    expect(states.map((s) => s.state.consecutiveBreaches)).toEqual([1, 0, 1]);
    expect(states.map((s) => s.state.paused)).toEqual([false, false, false]);
    expect(states[2].state.breachRunIds).toEqual(["r3"]);
  });

  it("clean runs alone never pause", () => {
    expect(play(["clean", "clean", "clean", "clean"]).every((s) => !s.state.paused)).toBe(true);
  });

  it("breach, clean, breach, breach pauses on the last two", () => {
    const states = play(["breach", "clean", "breach", "breach"]);
    expect(states[3].state).toEqual({ paused: true, consecutiveBreaches: 2, breachRunIds: ["r3", "r4"] });
  });
});

describe("runs with no rate", () => {
  it("neither extend nor break a streak", () => {
    const states = play(["breach", "no_data", "breach"]);
    expect(states.map((s) => s.state.consecutiveBreaches)).toEqual([1, 1, 2]);
    expect(states[2].state.paused).toBe(true);
    expect(states[2].state.breachRunIds).toEqual(["r1", "r3"]);
  });

  it("do not clear a streak or start one", () => {
    expect(play(["no_data"])[0].state).toEqual(RUNNING);
  });
});

describe("configurable via the rules", () => {
  it("consecutive_runs = 1 pauses on the first breach", () => {
    const [a] = play(["breach"], { threshold: 0.3, consecutiveRuns: 1 });
    expect(a.state.paused).toBe(true);
    expect(a.justPaused).toBe(true);
  });

  it("consecutive_runs = 3 needs three in a row", () => {
    const states = play(["breach", "breach", "breach"], { threshold: 0.3, consecutiveRuns: 3 });
    expect(states.map((s) => s.state.paused)).toEqual([false, false, true]);
    expect(states[2].state.breachRunIds).toEqual(["r1", "r2", "r3"]);
  });
});

describe("an already paused system", () => {
  const paused: KillState = { paused: true, consecutiveBreaches: 2, breachRunIds: ["a", "b"] };

  it("is left exactly as it is by any verdict", () => {
    for (const v of ["breach", "clean", "no_data"] as RunVerdict[]) {
      const t = nextKillState(paused, v, "r9", CONFIG);
      expect(t.state).toBe(paused);
      expect(t.justPaused).toBe(false);
    }
  });
});

describe("transitions are pure", () => {
  it("never mutate the state passed in", () => {
    const frozen = Object.freeze({ paused: false, consecutiveBreaches: 1, breachRunIds: Object.freeze(["r0"]) as unknown as string[] });
    expect(() => nextKillState(frozen, "breach", "r1", CONFIG)).not.toThrow();
    expect(frozen.breachRunIds).toEqual(["r0"]);
  });
});

describe("pauseReason", () => {
  it("states the threshold and streak length from the rules", () => {
    expect(pauseReason(0.3, 2)).toBe("Override rate above 30% in 2 consecutive submitted runs.");
    expect(pauseReason(0.275, 3)).toBe("Override rate above 27.5% in 3 consecutive submitted runs.");
  });
});

describe("resume requires a typed confirmation and a written reason", () => {
  const ok = { confirmation: "RESUME", reason: "Reviewed the overrides with the team; rules updated.", actor: "Raghav" };

  it("accepts a complete request", () => {
    expect(resumeSchema.safeParse(ok).success).toBe(true);
  });

  it("the confirmation must be typed exactly", () => {
    for (const confirmation of ["", "resume", "Resume", "RESUME ", "yes", " RESUME"]) {
      const r = resumeSchema.safeParse({ ...ok, confirmation });
      expect(r.success).toBe(false);
    }
  });

  it("needs a real reason, not a blank or token one", () => {
    expect(resumeSchema.safeParse({ ...ok, reason: "" }).success).toBe(false);
    expect(resumeSchema.safeParse({ ...ok, reason: "   ok   " }).success).toBe(false);
    expect(resumeSchema.safeParse({ ...ok, reason: "short" }).success).toBe(false);
    expect(resumeSchema.safeParse({ ...ok, reason: "x".repeat(1001) }).success).toBe(false);
  });

  it("needs a name for the audit log", () => {
    expect(resumeSchema.safeParse({ ...ok, actor: "  " }).success).toBe(false);
  });

  it("trims the reason it stores", () => {
    const r = resumeSchema.parse({ ...ok, reason: "   Reviewed overrides and fixed the rules.   " });
    expect(r.reason).toBe("Reviewed overrides and fixed the rules.");
  });
});

describe("breachWarning", () => {
  const base = { threshold: 0.3, consecutiveRuns: 2 };

  it("says nothing for a run at or under the limit, or with no rate", () => {
    expect(breachWarning({ ...base, rate: 0.3, currentStreak: 1 })).toBeNull();
    expect(breachWarning({ ...base, rate: 0.1, currentStreak: 0 })).toBeNull();
    expect(breachWarning({ ...base, rate: null, currentStreak: 1 })).toBeNull();
  });

  it("a first breach tells the planner where the streak stands and that a clean run resets it", () => {
    const w = breachWarning({ ...base, rate: 0.36, currentStreak: 0 })!;
    expect(w).toContain("run 1 of 2");
    expect(w).toContain("pauses at 2");
    expect(w).toContain("resets");
    expect(w).not.toContain("will pause the system");
  });

  it("the breach that reaches the streak length says submitting will pause the system", () => {
    expect(breachWarning({ ...base, rate: 0.43, currentStreak: 1 })).toContain("run 2 of 2 in a row above the limit, so submitting it will pause the system");
  });

  it("follows the rules: streak length 1 and streak length 3", () => {
    expect(breachWarning({ threshold: 0.3, consecutiveRuns: 1, rate: 0.5, currentStreak: 0 })).toContain("A single run above the limit pauses the system");
    expect(breachWarning({ threshold: 0.3, consecutiveRuns: 3, rate: 0.5, currentStreak: 1 })).toContain("run 2 of 3");
  });

  it("states the threshold tidily", () => {
    expect(breachWarning({ ...base, rate: 0.5, currentStreak: 0 })).toContain("above 30%");
    expect(formatPct(0.275)).toBe("27.5%");
    expect(formatPct(0.3)).toBe("30%");
  });
});
