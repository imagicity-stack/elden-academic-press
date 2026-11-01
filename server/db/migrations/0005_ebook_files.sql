ALTER TABLE "product_variants" ADD COLUMN "files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Existing e-books: their one file becomes the first (and only) entry of the list.
UPDATE "product_variants" SET "files" = jsonb_build_array(jsonb_build_object('path', "file_path", 'name', coalesce("file_name", ''), 'title', '', 'size', "file_size")) WHERE "file_path" IS NOT NULL AND "files" = '[]'::jsonb;
