ALTER TABLE "order_items" ADD COLUMN "includes_ebook" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "ebook_with_print" boolean DEFAULT false NOT NULL;