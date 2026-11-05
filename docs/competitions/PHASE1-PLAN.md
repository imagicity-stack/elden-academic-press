# Competitions, Phase 1: Step 0 report and plan

Status: **waiting for approval**. No competition code has been written. Nothing has been deployed or created in production.

---

## 1. Step 0: what the codebase actually is

The spec assumes Next.js. **This site is not Next.js.** It is a React single-page app with a separate API, both on Vercel. Everything below follows the existing patterns.

| Topic | What exists today |
|---|---|
| Framework | **React 19 + Vite 6**, TypeScript throughout. Routing with **React Router 7** (client-side). There is no App Router or Pages Router and no server-side rendering. |
| API | **Hono 4** running as one Vercel Function (`api/index.ts` → `server/app.ts`). All endpoints sit under `/api/*`. |
| Database / ORM | **Supabase Postgres** with **Drizzle ORM 0.45** (`server/db/schema.ts`). Migrations are generated with `drizzle-kit generate`. `npm run db:setup-sql` writes a SQL file per migration to `docs/supabase-updates/NNNN_*.sql`, and you run it in the Supabase SQL Editor before merging. Local development and tests use embedded Postgres (PGlite) and migrate automatically. |
| Customer auth | **Supabase Auth with Google**. The browser signs in with supabase-js. The API verifies the Supabase JWT (`jose`, JWKS) and requires a Google or verified email. The app's user record is the **`accounts`** table (`user_id` = Supabase user id, email, name, phone, avatar, last seen). There is no separate `users` table. |
| Admin auth | Separate staff logins: Supabase **email + password with required 2-step verification (TOTP)**. Staff live in **`admin_users`** with role `owner` / `manager` / `staff`, checked by `requireAdmin()` and `requireRole()` on the server. The admin area is the React app at **`/admin`**, and its API is under `/api/admin/*`. |
| File storage | **Supabase Storage** buckets: `covers` (public), `resources` (public), `ebooks` (private, with signed links that expire). Uploads go **directly from the browser to Supabase** with a signed upload URL issued by the API, so the Vercel body limit is never hit. |
| Email | **Google Workspace SMTP via nodemailer** (Resend is the fallback). Templates are **HTML strings built in TypeScript**, not React Email, MJML or provider-hosted. The shared `layout()` and helpers in `server/services/emails.ts` are table-based with inline CSS and use the EAP logo, colours and footer. Order, e-book, account, newsletter and campaign emails all use them. A plain-text part is generated automatically (`htmlToText`). Emails are sent after the response via Vercel `waitUntil`. |
| Payments | Razorpay (online, with a cash-on-delivery advance). |
| Scheduler | **Vercel Cron** (`vercel.json`): order expiry every 10 min, newsletter sending every 5 min, protected by `CRON_SECRET`. |
| Meta Pixel / analytics | GTM `GTM-P38DZ6G5` and GA4 `G-0TR5TFH9KP` load from the inline script in **`index.html`**, using Google Consent Mode; that script has a CSP hash in `vercel.json`. The **Meta Pixel** loads from **`src/meta.ts`** after cookie consent (`src/consent.ts`, `CookieBanner`). Meta Conversions API events come from the server (`server/services/tracking.ts`) and from the `/api/meta/event` relay. |
| Styling / UI | Plain CSS (`src/interior.css` for the site, `src/admin/admin.css` for the admin) and `motion` for animation. There is **no UI kit, no form library and no rich-text editor**. Forms are hand-built with shared `Field` components. |
| Validation | **zod 4** on every API endpoint (`body()` / `query()` helpers). |
| Hosting | **Vercel Pro**. The API region is `cdg1` (Paris), next to the Supabase project in eu-west-3. Functions have a **4.5 MB request-body limit** and `maxDuration` of 30 s. |
| Already reusable | `audit_log` table plus `audit()` helper; `rate_limits` table plus `rateLimit()`; `istDate` formatting; signed-upload helper; email layout; CSV export helper; markdown-ish `richText()` (bold, links, paragraphs). |
| Tests / lint | **vitest** with in-memory Postgres: 118 tests covering checkout, payments, admin, newsletter and more. Type checking runs as part of `npm run build`. **There is no ESLint config**, so "lint" here means `tsc`. Browser checks are done with Playwright scripts against the dev server. |

---

## 2. Where the spec needs adapting

