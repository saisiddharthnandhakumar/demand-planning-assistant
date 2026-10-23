import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { redactSecrets } from "@/lib/redact";

/**
 * The only place that talks to Gemini. Server-only: it reads GEMINI_API_KEY.
 * Everything above it takes a GeminiTransport, so the callers can be tested
 * with a fake and the real model is never needed to prove a failure path.
 */
export interface GeminiTransport {
  /** Asks for JSON matching `schema` and returns the raw JSON text. Rejects on any failure. */
  generateJson(args: { systemInstruction: string; contents: string; schema: object; signal: AbortSignal }): Promise<string>;
}

export class GeminiError extends Error {}

export { redactSecrets };

export function createGeminiTransport(opts: { apiKey: string; model: string }): GeminiTransport {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  return {
    async generateJson({ systemInstruction, contents, schema, signal }) {
      try {
        const res = await ai.models.generateContent({
          model: opts.model,
          contents,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseJsonSchema: schema,
            // Short, well-specified tasks: a low thinking level is faster and cheaper.
            // Sampling parameters are left unset: newer Gemini models ignore them.
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            abortSignal: signal,
          },
        });
        if (!res.text) {
          const why = res.promptFeedback?.blockReason ?? res.candidates?.[0]?.finishReason ?? "empty response";
          throw new GeminiError(`Gemini returned no text (${why}).`);
        }
        return res.text;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new GeminiError(redactSecrets(message, [opts.apiKey]).slice(0, 500));
      }
    },
  };
}

/** The configured transport, or null when GEMINI_API_KEY or GEMINI_MODEL is missing (callers then fall back). */
export function getGeminiTransport(env: Record<string, string | undefined> = process.env): GeminiTransport | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  const model = env.GEMINI_MODEL?.trim();
  return apiKey && model ? createGeminiTransport({ apiKey, model }) : null;
}
