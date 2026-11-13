CREATE TABLE "pickup_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"pickup_id" text NOT NULL,
	"location" text NOT NULL,
	"pickup_date" date NOT NULL,
	"pickup_time" text NOT NULL,
	"package_count" integer NOT NULL,
	"center_name" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier" text DEFAULT 'delhivery' NOT NULL,
	"waybill" text NOT NULL,
	"reference" text NOT NULL,
	"env" text DEFAULT 'production' NOT NULL,
	"status" text DEFAULT 'manifested' NOT NULL,
	"carrier_status" text DEFAULT 'Manifested' NOT NULL,
	"carrier_status_type" text DEFAULT 'UD' NOT NULL,
	"status_code" text DEFAULT '' NOT NULL,
	"status_location" text DEFAULT '' NOT NULL,
	"status_note" text DEFAULT '' NOT NULL,
	"status_at" timestamp with time zone,
	"payment_mode" text NOT NULL,
	"cod_amount" integer DEFAULT 0 NOT NULL,
	"declared_value" integer NOT NULL,
	"weight_grams" integer NOT NULL,
	"length_cm" integer NOT NULL,
	"breadth_cm" integer NOT NULL,
	"height_cm" integer NOT NULL,
	"mode" text NOT NULL,
	"charge_estimate" integer,
	"charged_weight_grams" integer,
	"expected_delivery_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"rto_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"scans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ndr_action" text,
	"ndr_request_id" text,
	"ndr_action_at" timestamp with time zone,
	"ndr_result" text,
	"pickup_request_id" integer,
	"last_synced_at" timestamp with time zone,
	"sync_error" text,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_waybill_unique" UNIQUE("waybill")
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "delhivery_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "delhivery_pickup_location" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "delhivery_origin_pin" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "delhivery_mode" text DEFAULT 'Surface' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "delhivery_auto_ship" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "delhivery_checkout_check" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ship_length_cm" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ship_breadth_cm" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ship_height_cm" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ship_packaging_grams" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ship_default_book_grams" integer DEFAULT 400 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ship_hsn_code" text DEFAULT '4901' NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pickup_requests_date_idx" ON "pickup_requests" USING btree ("pickup_date");--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status","last_synced_at");--> statement-breakpoint
-- Only the store's server reads these tables: lock them against Supabase's public API keys.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shipments', 'pickup_requests'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