1. **Next.js-specific items.** The routes in the spec (`/competitions/[slug]` and others) become React Router routes plus Hono API endpoints. Behaviour stays the same.
2. **Link previews on WhatsApp and Facebook.** These apps do not run JavaScript, so a client-rendered page shows no title or image when shared. This matters a lot for this audience.
   - Plan: a Vercel rewrite sends `/competitions/:slug` to the API, which returns the normal `index.html` with that competition's `<title>`, description and Open Graph / Twitter tags filled in.
   - No new dependency is needed. The same trick could later be applied to book pages.
3. **"User" table.** The spec's User fields go on our `accounts` table: account type, onboarding completed, full name, WhatsApp, city, state, type locked. **Roles stay on `admin_users`**, because staff are separate email-and-password accounts with 2-step verification, not Google customer accounts.
4. **Roles.** The `admin_role` enum is extended with `competition_manager`, `judge` and `support`. `owner` already plays the SUPER_ADMIN part. See decision D3.
5. **Audit log.** The existing `audit_log` table is reused (actor, action, entity, entity id, details JSON with the changes, IP). No second audit table is created.
6. **Rich text.** There is no editor library. Descriptions, rules and email bodies will use a **small Markdown subset**: bold, italics, links, numbered and bulleted lists, headings. Each field gets a toolbar (B, I, link, list) and a live preview. This extends the existing `richText()` renderer, with no new dependency.
7. **Conflicts with what's live.** These must change so students are never marketed to:
   - Every new Google sign-up is currently subscribed to the newsletter with a welcome email, and a Meta `CompleteRegistration` event is sent. Both will move to the moment someone **finishes onboarding as a Parent**. Students never get either.
   - An existing subscriber who chooses "I'm a Student" is unsubscribed.
   - For student sessions, the checkout's pre-ticked newsletter box is hidden and off, and no shop tracking events fire.

---

## 3. Decisions I need from you

My recommended default is listed first for each.

| # | Decision | Recommended | Alternative |
|---|---|---|---|
| **D1** | **Image safety: EXIF/GPS removal, file-signature check, thumbnails.** There is no image library today. | **No new dependency.** <br>• On the phone, photos are resized to max 2400 px and re-encoded before upload. This removes EXIF and GPS, and turns a 5 MB photo into about 1 MB, which helps a lot on slow 3G. A small thumbnail is made the same way. <br>• On the server, after upload, the file signature is checked, and a small built-in stripper losslessly removes any metadata left: JPEG APP1/APP13/COM, PNG eXIf/tEXt/iTXt/zTXt, WebP EXIF/XMP. Wrong or oversized files are deleted. <br>• The server step is the real guarantee, even if someone skips the browser step. | Add **`sharp`** (native image library). The server re-encodes every image and makes thumbnails itself. It is very robust, but adds about 10 MB to the function and some cold-start time. |
| **D2** | **QR code** for "Show QR code" on the approval screen. | Add **`qrcode-generator`**: MIT licence, no dependencies, about 50 KB, browser only. | Write our own QR encoder: around 300 lines, riskier, no gain. |
| **D3** | **Who can manage competitions.** | `owner` (= SUPER_ADMIN) and the new `competition_manager` get full access to competitions. Existing `manager` and `staff` keep the store only. `judge` and `support` are added to the enum but have no access in Phase 1. A competition manager **cannot** see store orders or customers. | Let store `manager`s manage competitions too. |
| **D4** | **Profile completion for shoppers.** | Show "Who is using this account?" once, right after Google sign-in, with a small **"Not now, I'm only shopping"** link. Shopping and orders work either way. Any competition action asks for it again until it's done. | Make it compulsory before anything else, which risks losing book buyers. |
| **D5** | **Students and the shop.** | A student account can still browse and buy, but with no newsletter box, no tracking and no upsells. | Block checkout for student accounts. |
| **D6** | **Storage buckets** (new). | <ul><li>`competition-entries`: **private**, students' work, random keys, signed links of 5 min</li><li>`competition-files`: **private**, registered-only resources and email attachments</li><li>`competition-media`: **public**, banners, thumbnails, judge photos, email banners and public resources, so marketing images only</li></ul>All three are created by the 0009 SQL. | Put everything in one private bucket and serve images through the API, which is slower. |
| **D7** | **Branch and testing database.** | Branch `feature/competitions`. All test data goes in local PGlite only. Pushing a branch makes Vercel build a **Preview** deployment; that isn't production, but **check whether your Vercel Preview environment uses the production `DATABASE_URL`**. If it does, previews must not be used for competition testing until a separate Supabase staging project exists. | Create a Supabase staging project now (free tier is enough) and point Vercel Preview at it. |
| **D8** | **First competition's dates.** | Please tell me when **registration** and **submissions** open. If submissions open after 14 Nov, I'll put registration first and finish submissions right after. | none |
| **D9** | **Consent and declaration wording.** | I'll draft the consent texts (data processing, publication, marketing), the default declaration and the privacy-policy additions in plain English, versioned as `v1`. You approve them; a quick legal review is recommended. | You supply the text. |

