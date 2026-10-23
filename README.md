# Demand Planning Assistant

Internal tool that automates the data work of demand planning and applies a planner's documented reorder rules twice a week. Every recommendation is approved by a human before draft purchase orders are created in Zoho Inventory. The app never sends or issues a PO.

Status: under construction (milestones M0 to M4 complete). See `CLAUDE.md` for the design commitments and rules. A full README (setup, env vars, Zoho credentials, known limitations) arrives in M10.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in values
npm run db:check             # confirms Neon connects
npm test
npm run dev
```

## Authentication (demo only)

Access is a single shared password (`APP_PASSWORD`) enforced in `proxy.ts` with a signed, HttpOnly session cookie. **This is not production-grade auth**: there are no individual accounts, no per-user audit identity (the rules editor asks for a name instead), and no rate limiting on password attempts. Changing `APP_PASSWORD` signs everyone out. The cron route (`/api/cron/*`) is excluded from the gate and will authenticate with `CRON_SECRET`.

## Runs and the cron

A run applies the current rules to the latest data and stores every SKU's result for review. It is started by the cron (`vercel.json`: `30 3 * * 1,4`, Monday and Thursday 03:30 UTC = 09:00 IST, calling `GET /api/cron/run`) or by the **Run now** button, through the same code path (`lib/runs/start.ts`).

- The cron route requires `Authorization: Bearer ${CRON_SECRET}` (Vercel sends this when `CRON_SECRET` is set) and returns 401 for anything else, including when the secret is unset.
- The first thing a run does is read `system_state.paused`. If paused it records a *skipped* run with the reason (no items, nothing computed).
- Starting the same trigger and as-of date again within 60 seconds returns the existing run (double-click and retry safe).
- A manual run can override the as-of date. It cannot be earlier than the first inventory snapshot (there is no stock data before it) and the form says so.

## Database and seed data

```bash
npm run db:migrate           # apply Drizzle migrations to Neon
npm run seed                 # validate and load seed/ into Neon (one transaction)
npm run seed -- --reset      # also wipe runs and decisions before loading
npm run seed -- --dir=PATH   # load from another folder
```

The seed script validates first and writes nothing if anything is wrong (duplicate SKU/week pairs, missing weeks, negative or non-integer units, SKUs missing from the SKU master or inventory, unparseable weeks, and more). Seed data lives in `seed/`; the case brief is in `docs/`.
