ALTER TABLE "orders" ADD COLUMN "payment_mode" text DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cod_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cod_collected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "cod_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "cod_advance" integer DEFAULT 6000 NOT NULL;