---

## 4. Proposed schema (Drizzle, `server/db/schema.ts`)

Everything is added in one migration, `0009_competitions`, and you run `docs/supabase-updates/0009_competitions.sql` before merging. Timestamps are `timestamptz` (UTC). Ids are UUIDs, as elsewhere.

```ts
/* ---------- Enums ---------- */
export const accountType = pgEnum('account_type', ['parent', 'student']);
// admin_role gains: 'competition_manager', 'judge', 'support'  (ALTER TYPE … ADD VALUE)
export const approvalStatus = pgEnum('approval_status', ['pending', 'approved', 'declined', 'expired']);
export const competitionType = pgEnum('competition_type', ['comic', 'story', 'essay', 'drawing', 'poem', 'quiz', 'video', 'photo', 'live_event', 'other']);
export const publishState = pgEnum('publish_state', ['draft', 'published', 'archived']);
export const regionScope = pgEnum('region_scope', ['pan_india', 'states']);
export const participationMode = pgEnum('participation_mode', ['individual', 'team']);
export const formFieldType = pgEnum('form_field_type', ['text', 'textarea', 'select', 'multiselect', 'checkbox', 'number']);
export const resourceVisibility = pgEnum('resource_visibility', ['public', 'registered_only']);
export const prizeType = pgEnum('prize_type', ['physical', 'voucher', 'digital', 'certificate']);
export const compEmailType = pgEnum('comp_email_type', ['registration_confirmed', 'submission_received']);
export const audience = pgEnum('audience', ['parent', 'student']);
export const consentType = pgEnum('consent_type', ['data_processing', 'publication', 'marketing']);
export const registrationStatus = pgEnum('registration_status', ['registered', 'withdrawn', 'disqualified']);
export const submissionStatus = pgEnum('submission_status', ['draft', 'submitted', 'withdrawn', 'under_review', 'shortlisted', 'winner', 'disqualified']);
export const fileKind = pgEnum('file_kind', ['main', 'extra']);
export const notifyChannel = pgEnum('notify_channel', ['email', 'whatsapp']);
export const notifyStatus = pgEnum('notify_status', ['queued', 'sent', 'failed']);

/* ---------- accounts (existing table, new columns) ---------- */
accountType: accountType('account_type'),                                  // null until onboarding
onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
fullName: text('full_name').notNull().default(''),
whatsapp: text('whatsapp').notNull().default(''),                          // parents only, 10 digits
city: text('city').notNull().default(''),
state: text('state').notNull().default(''),                                // GST state code, as at checkout
typeLockedAt: timestamp('type_locked_at', { withTimezone: true }),         // set when first linked

/* ---------- Students and guardians ---------- */
export const studentProfiles = pgTable('student_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentUserId: uuid('student_user_id'),                                  // their own login, if any
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  classGrade: smallint('class_grade').notNull(),                           // 3–12
  schoolName: text('school_name').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  approvalStatus: approvalStatus('approval_status').notNull().default('pending'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  classConfirmedAt: timestamp('class_confirmed_at', { withTimezone: true }), // yearly April check
  createdByUserId: uuid('created_by_user_id').notNull(),
  ...timestamps,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('student_user_idx').on(t.studentUserId).where(sql`student_user_id is not null and deleted_at is null`),
  check('student_class_range', sql`class_grade between 3 and 12`),
]);

export const studentGuardians = pgTable('student_guardians', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentProfileId: uuid('student_profile_id').notNull().references(() => studentProfiles.id, { onDelete: 'cascade' }),
  parentUserId: uuid('parent_user_id').notNull(),
  relation: text('relation').notNull().default(''),
  isPrimary: boolean('is_primary').notNull().default(true),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('guardian_pair_idx').on(t.studentProfileId, t.parentUserId), index('guardian_parent_idx').on(t.parentUserId)]);

export const parentApprovalRequests = pgTable('parent_approval_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentProfileId: uuid('student_profile_id').notNull().references(() => studentProfiles.id, { onDelete: 'cascade' }),
  parentName: text('parent_name').notNull(),
  parentWhatsapp: text('parent_whatsapp').notNull(),
  parentEmail: text('parent_email').notNull(),
  tokenHash: text('token_hash').notNull().unique(),                        // sha256 of a 32-byte random token
  status: approvalStatus('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),    // +7 days
  approvedByUserId: uuid('approved_by_user_id'),
  createdAt: timestamps.createdAt,
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const studentLoginInvites = pgTable('student_login_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentProfileId: uuid('student_profile_id').notNull().references(() => studentProfiles.id, { onDelete: 'cascade' }),
  createdByParentUserId: uuid('created_by_parent_user_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),    // +7 days
  claimedByUserId: uuid('claimed_by_user_id'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  createdAt: timestamps.createdAt,
});

export const consentRecords = pgTable('consent_records', {                 // append-only
  id: uuid('id').primaryKey().defaultRandom(),
  studentProfileId: uuid('student_profile_id').notNull(),
  givenByUserId: uuid('given_by_user_id').notNull(),                       // must be a linked parent
  competitionId: uuid('competition_id'),                                   // null in Phase 1 (account-level)
  consentType: consentType('consent_type').notNull(),
  textVersion: text('text_version').notNull(),
  granted: boolean('granted').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamps.createdAt,
}, (t) => [index('consent_student_idx').on(t.studentProfileId, t.consentType, t.createdAt)]);

/* ---------- Competitions ---------- */
export interface Faq { question: string; answer: string }
export interface Judge { name: string; role: string; photoKey: string | null }
export interface ExtraFileSpec { key: string; label: string; helpText: string; required: boolean }
export interface UpsellRule { classMin: number; classMax: number; productId: string | null; url: string | null; headline: string }

export const competitions = pgTable('competitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  entryCodePrefix: varchar('entry_code_prefix', { length: 4 }).notNull().unique(),   // 2–4 capitals
  title: text('title').notNull(),
  tagline: text('tagline').notNull().default(''),
  type: competitionType('type').notNull(),
  prompt: text('prompt').notNull().default(''),
  description: text('description').notNull().default(''),                 // Markdown subset
  rulesContent: text('rules_content').notNull().default(''),
  rulesPdfKey: text('rules_pdf_key'),
  disclaimer: text('disclaimer').notNull().default(''),
  thumbnail9x16Key: text('thumbnail_9x16_key'),
  image1x1Key: text('image_1x1_key'),
  banner16x9Key: text('banner_16x9_key'),
  languages: text('languages').array().notNull().default(sql`'{English}'::text[]`),
  organiserName: text('organiser_name').notNull().default('Elden Academic Press'),
  faqs: jsonb('faqs').$type<Faq[]>().notNull().default([]),
  judges: jsonb('judges').$type<Judge[]>().notNull().default([]),
  regionScope: regionScope('region_scope').notNull().default('pan_india'),
  states: text('states').array().notNull().default(sql`'{}'::text[]`),
  participationMode: participationMode('participation_mode').notNull().default('individual'),
  teamMin: smallint('team_min'), teamMax: smallint('team_max'),
  maxEntriesPerStudent: smallint('max_entries_per_student').notNull().default(1),
  isPaid: boolean('is_paid').notNull().default(false),
  feeAmountInr: integer('fee_amount_inr'),                                 // stored; Phase 1 free only
  seatCap: integer('seat_cap'),
  announceAt: timestamp('announce_at', { withTimezone: true }),
  registrationOpensAt: timestamp('registration_opens_at', { withTimezone: true }),
  registrationClosesAt: timestamp('registration_closes_at', { withTimezone: true }),
  submissionOpensAt: timestamp('submission_opens_at', { withTimezone: true }),
  submissionClosesAt: timestamp('submission_closes_at', { withTimezone: true }),
  submissionGraceMinutes: smallint('submission_grace_minutes').notNull().default(0),
  judgingStartsAt: timestamp('judging_starts_at', { withTimezone: true }),
  shortlistAt: timestamp('shortlist_at', { withTimezone: true }),
  votingOpensAt: timestamp('voting_opens_at', { withTimezone: true }),
  votingClosesAt: timestamp('voting_closes_at', { withTimezone: true }),
  resultsAt: timestamp('results_at', { withTimezone: true }),
  submissionRequired: boolean('submission_required').notNull().default(true),
  allowedSubmissionTypes: text('allowed_submission_types').array().notNull().default(sql`'{file}'::text[]`), // file | text | link
  allowedMimeTypes: text('allowed_mime_types').array().notNull().default(sql`'{image/jpeg,image/png,application/pdf}'::text[]`),
  maxFileSizeMb: smallint('max_file_size_mb').notNull().default(10),
  maxMainFiles: smallint('max_main_files').notNull().default(1),
  extraFiles: jsonb('extra_files').$type<ExtraFileSpec[]>().notNull().default([]),
  minWords: integer('min_words'), maxWords: integer('max_words'),
  allowEditUntilDeadline: boolean('allow_edit_until_deadline').notNull().default(true),
  allowWithdraw: boolean('allow_withdraw').notNull().default(true),
  declarationText: text('declaration_text').notNull().default(''),
  consentTextVersion: text('consent_text_version').notNull().default('v1'),
  termsVersion: text('terms_version').notNull().default('v1'),
  upsellRules: jsonb('upsell_rules').$type<UpsellRule[]>().notNull().default([]),
  seoTitle: text('seo_title').notNull().default(''),
  seoDescription: text('seo_description').notNull().default(''),
  ogImageKey: text('og_image_key'),
  publishState: publishState('publish_state').notNull().default('draft'),
  resultsPublished: boolean('results_published').notNull().default(false),
  createdBy: text('created_by').notNull(),
  ...timestamps,
}, (t) => [check('entry_prefix_format', sql`entry_code_prefix ~ '^[A-Z]{2,4}$'`)]);

export const competitionGroups = pgTable('competition_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  competitionId: uuid('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),                                            // "Group A"
  letter: varchar('letter', { length: 1 }).notNull(),                      // used in entry codes
  classMin: smallint('class_min').notNull(), classMax: smallint('class_max').notNull(),
  formatNote: text('format_note').notNull().default(''),
  minWords: integer('min_words'), maxWords: integer('max_words'), maxMainFiles: smallint('max_main_files'),
  nextEntryNo: integer('next_entry_no').notNull().default(1),              // atomic counter for entry codes
  sortOrder: smallint('sort_order').notNull().default(0),
}, (t) => [uniqueIndex('group_letter_idx').on(t.competitionId, t.letter)]);
// No-overlap of class ranges: checked on save, inside the transaction.

export const competitionFormFields = pgTable('competition_form_fields', {
  id: uuid('id').primaryKey().defaultRandom(),
  competitionId: uuid('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  key: text('key').notNull(), label: text('label').notNull(), type: formFieldType('type').notNull(),
  options: text('options').array().notNull().default(sql`'{}'::text[]`),
  required: boolean('required').notNull().default(false),
  helpText: text('help_text').notNull().default(''),
  sortOrder: smallint('sort_order').notNull().default(0),
}, (t) => [uniqueIndex('form_field_key_idx').on(t.competitionId, t.key)]);

export const competitionResources = pgTable('competition_resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  competitionId: uuid('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  title: text('title').notNull(), description: text('description').notNull().default(''),
  fileKey: text('file_key').notNull(),                                     // public → competition-media, registered → competition-files
  visibility: resourceVisibility('visibility').notNull().default('registered_only'),
  sortOrder: smallint('sort_order').notNull().default(0),
});

export const resourceDownloads = pgTable('resource_downloads', {
  id: uuid('id').primaryKey().defaultRandom(),
  resourceId: uuid('resource_id').notNull().references(() => competitionResources.id, { onDelete: 'cascade' }),
  registrationId: uuid('registration_id'),
  userId: uuid('user_id'),
  downloadedAt: timestamp('downloaded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const prizes = pgTable('prizes', {
  id: uuid('id').primaryKey().defaultRandom(),
  competitionId: uuid('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id'),                                               // null = all groups
  rankFrom: smallint('rank_from'), rankTo: smallint('rank_to'),            // null = special award
  awardName: text('award_name').notNull(), description: text('description').notNull().default(''),
  prizeType: prizeType('prize_type').notNull(),
  sortOrder: smallint('sort_order').notNull().default(0),
});

export interface EmailBlocks { showDetails: boolean; showPrizes: boolean; showRules: boolean; showResources: boolean; showReferral: boolean; showUpsell: boolean }
export const competitionEmailTemplates = pgTable('competition_email_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  competitionId: uuid('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  templateType: compEmailType('template_type').notNull(),
  audience: audience('audience').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  subject: text('subject').notNull(), preheader: text('preheader').notNull().default(''),
  bannerImageKey: text('banner_image_key'), bannerAlt: text('banner_alt').notNull().default(''),
  heading: text('heading').notNull(), bodyContent: text('body_content').notNull(),
  primaryCtaLabel: text('primary_cta_label').notNull().default(''), primaryCtaUrl: text('primary_cta_url').notNull().default(''),
  secondaryCtaLabel: text('secondary_cta_label').notNull().default(''), secondaryCtaUrl: text('secondary_cta_url').notNull().default(''),
  blocks: jsonb('blocks').$type<EmailBlocks>().notNull(),
  attachmentKeys: text('attachment_keys').array().notNull().default(sql`'{}'::text[]`),
  updatedByUserId: text('updated_by').notNull().default(''),
  updatedAt: timestamps.updatedAt,
}, (t) => [uniqueIndex('comp_email_idx').on(t.competitionId, t.templateType, t.audience)]);

/* ---------- Registrations and submissions ---------- */
export const registrations = pgTable('registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  competitionId: uuid('competition_id').notNull().references(() => competitions.id),
  groupId: uuid('group_id').notNull().references(() => competitionGroups.id),
  studentProfileId: uuid('student_profile_id').notNull().references(() => studentProfiles.id),
  registeredByUserId: uuid('registered_by_user_id').notNull(),
  registeredByType: accountType('registered_by_type').notNull(),
  classAtRegistration: smallint('class_at_registration').notNull(),
  status: registrationStatus('status').notNull().default('registered'),
  disqualifyReason: text('disqualify_reason').notNull().default(''),
  customAnswers: jsonb('custom_answers').$type<Record<string, unknown>>().notNull().default({}),
  howHeard: text('how_heard').notNull().default(''),
  utmSource: text('utm_source').notNull().default(''), utmMedium: text('utm_medium').notNull().default(''),
  utmCampaign: text('utm_campaign').notNull().default(''), utmContent: text('utm_content').notNull().default(''), utmTerm: text('utm_term').notNull().default(''),
  referralCode: text('referral_code').notNull().unique(),
  referredByCode: text('referred_by_code').notNull().default(''),
  createdAt: timestamps.createdAt,
}, (t) => [uniqueIndex('registration_once_idx').on(t.competitionId, t.studentProfileId), index('registration_comp_idx').on(t.competitionId, t.createdAt)]);

export const submissions = pgTable('submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  registrationId: uuid('registration_id').notNull().references(() => registrations.id),
  entryCode: text('entry_code').notNull().unique(),                        // ABC-A-0042
  title: text('title').notNull().default(''), language: text('language').notNull().default(''),
  textContent: text('text_content').notNull().default(''), linkUrl: text('link_url').notNull().default(''),
  status: submissionStatus('status').notNull().default('draft'),
  submittedByUserId: uuid('submitted_by_user_id'), lastEditedByUserId: uuid('last_edited_by_user_id'),
  declarationAcceptedAt: timestamp('declaration_accepted_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  adminFlags: text('admin_flags').array().notNull().default(sql`'{}'::text[]`), // suspected_ai | possibly_copied | content_issue
  adminNotes: text('admin_notes').notNull().default(''),
  hiddenFromPublic: boolean('hidden_from_public').notNull().default(false),
  ...timestamps,
});

export const submissionFiles = pgTable('submission_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id, { onDelete: 'cascade' }),
  kind: fileKind('kind').notNull(), extraKey: text('extra_key'),
  storageKey: text('storage_key').notNull(), thumbnailKey: text('thumbnail_key'),
  mimeType: text('mime_type').notNull(), sizeBytes: integer('size_bytes').notNull(),
  width: integer('width'), height: integer('height'),
  originalName: text('original_name').notNull().default(''),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),            // signature checked + metadata stripped
  sortOrder: smallint('sort_order').notNull().default(0),
  uploadedByUserId: uuid('uploaded_by_user_id').notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notificationLog = pgTable('notification_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'), toAddress: text('to_address').notNull(),
  studentProfileId: uuid('student_profile_id'), registrationId: uuid('registration_id'),
  template: text('template').notNull(),
  channel: notifyChannel('channel').notNull().default('email'),
  status: notifyStatus('status').notNull().default('queued'),
  attempts: smallint('attempts').notNull().default(0),
  payload: jsonb('payload'),                                               // what to rebuild for a retry (ids only, no HTML)
  error: text('error'), sentAt: timestamp('sent_at', { withTimezone: true }), createdAt: timestamps.createdAt,
}, (t) => [index('notify_retry_idx').on(t.status, t.createdAt)]);
```

