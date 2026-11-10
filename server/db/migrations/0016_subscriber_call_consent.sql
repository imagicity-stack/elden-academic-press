ALTER TABLE "subscribers" ADD COLUMN "call_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "call_consent_at" timestamp with time zone;