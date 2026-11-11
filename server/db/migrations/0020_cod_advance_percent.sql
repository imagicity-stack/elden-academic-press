ALTER TABLE "settings" ADD COLUMN "cod_advance_type" text DEFAULT 'flat' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "cod_advance_bps" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "cod_advance_min" integer DEFAULT 0 NOT NULL;