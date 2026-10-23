"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatIsoWeek, isoWeekOfDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { confirmEventNote, createEventNoteDraft, discardEventNote, getCatalog, setEventActive } from "@/lib/db/events";
import { getGeminiTransport } from "@/lib/gemini/client";
import { MAX_NOTE_LENGTH } from "@/lib/gemini/events";
import { parseEventNote } from "@/lib/gemini/service";
import { todayInIst } from "@/lib/money";
import { requireAuth } from "@/lib/session";

export type EventActionResult = { ok: true; message?: string } | { ok: false; error: string };

const idSchema = z.uuid();
const nameSchema = z.string().trim().min(1, "Enter your name.").max(80, "Keep your name under 80 characters.");

function done(message?: string): EventActionResult {
  revalidatePath("/events");
  return { ok: true, message };
}

/**
 * Asks the AI to turn a note into tags and saves the result as an UNCONFIRMED
 * draft. Nothing is applied to any run until the planner confirms it.
 */
export async function parseNoteAction(input: { note: string; name: string }): Promise<EventActionResult> {
  await requireAuth();
  const name = nameSchema.safeParse(input.name);
  if (!name.success) return { ok: false, error: name.error.issues[0].message };
  const note = String(input.note ?? "").trim();
  if (!note) return { ok: false, error: "Write a note first." };
  if (note.length > MAX_NOTE_LENGTH) return { ok: false, error: `Keep the note under ${MAX_NOTE_LENGTH} characters.` };

  const db = getDb();
  const today = todayInIst(new Date());
  const parsed = await parseEventNote(getGeminiTransport(), {
    note,
    today,
    currentWeek: formatIsoWeek(isoWeekOfDate(today)),
    catalog: await getCatalog(db),
  });
  if (!parsed.ok) {
    if (parsed.detail) console.error(`parseEventNote ${parsed.kind}: ${parsed.detail}`);
    return { ok: false, error: parsed.error };
  }

  await createEventNoteDraft(db, { text: note, tag: parsed.tag, createdBy: name.data });
  return done("Review the tags below and confirm them. Nothing is applied until you do.");
}

export async function confirmNoteAction(id: string, name: string): Promise<EventActionResult> {
  await requireAuth();
  const n = nameSchema.safeParse(name);
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Invalid request." };
  if (!n.success) return { ok: false, error: n.error.issues[0].message };
  const r = await confirmEventNote(getDb(), { id, actor: n.data });
  return r.ok ? done("Confirmed. It applies from the next run.") : r;
}

export async function discardNoteAction(id: string): Promise<EventActionResult> {
  await requireAuth();
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const r = await discardEventNote(getDb(), id);
  return r.ok ? done() : r;
}

export async function setActiveAction(id: string, active: boolean, name: string): Promise<EventActionResult> {
  await requireAuth();
  const n = nameSchema.safeParse(name);
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Invalid request." };
  if (!n.success) return { ok: false, error: n.error.issues[0].message };
  const r = await setEventActive(getDb(), { id, active, actor: n.data });
  return r.ok ? done() : r;
}
