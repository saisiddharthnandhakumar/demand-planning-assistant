# Demand Planning Assistant

Internal tool that automates the data work of demand planning and applies a planner's documented reorder rules twice a week. Every recommendation is approved by a human before draft purchase orders are created in Zoho Inventory. The app never sends or issues a PO.

Status: under construction (milestones M0 to M6 complete). See `CLAUDE.md` for the design commitments and rules. A full README (setup, env vars, Zoho credentials, known limitations) arrives in M10.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in values
npm run db:check             # confirms Neon connects
npm test
npm run dev
```

The kill-switch SQL is checked against its pure twin by an opt-in integration test that writes to the database it is pointed at (use a dev or branch database):

```bash
TEST_DATABASE_URL="<dev database url>" npx vitest run killswitch-sql
```

## Authentication (demo only)

Access is a single shared password (`APP_PASSWORD`) enforced in `proxy.ts` with a signed, HttpOnly session cookie. **This is not production-grade auth**: there are no individual accounts, no per-user audit identity (the rules editor asks for a name instead), and no rate limiting on password attempts. Changing `APP_PASSWORD` signs everyone out. The cron route (`/api/cron/*`) is excluded from the gate and will authenticate with `CRON_SECRET`.

## Runs and the cron

A run applies the current rules to the latest data and stores every SKU's result for review. It is started by the cron (`vercel.json`: `30 3 * * 1,4`, Monday and Thursday 03:30 UTC = 09:00 IST, calling `GET /api/cron/run`) or by the **Run now** button, through the same code path (`lib/runs/start.ts`).

- The cron route requires `Authorization: Bearer ${CRON_SECRET}` (Vercel sends this when `CRON_SECRET` is set) and returns 401 for anything else, including when the secret is unset.
- The first thing a run does is read `system_state.paused`. If paused it records a *skipped* run with the reason (no items, nothing computed).
- Starting the same trigger and as-of date again within 60 seconds returns the existing run (double-click and retry safe).
- A manual run can override the as-of date. It cannot be earlier than the first inventory snapshot (there is no stock data before it) and the form says so.

## Reviewing a run

Open a run to review it. Two tabs:

- **Engine decisions** (SKUs the rules can decide): Approve, Edit or Reject each. Edit and Reject require a reason category (demand view differs, supplier constraint, market event, data issue, other) and take an optional note. Rejecting means no action; there is nothing to reject on a "No action" row. **Approve all untouched engine decisions** shows the count and asks for confirmation first, and only approves if that count is still right.
- **Needs your judgment** (edge SKUs): each shows why it was routed, a 12-week sales chart and the metrics. What the rules would have said appears only as a labelled reference, never as a recommendation, and the decision form starts empty: you choose the action, quantity and reason.

A run can be submitted only when every SKU has a decision and the system is not paused. Submitting records who submitted, stores the **override rate** (edited or rejected engine decisions divided by all engine decisions, edge SKUs excluded) and locks the run: a submitted run can no longer be changed, enforced in SQL. Creating draft purchase orders on submit is added in a later milestone.

## Kill switch, dashboard and money card

- **Kill switch.** When a run is submitted its override rate is compared with `kill.override_rate_threshold` (strictly above counts as a breach). `kill.consecutive_runs` breaches in a row set `system_state.paused` with the reason, the time and the runs involved. A run at or below the limit resets the streak; a run with no engine decisions leaves it alone. The evaluation runs in the same SQL statement that submits the run, so a submitted run is always counted exactly once.
- **While paused:** scheduled runs are skipped, Run now and submitting are disabled, purchase orders are blocked, and a red banner shows on every page.
- **Resume** (Settings): type `RESUME`, write a reason (10+ characters) and your name. All three are written to `audit_log` with what the pause was about; the streak is reset.
- **Dashboard:** kill-switch status, override rate per submitted run against the limit (with a table view), flag counts per run, draft purchase orders with Zoho links, and the money card.
- **Money card** is entered by hand, because the case brief gives only a range (₹28–34 lakh per quarter) for the baseline. "Rs vs last quarter" = last quarter's total loss minus this quarter's. Quarters are *calendar* quarters (Oct–Dec is Q4) and the card carries a note that Oct–Dec contains festival months, so quarter-on-quarter comparisons are seasonal.

## Database and seed data

```bash
npm run db:migrate           # apply Drizzle migrations to Neon
npm run seed                 # validate and load seed/ into Neon (one transaction)
npm run seed -- --reset      # also wipe runs and decisions before loading
npm run seed -- --dir=PATH   # load from another folder
```

The seed script validates first and writes nothing if anything is wrong (duplicate SKU/week pairs, missing weeks, negative or non-integer units, SKUs missing from the SKU master or inventory, unparseable weeks, and more). Seed data lives in `seed/`; the case brief is in `docs/`.