**Later phases:** rubric, judge assignments, scores, votes, certificates, prize fulfilment, team entries and a second guardian. Each fits as new tables keyed on `competitions.id`, `submissions.id` or `student_profiles.id`, without changing the tables above. `student_guardians` already allows more than one guardian.

---

## 5. Routes and pages

### Website (React Router)

| Route | Who | What |
|---|---|---|
| `/onboarding` | signed-in | "Who is using this account?" followed by the Parent path (details → children → consents → optional login invite) or the Student path (details → parent details → waiting screen with WhatsApp share, QR, resend and edit) |
| `/approve/:token` | anyone, then the parent signs in | Approval page: student's first name, class and school. Sign in with Google; self-approval and student accounts are refused. Parent details inline if needed, consents, Approve or Decline, and merge if the child already exists |
| `/invite/:token` | the student | Claim a parent's login invite (refused for the parent's own account) |
| `/account/students` | parents | Children list, add, edit, consents, "Give their own login", delete |
| `/account/competitions` | parent, student | Entries with status, countdown, resources, Submit/Edit and receipt |
| `/competitions` | everyone | Open / Upcoming / Past tabs, class filter, cards with status badge and countdown, "Eligible for Riya" badges |
| `/competitions/:slug` | everyone | Hero, prompt, groups, IST timeline, prizes, judges, rules, FAQs, disclaimer, countdown. The main button depends on status and who's looking. OG tags are server-filled |
| `/competitions/:slug/register` | parent, approved student | One step: pick the child (parent), group shown automatically, only the custom questions |
| `/competitions/:slug/registered/:id` | owner of the entry | Confirmation: registration ID, IST deadline, unlocked resources, referral link, upsell (parents only) |
| `/competitions/:slug/entry/:id` | owner of the entry | Submission page: files with progress bars and retry, extra files, title, language, text with live word count, link, draft, preview, declaration, submit, edit and withdraw |
| `/competitions/:slug/entry/:id/receipt` | owner of the entry | Entry code, time submitted (IST), file list |

