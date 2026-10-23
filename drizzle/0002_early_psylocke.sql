ALTER TABLE "run_items" ADD COLUMN "edge_brief_source" text;--> statement-breakpoint
ALTER TABLE "run_items" ADD COLUMN "edge_brief_fallback_reason" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "events_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL;