ALTER TABLE "orders" ADD COLUMN "ad_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fbp" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fbc" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "user_agent" text;