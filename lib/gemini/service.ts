import { z } from "zod";
import type { EdgeCode } from "@/lib/engine/types";
import { templateBrief, type BriefInput } from "./brief";
import { redactSecrets, type GeminiTransport } from "./client";
import { EVENT_JSON_SCHEMA, MAX_NOTE_LENGTH, normalizeParsedEvent, type Catalog, type EventTagDraft } from "./events";
import { checkBrief } from "./guardrail";
import { BRIEF_JSON_SCHEMA, edgeBriefPrompt, eventParsePrompt } from "./prompts";

// The two places Gemini is used, and nowhere else. Neither can change a flag, a
// quantity or a threshold: one produces tags a human confirms, the other produces
// text that is stored as text.

export const EVENT_PARSE_TIMEOUT_MS = 20_000;
export const BRIEF_TIMEOUT_MS = 15_000;

const errorText = (err: unknown) => redactSecrets(err instanceof Error ? err.message : String(err), [process.env.GEMINI_API_KEY]);

// ---------------------------------------------------------------------------
// Event note -> tags (a human must confirm before anything is saved)
// ---------------------------------------------------------------------------

export type ParseEventResult =
  | { ok: true; tag: EventTagDraft }
  /** `error` is safe to show to the planner. `detail` is technical and is for the server log only. */
  | { ok: false; kind: "invalid_note" | "unavailable" | "bad_answer"; error: string; detail?: string };

export async function parseEventNote(
  transport: GeminiTransport | null,
  args: { note: string; today: string; currentWeek: string; catalog: Catalog; timeoutMs?: number },
): Promise<ParseEventResult> {
  const note = args.note.trim();
  if (!note) return { ok: false, kind: "invalid_note", error: "Write a note first." };
  if (note.length > MAX_NOTE_LENGTH) return { ok: false, kind: "invalid_note", error: `Keep the note under ${MAX_NOTE_LENGTH} characters.` };
  if (!transport) return { ok: false, kind: "unavailable", error: "The AI is not configured, so notes cannot be turned into tags." };

  const { systemInstruction, contents } = eventParsePrompt({ note, today: args.today, currentWeek: args.currentWeek, catalog: args.catalog });
  let text: string;
  try {
    text = await transport.generateJson({
      systemInstruction,
      contents,
      schema: EVENT_JSON_SCHEMA,
      signal: AbortSignal.timeout(args.timeoutMs ?? EVENT_PARSE_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, kind: "unavailable", error: "The AI could not be reached, so nothing was saved. Try again in a moment.", detail: errorText(err) };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, kind: "bad_answer", error: "The AI gave an answer that could not be read, so nothing was saved. Try again.", detail: "invalid JSON from the model" };
  }
  const normalized = normalizeParsedEvent(raw, args.catalog, args.currentWeek);
  return normalized.ok
    ? { ok: true, tag: normalized.tag }
    : { ok: false, kind: "bad_answer", error: "The AI gave an answer in an unexpected format, so nothing was saved. Try again.", detail: normalized.error };
}

// ---------------------------------------------------------------------------
// Edge brief (AI text, checked, with a deterministic fallback)
// ---------------------------------------------------------------------------

export interface EdgeBrief {
  text: string;
  source: "ai" | "template";
  /** Why the template was used instead of an AI brief, for the log and the "AI brief unavailable" note. */
  fallbackReason?: string;
}

const briefAnswerSchema = z.object({ brief: z.string() });

/**
 * Writes a brief for one edge SKU. NEVER throws and never blocks a run: if the
 * transport is missing, fails, times out, returns something malformed, or
 * writes a brief that fails the guardrail (a number that is not in the data,
 * advice, too long), the deterministic template brief is returned instead.
 */
export async function generateEdgeBrief(
  transport: GeminiTransport | null,
  input: BriefInput,
  reasonCodes: EdgeCode[],
  opts: { timeoutMs?: number } = {},
): Promise<EdgeBrief> {
  const fallback = (fallbackReason: string): EdgeBrief => ({ text: templateBrief(input, reasonCodes), source: "template", fallbackReason });
  if (!transport) return fallback("The AI is not configured.");

  try {
    const { systemInstruction, contents } = edgeBriefPrompt(input);
    const text = await transport.generateJson({
      systemInstruction,
      contents,
      schema: BRIEF_JSON_SCHEMA,
      signal: AbortSignal.timeout(opts.timeoutMs ?? BRIEF_TIMEOUT_MS),
    });
    const answer = briefAnswerSchema.safeParse(JSON.parse(text));
    if (!answer.success) return fallback("The AI answer was not in the expected format.");

    const brief = answer.data.brief.trim();
    const check = checkBrief(brief, input);
    return check.ok ? { text: brief, source: "ai" } : fallback(check.reason);
  } catch (err) {
    return fallback(err instanceof SyntaxError ? "The AI answer was not valid JSON." : `The AI call failed: ${errorText(err)}`);
  }
}
