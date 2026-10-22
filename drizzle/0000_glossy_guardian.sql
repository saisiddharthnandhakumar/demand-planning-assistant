CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "calendar" (
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"year_month" text NOT NULL,
	"is_festival_month" boolean NOT NULL,
	CONSTRAINT "calendar_year_month_pk" PRIMARY KEY("year","month"),
	CONSTRAINT "calendar_month_chk" CHECK ("calendar"."month" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "distributors" (
	"distributor_id" text PRIMARY KEY NOT NULL,
	"distributor_name" text NOT NULL,
	"region" text NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"tags" jsonb,
	"confirmed" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"sku_id" text NOT NULL,
	"location" text NOT NULL,
	"units_on_hand" integer NOT NULL,
	"as_of_date" date NOT NULL,
	CONSTRAINT "inventory_sku_id_location_as_of_date_pk" PRIMARY KEY("sku_id","location","as_of_date"),
	CONSTRAINT "inventory_units_chk" CHECK ("inventory"."units_on_hand" >= 0)
);
--> statement-breakpoint
CREATE TABLE "loss_baseline" (
	"quarter" text PRIMARY KEY NOT NULL,
	"stockout_loss_inr" bigint NOT NULL,
	"writeoff_loss_inr" bigint NOT NULL,
	"entered_by" text,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"vendor" text NOT NULL,
	"vendor_name" text,
	"zoho_po_id" text,
	"zoho_po_url" text,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_run_vendor_uq" UNIQUE("run_id","vendor"),
	CONSTRAINT "purchase_orders_status_chk" CHECK ("purchase_orders"."status" in ('dry_run', 'created', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"document" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rules_singleton_chk" CHECK ("rules"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "rules_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_items" (
	"run_id" uuid NOT NULL,
	"sku_id" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommended_action" text,
	"recommended_qty" integer,
	"reason" text,
	"is_edge" boolean DEFAULT false NOT NULL,
	"edge_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edge_brief" text,
	"decision_status" text DEFAULT 'pending' NOT NULL,
	"final_action" text,
	"final_qty" integer,
	"override_reason" text,
	"override_note" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "run_items_run_id_sku_id_pk" PRIMARY KEY("run_id","sku_id"),
	CONSTRAINT "run_items_status_chk" CHECK ("run_items"."decision_status" in ('pending', 'approved', 'edited', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text NOT NULL,
	"as_of_date" date,
	"status" text NOT NULL,
	"skip_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" text,
	"override_rate" numeric(6, 4),
	"rules_version" integer,
	"rules_snapshot" jsonb,
	CONSTRAINT "runs_trigger_chk" CHECK ("runs"."trigger" in ('cron', 'manual')),
	CONSTRAINT "runs_status_chk" CHECK ("runs"."status" in ('skipped', 'open', 'submitted', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "sku_vendor_map" (
	"sku_id" text PRIMARY KEY NOT NULL,
	"vendor_name" text NOT NULL,
	"zoho_vendor_id" text NOT NULL,
	"zoho_item_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"sku_id" text PRIMARY KEY NOT NULL,
	"sku_name" text NOT NULL,
	"category" text NOT NULL,
	"perishability" text NOT NULL,
	"standard_reorder_qty" integer NOT NULL,
	"unit_of_measure" text NOT NULL,
	"distributor_id" text NOT NULL,
	CONSTRAINT "skus_perishability_chk" CHECK ("skus"."perishability" in ('High', 'Low')),
	CONSTRAINT "skus_standard_qty_chk" CHECK ("skus"."standard_reorder_qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "system_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"reason" text,
	"since" timestamp with time zone,
	"consecutive_breaches" integer DEFAULT 0 NOT NULL,
	"breach_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "system_state_singleton_chk" CHECK ("system_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "weekly_sales" (
	"sku_id" text NOT NULL,
	"iso_week" text NOT NULL,
	"week_start" date NOT NULL,
	"units" integer NOT NULL,
	CONSTRAINT "weekly_sales_sku_id_iso_week_pk" PRIMARY KEY("sku_id","iso_week"),
	CONSTRAINT "weekly_sales_units_chk" CHECK ("weekly_sales"."units" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_sku_id_skus_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("sku_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_sku_id_skus_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("sku_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_vendor_map" ADD CONSTRAINT "sku_vendor_map_sku_id_skus_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("sku_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_distributor_id_distributors_distributor_id_fk" FOREIGN KEY ("distributor_id") REFERENCES "public"."distributors"("distributor_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_sales" ADD CONSTRAINT "weekly_sales_sku_id_skus_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("sku_id") ON DELETE no action ON UPDATE no action;