### Admin (`/admin/...`, server-side role checks)
- `/admin/competitions`: list with live status badge, key IST dates, counts; edit, duplicate, entries, preview, archive.
- `/admin/competitions/:id/:tab`: Basics · Eligibility & Groups · Schedule · Registration · Submission · Resources · Prizes · Publishing & SEO · Upsell · Emails. Actions: Save draft / Preview as parent / Preview as student / Publish / Archive.
- `/admin/competitions/:id/entries`: filters, search, detail drawer with signed previews, flag, note, disqualify, hide, CSV export, counters.
- `/admin/competition-accounts`: pending approvals with age, "Purge expired requests", account-type change with a reason.

### API (Hono)
- **Accounts**
  - `GET /api/me`: account type, onboarding status, flags for tracking
  - `POST /api/onboarding/parent`, `POST /api/onboarding/student`
  - `GET/POST/PUT/DELETE /api/students[/:id]`, `POST /api/students/:id/consents`, `POST /api/students/:id/invite`
  - `GET /api/approvals/:token`, `POST /api/approvals/:token/decide`, `POST /api/approvals/resend`, `PUT /api/approvals/parent-details`
  - `GET /api/invites/:token`, `POST /api/invites/:token/claim`
- **Competitions** (public responses carry no personal data)
  - `GET /api/competitions`, `GET /api/competitions/:slug`, `GET /api/competitions/:slug/eligibility` (signed in)
  - `POST /api/competitions/:slug/registrations` (window, cap, eligibility, approval and once-only checks in one transaction)
  - `GET /api/my/competitions`, `GET /api/registrations/:id`
  - `GET /api/competitions/:slug/resources/:id` (checks registration, logs the download, redirects to a 5-minute link)
