ALTER TABLE "accounts" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "channel" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "channel_detail" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "visit" jsonb;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "channel" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "channel_detail" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "popup_id" uuid;