import { config } from "dotenv";
import { like, or } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { confirmEventNote, createEventNoteDraft, discardEventNote, getCatalog, listEventNotes, loadActiveEventTags, setEventActive } from "@/lib/db/events";
import { loadEngineInput } from "@/lib/db/queries";
import { auditLog, eventNotes, runItems, runs } from "@/lib/db/schema";
import { runEngine } from "@/lib/engine";
import type { EventTagDraft } from "@/lib/gemini/events";
import { dbRunDeps } from "@/lib/runs/db-deps";
import { writeEdgeBriefs } from "@/lib/runs/briefs";
import { startRun } from "@/lib/runs/start";
import { failing, fixed } from "./helpers/gemini-fixtures";

// OPT-IN integration test: writes event notes and runs to the database it is pointed at
// (use a dev or branch database) and removes them afterwards.
//   TEST_DATABASE_URL="$(grep ^DATABASE_URL= .env.local | cut -d= -f2-)" npx vitest run events-db
config({ path: ".env.local", quiet: true });
const url = process.env.TEST_DATABASE_URL;

const tag = (patch: Partial<EventTagDraft> = {}): EventTagDraft => ({
  summary: "Competitor scheme on brown rice",
  eventType: "competitor_scheme",
  skuIds: ["SKU003"],
  categories: [],
  distributorIds: [],
  startWeek: "2026-W40",
  endWeek: "2026-W42",
  confidence: "high",
  warnings: [],
  ...patch,
});

