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
