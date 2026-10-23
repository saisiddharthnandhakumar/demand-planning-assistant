import type { Metadata } from "next";
import { connection } from "next/server";
import { formatIsoWeek, isoWeekOfDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { getCatalog, listEventNotes } from "@/lib/db/events";
import { getInventoryDateRange, getRuleSet } from "@/lib/db/queries";
import { windowWeeks } from "@/lib/engine/metrics";
import { tagTiming } from "@/lib/gemini/events";
import { todayInIst } from "@/lib/money";
import { formatWhen } from "../rules/format-when";
import { EventsPanel, type NoteCard } from "./events-panel";

export const metadata: Metadata = { title: "Events" };

export default async function EventsPage() {
  await connection(); // read the database on every request, never at build time
  const db = getDb();
  const [notes, catalog, rules, range] = await Promise.all([listEventNotes(db), getCatalog(db), getRuleSet(db), getInventoryDateRange(db)]);

  // Timing is judged against the window the next run will use.
  const asOf = range?.last ?? todayInIst(new Date());
  const weeks = windowWeeks(asOf, rules.baseline_weeks);
  const windowStart = weeks[0];
  const lastComplete = weeks.at(-1)!;
  const currentWeek = formatIsoWeek(isoWeekOfDate(todayInIst(new Date())));

  const skuLabel = new Map(catalog.skus.map((s) => [s.id, `${s.id} ${s.name}`]));
  const distLabel = new Map(catalog.distributors.map((d) => [d.id, `${d.id} ${d.name}`]));

  const cards: NoteCard[] = notes.map((n) => ({
    id: n.id,
    text: n.text,
    createdBy: n.createdBy,
    createdAt: formatWhen(n.createdAt),
    confirmed: n.confirmed,
    active: n.active,
    timing: n.tag && n.confirmed ? tagTiming(n.tag, windowStart, lastComplete) : null,
    tag: n.tag && {
      summary: n.tag.summary,
      eventType: n.tag.eventType,
      confidence: n.tag.confidence,
      startWeek: n.tag.startWeek,
      endWeek: n.tag.endWeek,
      skus: n.tag.skuIds.map((id) => skuLabel.get(id) ?? id),
      categories: n.tag.categories,
      distributors: n.tag.distributorIds.map((id) => distLabel.get(id) ?? id),
      warnings: n.tag.warnings,
    },
  }));

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
        <p className="text-sm text-muted-foreground">
          Tell the system about things the sales data does not show yet, such as a competitor scheme. The AI turns your note into tags; you check and confirm them.
          A confirmed tag removes the tagged weeks from that SKU’s averages and sends the SKU to “Needs your judgment”. Today is week {currentWeek}.
        </p>
      </div>
      <EventsPanel notes={cards} />
    </div>
  );
}
