import { config } from "dotenv";
import { exchangeGrantCode } from "@/lib/zoho";

// One-time: turns the grant code from the Zoho API Console (Self Client, "Generate
// Code" tab) into a refresh token. Usage:  npm run zoho:token -- <grant code>
// Needs ZOHO_DC, ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in .env.local. It prints the
// refresh token ONCE, for you to paste into .env.local as ZOHO_REFRESH_TOKEN. The grant
// code expires in minutes and works only once.
config({ path: ".env.local", quiet: true });

async function main() {
  const code = process.argv[2]?.trim();
  const { ZOHO_DC, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET } = process.env;
  if (!code) throw new Error("Pass the grant code: npm run zoho:token -- <grant code>");
  if (!ZOHO_DC || !ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET) throw new Error("Set ZOHO_DC, ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in .env.local first.");
  const r = await exchangeGrantCode({ dc: ZOHO_DC, clientId: ZOHO_CLIENT_ID, clientSecret: ZOHO_CLIENT_SECRET, code });
  console.log("\nSuccess. Put this line in .env.local (it does not expire; keep it secret):\n");
  console.log(`ZOHO_REFRESH_TOKEN=${r.refreshToken}`);
  if (r.apiDomain) console.log(`\n(Zoho says your API domain is ${r.apiDomain})`);
}

main().catch((e) => {
  console.error("Failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
