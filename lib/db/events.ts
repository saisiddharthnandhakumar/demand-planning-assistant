import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { distributors, eventNotes, skus } from "@/lib/db/schema";
import type { EventTag } from "@/lib/engine/types";
import {
  storedTagSchema,
  tagHasTargets,
  tagIsRelevant,
  toEngineTag,
  type Catalog,
  type EventTagDraft,
} from "@/lib/gemini/events";

export type EventResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function getCatalog(db: Db): Promise<Catalog> {
  const [skuRows, distRows] = await Promise.all([db.select().from(skus).orderBy(skus.skuId), db.select().from(distributors).orderBy(distributors.distributorId)]);
  return {
    skus: skuRows.map((s) => ({ id: s.skuId, name: s.skuName, category: s.category, distributorId: s.distributorId })),
    distributors: distRows.map((d) => ({ id: d.distributorId, name: d.distributorName, region: d.region })),
  };
}

const parseTag = (raw: unknown): EventTagDraft | null => {
  const r = storedTagSchema.safeParse(raw);
  return r.success ? r.data : null;
};

export interface EventNoteView {
  id: string;
  text: string;
  tag: EventTagDraft | null;
  confirmed: boolean;
  active: boolean;
  createdBy: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

export async function listEventNotes(db: Db, limit = 100): Promise<EventNoteView[]> {
  const rows = await db.select().from(eventNotes).orderBy(desc(eventNotes.createdAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    tag: parseTag(r.tags),
    confirmed: r.confirmed,
    active: r.active,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    confirmedAt: r.confirmedAt,
  }));
}

/** Saves what the AI proposed as an UNCONFIRMED draft. Nothing is applied to any run until it is confirmed. */
export async function createEventNoteDraft(db: Db, args: { text: string; tag: EventTagDraft; createdBy: string }): Promise<string> {
  const [row] = await db
    .insert(eventNotes)
    .values({ text: args.text, tags: args.tag, confirmed: false, active: false, createdBy: args.createdBy })
    .returning({ id: eventNotes.id });
  return row.id;
}

/**
 * Confirms a draft: only now does it become active and reach the engine. The
 * stored tag is re-checked against the current catalog first, so a tag that
 * names a SKU that no longer exists cannot be confirmed.
 */
export async function confirmEventNote(db: Db, args: { id: string; actor: string }): Promise<EventResult> {
  const [note] = await db.select().from(eventNotes).where(eq(eventNotes.id, args.id));
  if (!note) return { ok: false, error: "That note no longer exists." };
  if (note.confirmed) return { ok: false, error: "This note is already confirmed." };
  const tag = parseTag(note.tags);
  if (!tag) return { ok: false, error: "The saved tags are unreadable. Discard this note and write it again." };
  if (!tagHasTargets(tag)) return { ok: false, error: "This tag does not cover any SKU, category or distributor, so there is nothing to confirm. Discard it and rewrite the note." };

  const catalog = await getCatalog(db);
  const knownSkus = new Set(catalog.skus.map((s) => s.id));
  const knownCats = new Set(catalog.skus.map((s) => s.category));
  const knownDists = new Set(catalog.distributors.map((d) => d.id));
  if (!tag.skuIds.every((x) => knownSkus.has(x)) || !tag.categories.every((x) => knownCats.has(x)) || !tag.distributorIds.every((x) => knownDists.has(x))) {
    return { ok: false, error: "The catalog has changed since this note was parsed. Discard it and write it again." };
  }

  const result = await db.execute(sql`
    with upd as (
      update event_notes set confirmed = true, active = true, confirmed_at = now()
      where id = ${args.id} and confirmed = false
      returning id
    ),
    aud as (
      insert into audit_log (actor, action, detail)
      select ${args.actor}::text, 'event.confirm',
             jsonb_build_object('noteId', id::text, 'summary', ${tag.summary}::text, 'eventType', ${tag.eventType}::text,
                                'startWeek', ${tag.startWeek}::text, 'endWeek', ${tag.endWeek}::text)
      from upd
      returning 1
    )
    select count(*)::int as n from upd
  `);
  return Number(result.rows[0]?.n ?? 0) === 1 ? { ok: true } : { ok: false, error: "This note was confirmed or removed by someone else." };
}

/** Throws away an unconfirmed draft. A confirmed note is never deleted, only deactivated. */
export async function discardEventNote(db: Db, id: string): Promise<EventResult> {
  const deleted = await db.delete(eventNotes).where(sql`${eventNotes.id} = ${id} and ${eventNotes.confirmed} = false`).returning({ id: eventNotes.id });
  return deleted.length === 1 ? { ok: true } : { ok: false, error: "Only an unconfirmed draft can be discarded. Confirmed notes can be switched off instead." };
}

/** Switches a confirmed note off or back on. An inactive note stops affecting runs but stays on record. */
export async function setEventActive(db: Db, args: { id: string; active: boolean; actor: string }): Promise<EventResult> {
  const result = await db.execute(sql`
    with upd as (
      update event_notes set active = ${args.active}::boolean
      where id = ${args.id} and confirmed = true and active <> ${args.active}::boolean
      returning id
    ),
    aud as (
      insert into audit_log (actor, action, detail)
      select ${args.actor}::text, ${args.active ? "event.activate" : "event.deactivate"}::text, jsonb_build_object('noteId', id::text)
      from upd
      returning 1
    )
    select count(*)::int as n from upd
  `);
  return Number(result.rows[0]?.n ?? 0) === 1 ? { ok: true } : { ok: false, error: "Nothing changed: the note is not confirmed, or is already in that state." };
}

/**
 * Confirmed, active tags that still matter for a run whose baseline window
 * starts at `windowStartWeek`, in the engine's shape. Unreadable stored tags
 * are skipped (never crash a run) and reported to the log.
 */
export async function loadActiveEventTags(db: Db, windowStartWeek: string): Promise<EventTag[]> {
  const rows = await db.select().from(eventNotes).where(sql`${eventNotes.confirmed} = true and ${eventNotes.active} = true`);
  const tags: EventTag[] = [];
  for (const r of rows) {
    const tag = parseTag(r.tags);
    if (!tag) {
      console.warn(`event note ${r.id} has unreadable tags and was ignored`);
      continue;
    }
    if (tagIsRelevant(tag, windowStartWeek)) tags.push(toEngineTag(r.id, tag));
  }
  return tags;
}