- **Submissions**
  - `POST /api/registrations/:id/submission`, `PUT /api/submissions/:id`
  - `POST /api/submissions/:id/upload-url`, `POST /api/submissions/:id/files/:fileId/verify`, `DELETE …/files/:fileId`, `GET …/files/:fileId` (5-minute link)
  - `POST /api/submissions/:id/submit`, `POST /api/submissions/:id/withdraw`, `GET /api/submissions/:id/receipt`
- **Admin** (`/api/admin/competitions/...`)
  - Competitions: CRUD, duplicate, publish, archive, preview data, media uploads
  - Email templates: list, save (unknown merge tags rejected), preview, test send, reset
  - Entries: list, filters, detail, flag, note, disqualify, hide, CSV export (option to drop contact details), counters
  - Accounts: pending approvals, purge, account-type change
- **Scheduled jobs:** a daily `/api/cron/competitions` expires approval requests older than 14 days and deletes their pending data. The existing 5-minute cron also retries failed competition emails, up to 3 attempts.
- **Link previews:** a `vercel.json` rewrite sends `/competitions/:slug` to the API, which returns `index.html` with the OG and SEO tags filled in.

### Where tracking is gated for students
1. **`index.html` inline script** (GTM and GA). If a Supabase Google session is stored in this browser, it waits for the account type and loads nothing for a student. The CSP hash in `vercel.json` is updated to match.
2. **`src/meta.ts`**: `load()` refuses to run while the signed-in account is a student.
3. **`src/ga.ts` / `track()`**: no events are sent.
4. **Server:** `/api/meta/event` and every server-side Meta report skip student accounts.

