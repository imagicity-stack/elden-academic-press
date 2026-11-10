-- Elden Academic Press — database setup for Supabase
--
-- Run this ONCE on a new Supabase project:
--   Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
--
-- It creates the store's tables, locks them against Supabase's public API keys
-- (the store's server is the only thing that reads them), creates the storage
-- buckets for covers, Study Hub files and e-books, and adds the standard categories.
-- Everything runs as one transaction: if anything fails, nothing is changed.
-- "already exists" errors mean the database has already been set up.
--
-- Generated from server/db/migrations by `npm run db:setup-sql` — do not edit.

-- ===== 0000_init =====

CREATE TYPE "public"."admin_role" AS ENUM('owner', 'manager', 'staff');--> statement-breakpoint
CREATE TYPE "public"."coupon_type" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."enquiry_kind" AS ENUM('sample', 'bulk', 'teacher', 'dist', 'contact', 'proposal');--> statement-breakpoint
CREATE TYPE "public"."enquiry_status" AS ENUM('new', 'in_progress', 'closed');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('unfulfilled', 'packed', 'shipped', 'delivered', 'not_required');--> statement-breakpoint
CREATE TYPE "public"."level" AS ENUM('P', 'M', 'S', 'SS', 'C', 'H');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'partially_refunded', 'refunded', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."variant_kind" AS ENUM('print', 'digital', 'bundle');--> statement-breakpoint
CREATE SEQUENCE "public"."order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 100001 CACHE 1;--> statement-breakpoint
CREATE TABLE "admin_users" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"role" "admin_role" DEFAULT 'staff' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"details" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" "coupon_type" NOT NULL,
	"value" integer NOT NULL,
	"min_subtotal" integer DEFAULT 0 NOT NULL,
	"max_discount" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"usage_limit" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"once_per_customer" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"total_spent" integer DEFAULT 0 NOT NULL,
	"first_order_at" timestamp with time zone,
	"last_order_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "enquiry_kind" NOT NULL,
	"status" "enquiry_status" DEFAULT 'new' NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"institution" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"data" jsonb,
	"handled_by" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"stock_after" integer NOT NULL,
	"reason" text NOT NULL,
	"order_id" uuid,
	"actor" text DEFAULT 'system' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_counters" (
	"fy" text PRIMARY KEY NOT NULL,
	"last" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"actor" text DEFAULT 'system' NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_kind" "variant_kind" NOT NULL,
	"title" text NOT NULL,
	"format_label" text NOT NULL,
	"sku" text,
	"unit_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" integer NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"taxable_value" integer DEFAULT 0 NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"tax_rate" smallint DEFAULT 0 NOT NULL,
	"requires_shipping" boolean NOT NULL,
	"is_digital" boolean NOT NULL,
	"weight_grams" integer DEFAULT 0 NOT NULL,
	"downloads_used" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer DEFAULT nextval('order_number_seq') NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"ship_name" text,
	"ship_line1" text,
	"ship_line2" text,
	"ship_city" text,
	"ship_state" text,
	"ship_pincode" text,
	"billing_state" text NOT NULL,
	"requires_shipping" boolean NOT NULL,
	"subtotal" integer NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"shipping" integer DEFAULT 0 NOT NULL,
	"tax" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"coupon_code" text,
	"payment_status" "payment_status" DEFAULT 'pending' NOT NULL,
	"fulfillment_status" "fulfillment_status" DEFAULT 'unfulfilled' NOT NULL,
	"razorpay_order_id" text,
	"razorpay_payment_id" text,
	"payment_method" text,
	"paid_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"stock_reserved" boolean DEFAULT false NOT NULL,
	"invoice_number" text,
	"invoice_date" timestamp with time zone,
	"courier" text,
	"tracking_number" text,
	"tracking_url" text,
	"packed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"refunded_amount" integer DEFAULT 0 NOT NULL,
	"customer_note" text DEFAULT '' NOT NULL,
	"internal_note" text DEFAULT '' NOT NULL,
	"needs_attention" boolean DEFAULT false NOT NULL,
	"attention_reason" text,
	"customer_id" uuid,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_number_unique" UNIQUE("number"),
	CONSTRAINT "orders_razorpay_order_id_unique" UNIQUE("razorpay_order_id"),
	CONSTRAINT "orders_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"razorpay_payment_id" text NOT NULL,
	"razorpay_order_id" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text NOT NULL,
	"method" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_razorpay_payment_id_unique" UNIQUE("razorpay_payment_id")
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" "variant_kind" NOT NULL,
	"price" integer NOT NULL,
	"compare_at_price" integer,
	"sku" text,
	"stock" integer DEFAULT 0 NOT NULL,
	"track_stock" boolean DEFAULT true NOT NULL,
	"weight_grams" integer,
	"tax_rate" smallint DEFAULT 0 NOT NULL,
	"file_path" text,
	"file_name" text,
	"file_size" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variants_price_check" CHECK ("product_variants"."price" >= 0),
	CONSTRAINT "variants_stock_check" CHECK ("product_variants"."stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"series" text DEFAULT '' NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"blurb" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_id" integer,
	"level" "level" NOT NULL,
	"class_label" text DEFAULT '' NOT NULL,
	"grade" smallint,
	"boards" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"language" text DEFAULT 'English' NOT NULL,
	"pages" integer,
	"edition" text DEFAULT '' NOT NULL,
	"isbn" text DEFAULT '' NOT NULL,
	"highlights" text[] DEFAULT '{}'::text[] NOT NULL,
	"contents" text[] DEFAULT '{}'::text[] NOT NULL,
	"cover_path" text,
	"cover_palette" smallint DEFAULT 0 NOT NULL,
	"has_companion" boolean DEFAULT false NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"seo_title" text DEFAULT '' NOT NULL,
	"seo_description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"razorpay_refund_id" text,
	"razorpay_payment_id" text NOT NULL,
	"amount" integer NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"restocked" boolean DEFAULT false NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_razorpay_refund_id_unique" UNIQUE("razorpay_refund_id")
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"level" "level" NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"file_path" text,
	"file_size" integer,
	"published" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"store_name" text DEFAULT 'Elden Academic Press' NOT NULL,
	"legal_name" text DEFAULT 'Elden Academic Press' NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"address" text DEFAULT 'Hazaribagh, Jharkhand' NOT NULL,
	"state_code" text DEFAULT '20' NOT NULL,
	"support_email" text DEFAULT 'hello@eldenap.in' NOT NULL,
	"support_phone" text DEFAULT '' NOT NULL,
	"shipping_flat" integer DEFAULT 6000 NOT NULL,
	"free_shipping_above" integer DEFAULT 99900 NOT NULL,
	"order_expiry_minutes" integer DEFAULT 30 NOT NULL,
	"invoice_prefix" text DEFAULT 'EAP' NOT NULL,
	"notify_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"require_mfa" boolean DEFAULT true NOT NULL,
	"low_stock_threshold" integer DEFAULT 5 NOT NULL,
	"max_downloads" integer DEFAULT 10 NOT NULL,
	"download_expiry_days" integer DEFAULT 365 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "enquiries_status_idx" ON "enquiries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "enquiries_created_idx" ON "enquiries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inventory_variant_idx" ON "inventory_movements" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_payment_idx" ON "orders" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "orders_email_idx" ON "orders" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_product_kind_idx" ON "product_variants" USING btree ("product_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_sku_idx" ON "product_variants" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");

-- ===== 0001_security =====

-- Security: every store table is reachable only through the server API.
-- Row Level Security is switched on with no policies, so Supabase's public
-- (anon / authenticated) API keys can read or write nothing here. The server
-- connects as the database owner, which bypasses RLS.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ===== 0002_supabase_storage =====

-- Supabase-only setup (skipped automatically on other Postgres, e.g. local PGlite).
DO $$
BEGIN
  -- Tables created later start locked as well.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
  END IF;

  -- File storage: covers and Study Hub files are public; e-books are private
  -- and only ever served through short-lived signed links.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
      ('covers', 'covers', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
      ('resources', 'resources', true, 52428800, ARRAY['application/pdf']),
      ('ebooks', 'ebooks', false, 314572800, ARRAY['application/pdf', 'application/epub+zip'])
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

-- ===== 0003_newsletter =====

CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'sent', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."send_status" AS ENUM('queued', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."subscriber_status" AS ENUM('pending', 'subscribed', 'unsubscribed');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"status" "send_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"preheader" text DEFAULT '' NOT NULL,
	"heading" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"cta_label" text DEFAULT '' NOT NULL,
	"cta_url" text DEFAULT '' NOT NULL,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"recipients" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"status" "subscriber_status" DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"consent_at" timestamp with time zone,
	"consent_ip" text,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscribers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "newsletter_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "newsletter_daily_limit" integer DEFAULT 1500 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_email_idx" ON "accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_sends_unique" ON "campaign_sends" USING btree ("campaign_id","subscriber_id");--> statement-breakpoint
CREATE INDEX "campaign_sends_queue_idx" ON "campaign_sends" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "campaign_sends_sent_idx" ON "campaign_sends" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscribers_status_idx" ON "subscribers" USING btree ("status");--> statement-breakpoint
-- Only the store's server reads these, like every other table (see 0001_security).
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscribers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_sends" ENABLE ROW LEVEL SECURITY;

-- ===== 0004_meta_tracking =====

ALTER TABLE "orders" ADD COLUMN "ad_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fbp" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fbc" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "user_agent" text;

-- ===== 0005_ebook_files =====

ALTER TABLE "product_variants" ADD COLUMN "files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Existing e-books: their one file becomes the first (and only) entry of the list.
UPDATE "product_variants" SET "files" = jsonb_build_array(jsonb_build_object('path', "file_path", 'name', coalesce("file_name", ''), 'title', '', 'size', "file_size")) WHERE "file_path" IS NOT NULL AND "files" = '[]'::jsonb;

-- ===== 0006_ebook_with_print =====

ALTER TABLE "order_items" ADD COLUMN "includes_ebook" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "ebook_with_print" boolean DEFAULT false NOT NULL;

-- ===== 0007_cash_on_delivery =====

ALTER TABLE "orders" ADD COLUMN "payment_mode" text DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cod_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cod_collected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "cod_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "cod_advance" integer DEFAULT 6000 NOT NULL;

-- ===== 0008_product_images =====

ALTER TABLE "products" ADD COLUMN "images" jsonb DEFAULT '[]'::jsonb NOT NULL;

-- ===== 0009_competitions =====

CREATE TYPE "public"."account_type" AS ENUM('parent', 'student');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."comp_email_type" AS ENUM('registration_confirmed', 'submission_received');--> statement-breakpoint
CREATE TYPE "public"."competition_type" AS ENUM('comic', 'story', 'essay', 'drawing', 'poem', 'quiz', 'video', 'photo', 'live_event', 'other');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('data_processing', 'publication', 'marketing');--> statement-breakpoint
CREATE TYPE "public"."email_audience" AS ENUM('parent', 'student');--> statement-breakpoint
CREATE TYPE "public"."file_kind" AS ENUM('main', 'extra');--> statement-breakpoint
CREATE TYPE "public"."form_field_type" AS ENUM('text', 'textarea', 'select', 'multiselect', 'checkbox', 'number');--> statement-breakpoint
CREATE TYPE "public"."notify_channel" AS ENUM('email', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."notify_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."participation_mode" AS ENUM('individual', 'team');--> statement-breakpoint
CREATE TYPE "public"."prize_type" AS ENUM('physical', 'voucher', 'digital', 'certificate');--> statement-breakpoint
CREATE TYPE "public"."publish_state" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."region_scope" AS ENUM('pan_india', 'states');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('registered', 'withdrawn', 'disqualified');--> statement-breakpoint
CREATE TYPE "public"."resource_visibility" AS ENUM('public', 'registered_only');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('draft', 'submitted', 'withdrawn', 'under_review', 'shortlisted', 'winner', 'disqualified');--> statement-breakpoint
CREATE TABLE "competition_email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"template_type" "comp_email_type" NOT NULL,
	"audience" "email_audience" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"subject" text NOT NULL,
	"preheader" text DEFAULT '' NOT NULL,
	"banner_image_key" text,
	"banner_alt" text DEFAULT '' NOT NULL,
	"heading" text NOT NULL,
	"body_content" text NOT NULL,
	"primary_cta_label" text DEFAULT '' NOT NULL,
	"primary_cta_url" text DEFAULT '' NOT NULL,
	"secondary_cta_label" text DEFAULT '' NOT NULL,
	"secondary_cta_url" text DEFAULT '' NOT NULL,
	"blocks" jsonb NOT NULL,
	"attachment_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition_form_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" "form_field_type" NOT NULL,
	"options" text[] DEFAULT '{}'::text[] NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"help_text" text DEFAULT '' NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"name" text NOT NULL,
	"letter" text NOT NULL,
	"class_min" smallint NOT NULL,
	"class_max" smallint NOT NULL,
	"format_note" text DEFAULT '' NOT NULL,
	"min_words" integer,
	"max_words" integer,
	"max_main_files" smallint,
	"next_entry_no" integer DEFAULT 1 NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "group_class_range" CHECK (class_min BETWEEN 3 AND 12 AND class_max BETWEEN class_min AND 12)
);
--> statement-breakpoint
CREATE TABLE "competition_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"visibility" "resource_visibility" DEFAULT 'registered_only' NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"entry_code_prefix" text NOT NULL,
	"title" text NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"type" "competition_type" DEFAULT 'other' NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rules_content" text DEFAULT '' NOT NULL,
	"rules_pdf_key" text,
	"disclaimer" text DEFAULT '' NOT NULL,
	"thumbnail_9x16_key" text,
	"image_1x1_key" text,
	"banner_16x9_key" text,
	"languages" text[] DEFAULT '{English}'::text[] NOT NULL,
	"organiser_name" text DEFAULT 'Elden Academic Press' NOT NULL,
	"faqs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"judges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"region_scope" "region_scope" DEFAULT 'pan_india' NOT NULL,
	"states" text[] DEFAULT '{}'::text[] NOT NULL,
	"participation_mode" "participation_mode" DEFAULT 'individual' NOT NULL,
	"team_min" smallint,
	"team_max" smallint,
	"max_entries_per_student" smallint DEFAULT 1 NOT NULL,
	"is_paid" boolean DEFAULT false NOT NULL,
	"fee_amount_inr" integer,
	"seat_cap" integer,
	"announce_at" timestamp with time zone,
	"registration_opens_at" timestamp with time zone,
	"registration_closes_at" timestamp with time zone,
	"submission_opens_at" timestamp with time zone,
	"submission_closes_at" timestamp with time zone,
	"submission_grace_minutes" smallint DEFAULT 0 NOT NULL,
	"judging_starts_at" timestamp with time zone,
	"shortlist_at" timestamp with time zone,
	"voting_opens_at" timestamp with time zone,
	"voting_closes_at" timestamp with time zone,
	"results_at" timestamp with time zone,
	"submission_required" boolean DEFAULT true NOT NULL,
	"allowed_submission_types" text[] DEFAULT '{file}'::text[] NOT NULL,
	"allowed_mime_types" text[] DEFAULT '{image/jpeg,image/png,application/pdf}'::text[] NOT NULL,
	"max_file_size_mb" smallint DEFAULT 10 NOT NULL,
	"max_main_files" smallint DEFAULT 1 NOT NULL,
	"extra_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_words" integer,
	"max_words" integer,
	"allow_edit_until_deadline" boolean DEFAULT true NOT NULL,
	"allow_withdraw" boolean DEFAULT true NOT NULL,
	"declaration_text" text DEFAULT '' NOT NULL,
	"consent_text_version" text DEFAULT 'v1' NOT NULL,
	"terms_version" text DEFAULT 'v1' NOT NULL,
	"upsell_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seo_title" text DEFAULT '' NOT NULL,
	"seo_description" text DEFAULT '' NOT NULL,
	"og_image_key" text,
	"publish_state" "publish_state" DEFAULT 'draft' NOT NULL,
	"results_published" boolean DEFAULT false NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitions_slug_unique" UNIQUE("slug"),
	CONSTRAINT "competitions_entry_code_prefix_unique" UNIQUE("entry_code_prefix"),
	CONSTRAINT "entry_prefix_format" CHECK (entry_code_prefix ~ '^[A-Z]{2,4}$')
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"given_by_user_id" uuid NOT NULL,
	"competition_id" uuid,
	"consent_type" "consent_type" NOT NULL,
	"text_version" text NOT NULL,
	"granted" boolean NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"to_address" text NOT NULL,
	"student_profile_id" uuid,
	"registration_id" uuid,
	"template" text NOT NULL,
	"channel" "notify_channel" DEFAULT 'email' NOT NULL,
	"status" "notify_status" DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parent_approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"parent_name" text NOT NULL,
	"parent_whatsapp" text NOT NULL,
	"parent_email" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "parent_approval_requests_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "prizes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"group_id" uuid,
	"rank_from" smallint,
	"rank_to" smallint,
	"award_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"prize_type" "prize_type" DEFAULT 'certificate' NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"registered_by_user_id" uuid NOT NULL,
	"registered_by_type" "account_type" NOT NULL,
	"class_at_registration" smallint NOT NULL,
	"status" "registration_status" DEFAULT 'registered' NOT NULL,
	"disqualify_reason" text DEFAULT '' NOT NULL,
	"custom_answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"how_heard" text DEFAULT '' NOT NULL,
	"utm_source" text DEFAULT '' NOT NULL,
	"utm_medium" text DEFAULT '' NOT NULL,
	"utm_campaign" text DEFAULT '' NOT NULL,
	"utm_content" text DEFAULT '' NOT NULL,
	"utm_term" text DEFAULT '' NOT NULL,
	"referral_code" text NOT NULL,
	"referred_by_code" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registrations_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "resource_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"registration_id" uuid,
	"user_id" uuid,
	"downloaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_guardians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"parent_user_id" uuid NOT NULL,
	"relation" text DEFAULT '' NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_login_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"created_by_parent_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_by_user_id" uuid,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_login_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "student_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_user_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"class_grade" smallint NOT NULL,
	"school_name" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"approval_status" "approval_status" DEFAULT 'pending' NOT NULL,
	"approved_at" timestamp with time zone,
	"class_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "student_class_range" CHECK (class_grade BETWEEN 3 AND 12)
);
--> statement-breakpoint
CREATE TABLE "submission_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"kind" "file_kind" NOT NULL,
	"extra_key" text,
	"storage_key" text NOT NULL,
	"thumbnail_key" text,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"original_name" text DEFAULT '' NOT NULL,
	"verified_at" timestamp with time zone,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"entry_code" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"language" text DEFAULT '' NOT NULL,
	"text_content" text DEFAULT '' NOT NULL,
	"link_url" text DEFAULT '' NOT NULL,
	"status" "submission_status" DEFAULT 'draft' NOT NULL,
	"submitted_by_user_id" uuid,
	"last_edited_by_user_id" uuid,
	"declaration_accepted_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"admin_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"admin_notes" text DEFAULT '' NOT NULL,
	"hidden_from_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_entry_code_unique" UNIQUE("entry_code")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "account_type" "account_type";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "full_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "whatsapp" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "city" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "state" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "type_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competition_email_templates" ADD CONSTRAINT "competition_email_templates_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_form_fields" ADD CONSTRAINT "competition_form_fields_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_groups" ADD CONSTRAINT "competition_groups_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_resources" ADD CONSTRAINT "competition_resources_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_approval_requests" ADD CONSTRAINT "parent_approval_requests_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_group_id_competition_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."competition_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_downloads" ADD CONSTRAINT "resource_downloads_resource_id_competition_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."competition_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_login_invites" ADD CONSTRAINT "student_login_invites_student_profile_id_student_profiles_id_fk" FOREIGN KEY ("student_profile_id") REFERENCES "public"."student_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comp_email_idx" ON "competition_email_templates" USING btree ("competition_id","template_type","audience");--> statement-breakpoint
CREATE UNIQUE INDEX "form_field_key_idx" ON "competition_form_fields" USING btree ("competition_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "group_letter_idx" ON "competition_groups" USING btree ("competition_id","letter");--> statement-breakpoint
CREATE INDEX "competitions_state_idx" ON "competitions" USING btree ("publish_state");--> statement-breakpoint
CREATE INDEX "consent_student_idx" ON "consent_records" USING btree ("student_profile_id","consent_type","created_at");--> statement-breakpoint
CREATE INDEX "notification_retry_idx" ON "notification_log" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "notification_registration_idx" ON "notification_log" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "approval_student_idx" ON "parent_approval_requests" USING btree ("student_profile_id");--> statement-breakpoint
CREATE INDEX "approval_status_idx" ON "parent_approval_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "registration_once_idx" ON "registrations" USING btree ("competition_id","student_profile_id");--> statement-breakpoint
CREATE INDEX "registration_comp_idx" ON "registrations" USING btree ("competition_id","created_at");--> statement-breakpoint
CREATE INDEX "registration_student_idx" ON "registrations" USING btree ("student_profile_id");--> statement-breakpoint
CREATE INDEX "resource_downloads_idx" ON "resource_downloads" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_pair_idx" ON "student_guardians" USING btree ("student_profile_id","parent_user_id");--> statement-breakpoint
CREATE INDEX "guardian_parent_idx" ON "student_guardians" USING btree ("parent_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_user_idx" ON "student_profiles" USING btree ("student_user_id") WHERE student_user_id IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "student_status_idx" ON "student_profiles" USING btree ("approval_status","created_at");--> statement-breakpoint
CREATE INDEX "submission_files_idx" ON "submission_files" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "submission_registration_idx" ON "submissions" USING btree ("registration_id");--> statement-breakpoint
-- Only the store's server reads these tables: lock them against Supabase's public API keys.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_profiles', 'student_guardians', 'parent_approval_requests', 'student_login_invites', 'consent_records',
    'competitions', 'competition_groups', 'competition_form_fields', 'competition_resources', 'resource_downloads', 'prizes',
    'competition_email_templates', 'registrations', 'submissions', 'submission_files', 'notification_log'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- New storage buckets (existing buckets are left exactly as they are):
--   competition-entries: students' work, private, signed links only
--   competition-files:   registered-only resources and email attachments, private
--   competition-media:   banners, thumbnails, judge photos, public resources (marketing images only)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
      ('competition-entries', 'competition-entries', false, 52428800, NULL),
      ('competition-files', 'competition-files', false, 52428800, NULL),
      ('competition-media', 'competition-media', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- ===== 0010_newsletter_everyone_subscribed =====

-- The newsletter has no confirmation-email step any more: everyone who signed up
-- is subscribed. Changes subscriber statuses only; nobody who unsubscribed is touched.
-- 1. People waiting for a confirmation email they never clicked: subscribed now.
UPDATE "subscribers" SET "status" = 'subscribed', "consent_at" = COALESCE("consent_at", "created_at"), "updated_at" = now()
WHERE "status" = 'pending';--> statement-breakpoint
-- 2. Signed-up accounts not on the list at all (they never unsubscribed): subscribed now.
INSERT INTO "subscribers" ("email", "name", "phone", "status", "source", "consent_at")
SELECT lower(a."email"), a."name", a."phone", 'subscribed', 'signup', a."created_at"
FROM "accounts" a
WHERE a."email" <> '' AND NOT EXISTS (SELECT 1 FROM "subscribers" s WHERE s."email" = lower(a."email"))
ON CONFLICT ("email") DO NOTHING;

-- ===== 0011_simple_competitions =====

CREATE TYPE "public"."signup_mode" AS ENUM('individual', 'group');--> statement-breakpoint
ALTER TYPE "public"."account_type" ADD VALUE 'teacher';--> statement-breakpoint
ALTER TYPE "public"."account_type" ADD VALUE 'other';--> statement-breakpoint
CREATE TABLE "competition_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_slug" text NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"mode" "signup_mode" NOT NULL,
	"group_name" text DEFAULT '' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "signup_competition_idx" ON "competition_signups" USING btree ("competition_slug","created_at");--> statement-breakpoint
CREATE INDEX "signup_user_idx" ON "competition_signups" USING btree ("user_id");--> statement-breakpoint
-- Only the store's server reads this table: lock it against Supabase's public API keys.
ALTER TABLE public.competition_signups ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.competition_signups FROM anon, authenticated;
  END IF;
END $$;

-- ===== 0012_doomsday_diaries =====

CREATE TABLE "competition_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" jsonb NOT NULL,
	"emailed" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition_settings" (
	"slug" text PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_slug" text NOT NULL,
	"application_no" serial NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"team_name" text NOT NULL,
	"institution_type" text NOT NULL,
	"institution_name" text DEFAULT '' NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	"admin_notes" text DEFAULT '' NOT NULL,
	"result" text DEFAULT '' NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"accepted_terms_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_applications_application_no_unique" UNIQUE("application_no")
);
--> statement-breakpoint
CREATE TABLE "team_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text,
	"original_name" text DEFAULT '' NOT NULL,
	"size_bytes" integer NOT NULL,
	"pages" integer,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replaced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"full_name" text NOT NULL,
	"dob" date NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"institution_name" text DEFAULT '' NOT NULL,
	"roles" text[] NOT NULL,
	"instagram" text DEFAULT '' NOT NULL,
	"id_doc_type" text DEFAULT '' NOT NULL,
	"id_doc_key" text,
	"id_doc_deleted_at" timestamp with time zone,
	"guardian_name" text DEFAULT '' NOT NULL,
	"guardian_relation" text DEFAULT '' NOT NULL,
	"guardian_phone" text DEFAULT '' NOT NULL,
	"guardian_email" text DEFAULT '' NOT NULL,
	"guardian_consent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "dob" date;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "institution_type" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "institution_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "grade" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "guardian_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "guardian_phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "instagram" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_files" ADD CONSTRAINT "team_files_application_id_team_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."team_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_application_id_team_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."team_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notices_comp_idx" ON "competition_notices" USING btree ("competition_slug","created_at");--> statement-breakpoint
CREATE INDEX "team_app_comp_idx" ON "team_applications" USING btree ("competition_slug","status");--> statement-breakpoint
CREATE INDEX "team_app_user_idx" ON "team_applications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "team_files_app_idx" ON "team_files" USING btree ("application_id","kind");--> statement-breakpoint
CREATE INDEX "team_member_app_idx" ON "team_members" USING btree ("application_id");--> statement-breakpoint
-- Only the store's server reads these tables: lock them against Supabase's public API keys.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['team_applications', 'team_members', 'team_files', 'competition_notices', 'competition_settings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- Comic PDFs can be up to 100 MB: let the private entries bucket take files that size.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ('competition-entries', 'competition-entries', false, 110100480, NULL)
      ON CONFLICT (id) DO UPDATE SET file_size_limit = 110100480;
  END IF;
END $$;

-- ===== 0013_order_source =====

ALTER TABLE "orders" ADD COLUMN "channel" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "source" jsonb;--> statement-breakpoint
CREATE INDEX "orders_channel_idx" ON "orders" USING btree ("channel");

-- ===== 0014_popups =====

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

-- ===== 0015_calls =====

CREATE TABLE "call_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"phone" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"lead_id" uuid,
	"order_id" uuid,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_call_id" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"outcome" text DEFAULT '' NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transcript" text DEFAULT '' NOT NULL,
	"recording_url" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"issue_open" boolean DEFAULT false NOT NULL,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkout_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_key" text NOT NULL,
	"resume_token" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text NOT NULL,
	"items" jsonb NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"consent" boolean DEFAULT false NOT NULL,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_leads_client_key_unique" UNIQUE("client_key"),
	CONSTRAINT "checkout_leads_resume_token_unique" UNIQUE("resume_token")
);
--> statement-breakpoint
CREATE TABLE "do_not_call" (
	"phone" text PRIMARY KEY NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_lead_id_checkout_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."checkout_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_leads" ADD CONSTRAINT "checkout_leads_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_status_due_idx" ON "calls" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "calls_phone_idx" ON "calls" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "calls_created_idx" ON "calls" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_order_kind_uq" ON "calls" USING btree ("order_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_lead_kind_uq" ON "calls" USING btree ("lead_id","kind");--> statement-breakpoint
CREATE INDEX "checkout_leads_phone_idx" ON "checkout_leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "checkout_leads_updated_idx" ON "checkout_leads" USING btree ("updated_at");--> statement-breakpoint
-- Only the store's server reads these tables: lock them against Supabase's public API keys.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['checkout_leads', 'calls', 'do_not_call', 'call_settings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

-- ===== 0016_subscriber_call_consent =====

ALTER TABLE "subscribers" ADD COLUMN "call_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "call_consent_at" timestamp with time zone;

-- ===== 0017_whatsapp =====

CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"template" text DEFAULT '' NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"wa_id" text,
	"error" text DEFAULT '' NOT NULL,
	"lead_id" uuid,
	"order_id" uuid,
	"broadcast_id" text,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_wa_id_unique" UNIQUE("wa_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_opt_outs" (
	"phone" text PRIMARY KEY NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_lead_id_checkout_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."checkout_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wa_phone_created_idx" ON "whatsapp_messages" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "wa_status_due_idx" ON "whatsapp_messages" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_order_kind_uq" ON "whatsapp_messages" USING btree ("order_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_lead_kind_uq" ON "whatsapp_messages" USING btree ("lead_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_broadcast_phone_uq" ON "whatsapp_messages" USING btree ("broadcast_id","phone");

-- ===== 0018_audience_sources =====

ALTER TABLE "accounts" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "channel" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "channel_detail" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "visit" jsonb;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "channel" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "channel_detail" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "popup_id" uuid;

-- ===== 0019_competition_stats =====

CREATE TABLE "competition_stats" (
	"competition_slug" text NOT NULL,
	"day" date NOT NULL,
	"step" text NOT NULL,
	"channel" text NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "competition_stats_competition_slug_day_step_channel_pk" PRIMARY KEY("competition_slug","day","step","channel")
);

-- ===== Migration history =====

CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES
  ('120bc1ac5284b0f9abe3b85b591a6974e5fee6b2ac0cd9ab0665f6c6dc581f48', 1793363978141),
  ('2bf8e3ce6609203484f15a30fe4d28ea0d4096507fca5e1fda37aa97a2fcb9e0', 1793363978922),
  ('d551b96228e1cc509431a668ea8d88e5672d50239ed161f6d083b684cba35dbe', 1793366707702),
  ('a7c6aec2b7878ee57a12e1ff29aedca10c3defc0567e6aafee03cdfebcd7c937', 1793529577196),
  ('06e1e45bcfba4da04c42b09a0220e67611794880049f6b37c61e753680fe072f', 1793535992306),
  ('e09910d8155217384a52e517b0e56a99ceda1c8858b5dfb47883570d1f693426', 1793551879678),
  ('190fb71cd0a34eb8490872de5172c4afd8d22a046b4ba373f174be7d054e4746', 1793634337644),
  ('dc197dfbe066549b82b7d32fa81540df32d8d6d5d434dc434617fae1aba99c6c', 1793635408554),
  ('07532e555727a1411c522379409a1d69d133aec32b14593ad6b91d8f39a07580', 1793642571956),
  ('ab97a53bc5fb3d387de329e63003afe600dfe515c7b514957112ceabf20608cb', 1793889211762),
  ('1a5897f0da323e1f734702bbbd3a84d2b6e97939b93b98b60b9ceee6df9b1e40', 1793889801033),
  ('eb2aca73b402e91f1681d3967203712ba529f8785b8d68e4e47e9704ccef2790', 1793906418992),
  ('67ca6b68c889731c089bd83f44e3b7dd68024d6f48a03c96ccf0bb5770284db4', 1793974722937),
  ('ca67e5eb7c1a0c925e749fd5047d33769bce7929f647b088b20df06a62e2efb8', 1794060116138),
  ('7489535686d0e412f9126ae7ae8eef71e2658b9c8cc8a2c0f7441b09e41c36ec', 1794075566599),
  ('2da95727ebe54578ee765746eae40b632665e677c534ce7d0d6b760e78f8554f', 1794318591431),
  ('de313d410cc8760b7d8c8e81ec8a6a04bb1d8f7b93c2be7d9a2df2550262a73d', 1794322914293),
  ('44f53a68827b686d98b0eb0418dce2942b9b6b3732aa849d7cf46a6d5bc6950f', 1794326037898),
  ('4b29e4d37076384f804620c9a867f9a29044b0b3a7b8ea4f9d66b0f60bbec2e5', 1794335003607),
  ('f7171c94bb2cab04f493ae425ad30b664e454756c8a19c4b8ecae89989ad5b86', 1794337425917);

-- ===== Standard categories (rename or add more in the admin) =====

INSERT INTO categories (name, slug, sort) VALUES
  ('Textbooks', 'textbooks', 0),
  ('Reference books', 'reference-books', 1),
  ('Study guides', 'study-guides', 2),
  ('Practice papers', 'practice-papers', 3),
  ('Workbooks', 'workbooks', 4),
  ('Journals', 'journals', 5)
ON CONFLICT (slug) DO NOTHING;
