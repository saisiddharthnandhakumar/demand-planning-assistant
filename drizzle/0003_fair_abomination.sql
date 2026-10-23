ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_status_chk";--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "lines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "warning" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_chk" CHECK ("purchase_orders"."status" in ('pending', 'dry_run', 'created', 'failed'));