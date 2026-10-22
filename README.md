# Demand Planning Assistant

Internal tool that automates the data work of demand planning and applies a planner's documented reorder rules twice a week. Every recommendation is approved by a human before draft purchase orders are created in Zoho Inventory. The app never sends or issues a PO.

Status: under construction (milestone M0 complete). See `CLAUDE.md` for the design commitments and rules. A full README (setup, env vars, Zoho credentials, known limitations) arrives in M10.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in values
npm run db:check             # confirms Neon connects
npm test
npm run dev
```

Seed data lives in `seed/`; the case brief is in `docs/`.
