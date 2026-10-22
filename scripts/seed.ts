import { config } from "dotenv";
import path from "node:path";
import { getDb } from "@/lib/db";
import { readSeedFiles, SeedReadError } from "@/lib/seed/read";
import { runSeed } from "@/lib/seed/run";
import { formatIssue } from "@/lib/seed/validate";
import { SeedWriteError, tableCounts, writeSeed } from "@/lib/seed/write";

config({ path: ".env.local", quiet: true });

async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes("--reset");
  const dirArg = args.find((a) => a.startsWith("--dir="));
  const dir = path.resolve(dirArg ? dirArg.slice("--dir=".length) : "seed");

  console.log(`Reading seed files from ${dir}`);
  const raw = readSeedFiles(dir);

  const db = getDb();
  const result = await runSeed(raw, (data) => writeSeed(db, data, { reset }));

  for (const w of result.warnings) console.warn(`  warning  ${formatIssue(w)}`);

  if (!result.ok) {
    console.error(`\nSeed FAILED validation with ${result.errors.length} error(s). Nothing was written.\n`);
    for (const e of result.errors) console.error(`  error    ${formatIssue(e)}`);
    process.exit(1);
  }

  console.log("\nSeed loaded in a single transaction. Row counts:");
  console.table(await tableCounts(db));
}

main().catch((err) => {
  if (err instanceof SeedReadError || err instanceof SeedWriteError) {
    console.error(`\nSeed aborted. Nothing was written.\n  ${err.message}`);
  } else {
    console.error("\nSeed failed unexpectedly. The load runs in one transaction, so nothing was written.");
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
