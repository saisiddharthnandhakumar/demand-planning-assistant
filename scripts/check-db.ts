import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set in .env.local");
  const sql = neon(url);
  const [row] = await sql`select current_database() as db, current_user as role, version() as version`;
  console.log("Neon connected:", row);
}

main().catch((err) => {
  console.error("Neon connection failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
