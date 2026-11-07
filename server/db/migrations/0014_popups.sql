CREATE TABLE "popup_stats" (
	"popup_id" uuid NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"closes" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "popup_stats_popup_id_day_pk" PRIMARY KEY("popup_id","day")
);
--> statement-breakpoint
CREATE TABLE "popups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"content" jsonb NOT NULL,
	"design" jsonb NOT NULL,
	"trigger" jsonb NOT NULL,
	"audience" jsonb NOT NULL,
	"frequency" jsonb NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "popup_stats" ADD CONSTRAINT "popup_stats_popup_id_popups_id_fk" FOREIGN KEY ("popup_id") REFERENCES "public"."popups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "popups_status_idx" ON "popups" USING btree ("status");--> statement-breakpoint
-- Only the store's server reads these tables: lock them against Supabase's public API keys.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['popups', 'popup_stats'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