describe.skipIf(!url)("event notes and briefs against the database", () => {
  const db = url ? getDb(url) : (undefined as never);
  const clean = async () => {
    await db.delete(runItems);
    await db.delete(runs);
    await db.delete(eventNotes);
    await db.delete(auditLog).where(or(like(auditLog.action, "run.%"), like(auditLog.action, "event.%")));
  };
  beforeAll(clean);
  afterAll(clean);

  const engineFor = async () => {
    const { input } = await loadEngineInput(db);
    return { input, result: runEngine(input) };
  };
  const item = (r: ReturnType<typeof runEngine>, id: string) => r.items.find((i) => i.skuId === id)!;

  it("the catalog comes from the seeded data", async () => {
    const c = await getCatalog(db);
    expect(c.skus).toHaveLength(15);
    expect(c.distributors.map((d) => d.id)).toContain("DIST004");
  });

  it("a draft changes nothing until it is confirmed", async () => {
    const id = await createEventNoteDraft(db, { text: "scheme on brown rice", tag: tag(), createdBy: "Tester" });
    expect(await loadActiveEventTags(db, "2026-W31")).toEqual([]);
    const { input, result } = await engineFor();
    expect(input.events).toEqual([]);
    expect(item(result, "SKU003").isEdge).toBe(false);
    const [note] = await listEventNotes(db);
    expect(note).toMatchObject({ id, confirmed: false, active: false, createdBy: "Tester" });
    expect(note.tag?.summary).toBe("Competitor scheme on brown rice");
  });

  it("confirming makes the engine route the SKU and exclude the tagged weeks from its averages", async () => {
    const [draft] = await listEventNotes(db);
    const before = (await engineFor()).result;
    expect(await confirmEventNote(db, { id: draft.id, actor: "Raghav" })).toEqual({ ok: true });

    const { input, result } = await engineFor();
    expect(input.events).toHaveLength(1);
    expect(input.events![0]).toMatchObject({ id: draft.id, skuIds: ["SKU003"], eventType: "competitor_scheme", summary: "Competitor scheme on brown rice" });
    const sku = item(result, "SKU003");
    expect(sku.isEdge).toBe(true);
    expect(sku.edgeReasons.map((r) => r.code)).toContain("TAGGED_EVENT");
    expect(sku.metrics.excludedWeeks).toEqual(["2026-W40", "2026-W41", "2026-W42"]);
    expect(sku.metrics.avg4).not.toBe(item(before, "SKU003").metrics.avg4); // averages changed
    // everything else is untouched
    expect(result.items.filter((i) => i.isEdge).map((i) => i.skuId).sort()).toEqual(["SKU001", "SKU003"]);

    const audit = await db.select().from(auditLog).where(like(auditLog.action, "event.%"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: "Raghav", action: "event.confirm" });
  });

  it("cannot be confirmed twice", async () => {
    const [n] = await listEventNotes(db);
    expect(await confirmEventNote(db, { id: n.id, actor: "Raghav" })).toMatchObject({ ok: false, error: expect.stringMatching(/already confirmed/) });
  });

  it("switching it off removes the effect, switching it on restores it, both audited", async () => {
    const [n] = await listEventNotes(db);
    expect(await setEventActive(db, { id: n.id, active: false, actor: "Raghav" })).toEqual({ ok: true });
    expect((await engineFor()).input.events).toEqual([]);
    expect(item((await engineFor()).result, "SKU003").isEdge).toBe(false);
    expect(await setEventActive(db, { id: n.id, active: false, actor: "Raghav" })).toMatchObject({ ok: false }); // already off
    expect(await setEventActive(db, { id: n.id, active: true, actor: "Raghav" })).toEqual({ ok: true });
    expect(item((await engineFor()).result, "SKU003").isEdge).toBe(true);
    const actions = (await db.select().from(auditLog).where(like(auditLog.action, "event.%"))).map((a) => a.action).sort();
    expect(actions).toEqual(["event.activate", "event.confirm", "event.deactivate"]);
  });

  it("a confirmed note cannot be discarded; a draft can", async () => {
    const [confirmed] = await listEventNotes(db);
    expect(await discardEventNote(db, confirmed.id)).toMatchObject({ ok: false });
    const draftId = await createEventNoteDraft(db, { text: "x", tag: tag(), createdBy: "T" });
    expect(await discardEventNote(db, draftId)).toEqual({ ok: true });
    expect((await listEventNotes(db)).some((x) => x.id === draftId)).toBe(false);
  });

  it("a tag with no targets, or naming a SKU that does not exist, cannot be confirmed", async () => {
    const noTargets = await createEventNoteDraft(db, { text: "x", tag: tag({ skuIds: [] }), createdBy: "T" });
    expect(await confirmEventNote(db, { id: noTargets, actor: "R" })).toMatchObject({ ok: false, error: expect.stringMatching(/does not cover any/) });
    const ghost = await createEventNoteDraft(db, { text: "x", tag: tag({ skuIds: ["SKU999"] }), createdBy: "T" });
    expect(await confirmEventNote(db, { id: ghost, actor: "R" })).toMatchObject({ ok: false, error: expect.stringMatching(/catalog has changed/) });
    expect(await confirmEventNote(db, { id: "00000000-0000-0000-0000-000000000000", actor: "R" })).toMatchObject({ ok: false });
  });

  it("an expired tag (ended before the baseline window) no longer routes anything", async () => {
    await db.delete(eventNotes);
    const id = await createEventNoteDraft(db, { text: "old", tag: tag({ startWeek: "2026-W20", endWeek: "2026-W25" }), createdBy: "T" });
    expect(await confirmEventNote(db, { id, actor: "R" })).toEqual({ ok: true });
    expect((await engineFor()).input.events).toEqual([]);
    expect(item((await engineFor()).result, "SKU003").isEdge).toBe(false);
  });

  it("a category tag covers every SKU in it", async () => {
    await db.delete(eventNotes);
    const id = await createEventNoteDraft(db, { text: "snacks", tag: tag({ skuIds: [], categories: ["Snack"] }), createdBy: "T" });
    await confirmEventNote(db, { id, actor: "R" });
    const { result } = await engineFor();
    const snackSkus = ["SKU002", "SKU005", "SKU008", "SKU014"]; // Snack category in the seed
    for (const s of snackSkus) expect(item(result, s).isEdge, s).toBe(true);
    await db.delete(eventNotes);
  });

  describe("a real run stores briefs, their source and the event snapshot", () => {
    it("with a good AI brief", async () => {
      await db.delete(eventNotes);
      const id = await createEventNoteDraft(db, { text: "x", tag: tag(), createdBy: "T" });
      await confirmEventNote(db, { id, actor: "R" });
      const good = "Recent sales moved against the prior weeks and a competitor scheme is tagged for 2026-W40 to 2026-W42, so part of the change may be explained by it.";
      const deps = { ...dbRunDeps(db), writeBriefs: (r: never, i: never) => writeEdgeBriefs(r, i, fixed(JSON.stringify({ brief: good }))) };
      const res = await startRun(deps, { trigger: "manual" });
      expect(res.status).toBe("started");
      if (res.status !== "started") return;
      const rows = await db.select().from(runItems);
      const edge = rows.filter((r) => r.isEdge);
      expect(edge.map((r) => r.skuId).sort()).toEqual(["SKU001", "SKU003"]);
      expect(edge.every((r) => r.edgeBrief)).toBe(true);
      expect(edge.find((r) => r.skuId === "SKU003")).toMatchObject({ edgeBriefSource: "ai", edgeBriefFallbackReason: null });
      expect(rows.filter((r) => !r.isEdge).every((r) => r.edgeBrief === null && r.edgeBriefSource === null)).toBe(true);
      const [run] = await db.select().from(runs);
      expect(run.eventsSnapshot).toHaveLength(1);
      expect(run.eventsSnapshot[0]).toMatchObject({ skuIds: ["SKU003"], summary: "Competitor scheme on brown rice" });
      await db.delete(runItems);
      await db.delete(runs);
    });

    it("with Gemini failing: the run completes and the briefs are templates with the reason", async () => {
      const deps = { ...dbRunDeps(db), writeBriefs: (r: never, i: never) => writeEdgeBriefs(r, i, failing("503 Service Unavailable")) };
      const res = await startRun(deps, { trigger: "cron" });
      expect(res.status).toBe("started");
      const edge = (await db.select().from(runItems)).filter((r) => r.isEdge);
      expect(edge.length).toBeGreaterThan(0);
      for (const r of edge) {
        expect(r.edgeBriefSource).toBe("template");
        expect(r.edgeBriefFallbackReason).toContain("503 Service Unavailable");
        expect(r.edgeBrief).toContain(r.skuId);
      }
      const [run] = await db.select().from(runs);
      expect(run.status).toBe("open");
    });
  });
});