A student signing out clears the block, so a parent on the same shared phone is tracked normally after their own consent.

### Deleting a student profile (parent action)
1. All of the child's uploaded files and thumbnails are deleted from storage straight away.
2. The profile's name, school and city are wiped, `deleted_at` is set, the guardian link is removed and any login is unlinked.
3. Registrations are set to *withdrawn*. Submissions are set to *withdrawn* with their text, title and link cleared; entry codes and dates stay, so counts and audit history still add up.
4. Consent records stay as proof of consent; they hold only ids, the parent's IP and versions.
5. An audit entry is written.

A student can only *request* deletion. The request emails the parent and asks them to confirm.

---

## 6. Build order and milestones

Commits go to `feature/competitions` after each step. Tests are added in the same commit. Nothing is deployed and no competition is created in production.

| # | Step | Target |
|---|---|---|
| 1 | Schema + migration 0009 + buckets SQL + health probe | 6 Nov |
| 2 | `getCompetitionStatus(competition, now)` + IST boundary tests | 6 Nov |
| 3 | Roles (`competition_manager`, …) and the admin guard | 6 Nov |
| 4 | Onboarding: profile completion, parent path, student path | 7 Nov |
| 5 | Parent approval (email link, WhatsApp share, QR), login invites, the shared `can(user, action, student)` helper | 7–8 Nov |
| 6 | Tracking gate for student sessions + newsletter/marketing changes | 8 Nov |
| 7 | Admin list, create/edit tabs, duplicate, publish, archive, preview | 8–9 Nov |
| 8 | Public list and detail pages with OG tags, then the registration flow and confirmation page | 9–10 Nov |
| 9 | Uploads (direct, with progress and retry, signature check, EXIF strip, thumbnails) and the submission flow with receipt | 10–11 Nov |
| 10 | Emails: shared layout from the existing template, defaults, per-competition editor, merge tags, preview, test send, retries + log | 11 Nov |
| 11 | Entries manager, accounts screen, CSV export, counters | 12 Nov |
| 12 | Local sample competition (PGlite only), two unrelated test families, a geotagged photo, 360 px and Devanagari checks | 12 Nov |
| 13 | Acceptance checklist run + summary: files changed, SQL to run, env vars, how to test | 12–13 Nov |

**Timeline note.** That leaves about one day for your review, running the SQL, merging and creating the first competition before 14 Nov.
- If the first competition's **submissions open later than registration** (D8), steps 9–11 can land a few days after launch without blocking it.
- If it slips, the step to hold back is the **per-competition email editor**. Registration and submission emails would still go out using the default templates, and the editor would follow.

### New environment variables
**None expected.** Competition emails use the existing SMTP settings, and storage uses the existing Supabase keys. The only additions are the three new buckets, created by the SQL file.
