ALTER TABLE "orders" ADD COLUMN "channel" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "source" jsonb;--> statement-breakpoint
CREATE INDEX "orders_channel_idx" ON "orders" USING btree ("channel");