# Demand Planning Assistant

Internal tool for a regional FMCG company (packaged snacks and staples, Maharashtra and Goa). It automates the data work of monthly demand planning and applies the planner's documented rules twice a week (Mon and Thu, 09:00 IST). Every recommendation goes to the planner (Raghav Kulkarni) for approval. After he approves, the app creates DRAFT purchase orders in Zoho Inventory. The app never sends or issues a PO.

Full spec lives in the original build brief; this file is the short version. If anything here conflicts with the data or an API's real behaviour, stop and report it.

## Design commitments (non-negotiable)

1. The planner approves every recommendation before any PO is created. Judgment is protected by design.
2. All flags, quantities and thresholds are computed by deterministic code. Gemini is used only to (a) turn a free-text event note into structured tags that a human confirms, and (b) write a short brief (max 80 words, no new numbers, no action or quantity) for edge-case SKUs. It never changes a flag, quantity or threshold. Gemini output is stored as text only.
3. The system can stop itself: kill switch pauses everything when more than 30% of engine decisions are overridden in 2 consecutive submitted runs.
4. Success measures: override rate, and quarterly rupee loss vs last quarter's actual loss (entered by hand).

## The planner's rules (govern ~80-85% of recommendations)

- Last-4-week sales more than 20% above the 12-week average: high-demand, reorder at 1.5x standard quantity.
- Stock below 6 weeks of average weekly sales: stockout risk, immediate reorder.
- Stock above 14 weeks: overstock risk, pause the next order.
- Festival months (Oct, Nov, Mar, from the calendar table): 25% demand uplift before threshold checks.
- High-perishability SKUs: maximum 4 weeks of stock, minimum 3 weeks.

The other 15-20% (new launches, unusual distributor behaviour, one-off events) is detected by deterministic edge checks and routed to the planner as a separate queue. The system never guesses at these and shows no recommended quantity for them.

## Engine choices (documented and tested)

- The surge test uses raw actuals (no uplift). Uplift applies only to the demand used for cover weeks.
- Outlier z-score uses the sample standard deviation.
- Tagged event weeks are excluded from averages; the SKU is routed as an edge case.
- Override rate = overridden (Edit or Reject) engine decisions / all non-edge decisions in the run, NO_ACTION included.

## Hard rules

- No AI in flagging, thresholds, quantities or the kill switch.
- No PO without an explicit submit; no PO is ever issued or sent. Blocked while paused.
- Never invent data: no prices, vendor IDs or Zoho item IDs. Missing means say so and use dry-run.
- All thresholds come from the rules table, not constants in code.
- Engine functions (`lib/engine/`) are pure: no DB or network calls.
- No secrets in the repo or client bundle. Never log tokens. Zoho and Gemini calls are server-only.
- `Distributor_ID` in the SKU file is the downstream distributor who buys from the company. It is NOT the PO vendor. Vendors come from `sku_vendor_map`.

## Stack

Next.js (App Router, TypeScript), Tailwind + shadcn/ui, Recharts, Neon Postgres via `@neondatabase/serverless` + Drizzle, Zod for all inputs, Vitest, `@google/genai`, Vercel Cron. Node 22+. In this Next.js version the old `middleware.ts` is `proxy.ts`; read `node_modules/next/dist/docs/` before using framework APIs (see AGENTS.md).

## Workflow

Built in milestones M0-M10. Finish one, run its tests, show the results, wait for the go-ahead before the next.

## Commands

- `npm run dev` / `npm run build` / `npm run lint`
- `npm test` (Vitest)
- `npm run db:generate` / `npm run db:migrate` (Drizzle)
- `npm run seed` (loads `/seed` into Neon; added in M1)
