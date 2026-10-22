import { validateSeed } from "./validate";
import type { RawSeed, SeedData, SeedValidation } from "./types";

/**
 * Validates, and only if the data is clean calls `write`. Invalid data never
 * reaches the writer, so a bad file cannot produce a partial load.
 */
export async function runSeed(
  raw: RawSeed,
  write: (data: SeedData) => Promise<void>,
): Promise<SeedValidation> {
  const result = validateSeed(raw);
  if (result.ok) await write(result.data);
  return result;
}
