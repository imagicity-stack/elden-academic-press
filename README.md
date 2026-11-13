# Elden Academic Press

Website for Elden Academic Press ([eldenap.in](https://eldenap.in)) — textbooks, reference books, study guides, practice papers, workbooks, e-books and journals for Indian classrooms, alongside the separate **elmaster** learning platform.

Built with React, TypeScript, Vite and React Router from the Claude Design prototype in [`design/`](design/).

## Getting started

```sh
npm install
npm run dev        # site + store API + admin on one dev server
npm test           # store/back-office tests (embedded Postgres, no services needed)
npm run typecheck  # front end, server and tests
npm run build      # type-check + production build to dist/
```

Before a release, also run the tests on a real Postgres server, through the same driver as the
live site (the embedded one accepts some things postgres.js doesn't). Any server you can create
databases on will do; each test gets its own copy:

```sh
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
```

`npm run dev` needs no accounts or keys. It starts an embedded Postgres (PGlite, kept in `.data/`) filled with the sample catalogue and Study Hub PDFs, a **payment simulator** in place of Razorpay, and a developer sign-in for the admin at [`/admin`](http://localhost:5173/admin). Delete `.data/` to start fresh. None of these shortcuts exist on Vercel.

Connecting the real services (Supabase, Razorpay, Google Workspace email, Vercel) is a one-time checklist: **[docs/STORE-SETUP.md](docs/STORE-SETUP.md)**.

## Launch switch: `VITE_SITE_LIVE`

Until launch, every URL shows a single **coming-soon page** (`src/pages/ComingSoon.tsx`) describing what's on the way.

| `VITE_SITE_LIVE` | Result |
|---|---|
| `true` | Full website |
| unset / anything else | Coming-soon page |

On Vercel: **Project → Settings → Environment Variables**, add `VITE_SITE_LIVE` = `true` for Production, then **redeploy**. Vite bakes the value in at build time, so changing it only takes effect on the next deployment.

Locally: copy `.env.example` to `.env.local` and set `VITE_SITE_LIVE=true` to work on the full site.

## Analytics

Google Analytics 4 (`G-0TR5TFH9KP`, loaded directly with gtag.js) loads from an inline script at the top of `index.html`, on every page except `/admin` and local development, once the page has loaded (or after 2.5 seconds). Google Tag Manager was removed in November 2026: its only tag loaded this same GA4 property. If you bring it back for other tags, don't add a GA4 tag for this property inside it, or visits are counted twice, and load it late like gtag so it doesn't hold up the page or the Meta Pixel. GA4's enhanced measurement counts page changes in this single-page site. There is no cookie banner or cookie choice (owner's decision, November 2026; see `src/consent.ts`): Google Analytics and the Meta Pixel run for every visitor except staff, and nothing reaches Meta about a signed-in student under Meta's minimum age. The Meta Pixel starts from the page's first, small script (`src/early.ts`), and Meta's Parameter Builder adds the ad click id and the visitor's IPv6 address (looked up at api64.ipify.org) to the server's Conversions API events. The script first moves a private order link's token out of the address bar (into the tab's storage) so it never reaches analytics. If you change that script, update its SHA-256 hash in `vercel.json`'s CSP (a test checks this). If you add advertising or remarketing tags, update the privacy policy (`src/pages/Legal.tsx`).

## Opening animation

On a visitor's first page load of a browser session, a book opens, its pages riffle, three pages stop mid-turn and the shapes morph into the Elden mark; the screen then turns away like a page (`src/components/Intro.tsx`). It plays in both coming-soon and live modes, can be skipped by click, key press or the "Skip intro" button, and never plays for visitors who prefer reduced motion. Turn it off with `showIntro: false` in `src/config.ts`.

## Store

A self-hosted store and back office, run as one Vercel function (`api/index.ts`) next to the static site.

| Part | Service |
|---|---|
| Database, admin sign-in (password + authenticator app), file storage | Supabase (Postgres, Auth, Storage) |
| Payments (UPI, cards, net banking, wallets) | Razorpay |
| Order, shipping and staff emails (PDF invoice attached) | Google Workspace via SMTP (or Resend) |
| Hosting, scheduled jobs | Vercel Pro (`vercel.json`) |

**Shopping:** each title can be sold as a printed book, an e-book, or both, with an optional **bundle price** for "e-book + printed copy" (the "Also send me the printed copy" box). Guest checkout; flat-rate shipping that's free above a set amount; discount codes; prices include GST, with GST invoices numbered per financial year. Every order gets a private link for status, tracking, invoice and e-book downloads, and customers can find it again at `/track` with their email.

**Shipping (Delhivery):** printed books ship with Delhivery: delivery dates and PIN code checks on book pages and at checkout, one-click or automatic booking, merged 4 × 6 / A4 labels, pickup requests, live tracking (webhook plus a 30-minute sync) on the customer's order page, failed-delivery actions and returns, all in Admin → Shipping. Setup: [docs/DELHIVERY.md](docs/DELHIVERY.md).

**Admin (`/admin`):** dashboard, orders (pack, ship with tracking, cancel, refund through Razorpay, invoice and packing slip), products and variants (prices, stock, covers, e-book files, CSV import/export, bulk actions), inventory with history, customers, discount codes, enquiries, Study Hub files, store settings, categories, staff roles (owner / manager / staff) and an activity log. The admin works even while the coming-soon page is on.

**Security:** card and UPI details never touch this server — Razorpay handles them; payments are confirmed by verified signatures and webhooks. All store tables are locked against Supabase's public API keys; the server alone talks to the database. Staff sign in with an authenticator app. E-book files are private and served through short-lived links with a download limit. Checkout and lookups are rate-limited, and every admin change is logged.

## Claude connector (MCP)

The store is also a remote MCP server at **`https://eldenap.in/api/mcp`**, so Claude can work in the whole back office.

- **Reads everything:** sales and sales by source/UTM campaign (to compare with the Meta Ads connector), orders with refunds and cancellations, products, stock, customers, coupons, enquiries, WhatsApp (inbox, conversations, send log, templates, opt-outs), voice-agent calls (stats, transcripts, abandoned-checkout leads, do-not-call), newsletter (subscribers, accounts, campaigns), audience, popups, cookie consent, Study Hub, competitions (registrations, teams, notices, dates), store settings, staff and the activity log.
- **Acts on:** products (create, edit, publish, stock), categories, coupons, order fulfilment and notes, enquiries, WhatsApp replies and new-book sends, newsletter campaigns (draft, test, schedule, send, stop), voice-agent calls (call now, skip, resolve, fetch result, do-not-call), popup status, Study Hub publishing, customer notes.
- **Never tools:** refunds, cancellations, competition decisions (review, results, notices), settings, staff, deleting. Their data is readable.
- **Privacy:** children's dates of birth, guardians' and students' contact details, and competition ID documents are left out of what Claude sees.
- **Connect:** in Claude, Settings → Connectors → Add custom connector → paste the address above → Connect. Claude registers itself and opens `/admin/connect`, where a signed-in team member (with two-step verification) chooses **Allow**. The steps are also under Admin → Settings → Claude, with the list of connections and a Disconnect button.
- **Sign-in:** OAuth 2.1 with PKCE and dynamic client registration (`server/routes/mcp/oauth.ts`, `server/services/mcpAuth.ts`). Codes only go back to Claude's own callback (claude.ai / claude.com) or localhost. Access tokens last an hour, refresh tokens 30 days and change on each use; only their hashes are stored.
- **Permissions:** a connection acts as the person who approved it, with their current role, and stops when they lose admin access. Tools (`server/routes/mcp/tools.ts`, `backend.ts`) call the admin's own endpoints, so the same validation and role checks apply, and changes show in the activity log as "you (via Claude)".
- **Database:** needs `docs/supabase-updates/0024_mcp_connector.sql` (the setup check at `/api/health` says so until it's run).

## Pages

| Route | Page |
|---|---|
| `/` | Home |
| `/catalogue` | Store with search, sort and filters (category, level, class, subject, board, format). Filters live in the URL, e.g. `/catalogue?type=textbooks&level=P` |
| `/books/:slug` | Book detail — choose printed / e-book / bundle, add to cart; specs, contents, related titles |
| `/checkout` | Contact, delivery address, discount code, Razorpay payment |
| `/order/:number` | Order status, tracking, invoice and e-book downloads (private link from the confirmation email) |
| `/track` | Find an order by number and email |
| `/account` | Customer account (Google sign-in): e-book & journal library to read or download, order history |
| `/study-hub` | Free downloads, filterable by kind and level (`?kind=Sample%20papers&level=S`) |
| `/about` | About Elden, publishing with Elden, journals |
| `/contact` | Contact form and distributors by state |
| `/admin` | Back office |

Sample, school/bulk, teacher-access and distributor enquiry forms (`src/components/EnquiryModal.tsx`) are stored in the admin's **Enquiries** and emailed to the store's alert addresses.

## Project layout

- `src/` — website
  - `config.ts` — site URL, contact email, head office, elmaster URL, intro and header/top-bar toggles
  - `store/` — catalogue, cart and quote hooks talking to `/api`
  - `catalogue.ts` — filtering, sorting and URL helpers
  - `admin/` — the back office (loaded only at `/admin`)
  - `data.ts` — cover palettes, level names, distributors, and the sample catalogue used for local/demo data
  - `interior.css` — the website’s design (fonts in `fonts.ts`, animation helpers in `components/motion.tsx`); `styles.css` holds the base shared with the coming-soon page
- `api/index.ts` — Vercel entry for the API
- `server/` — the API (Hono); `routes/mcp/` is the Claude connector
  - `app.ts` — routes, error handling; `env.ts`, `deps.ts` — configuration and services
  - `db/` — schema (Drizzle), SQL migrations, seed data
  - `routes/` — store, orders, webhooks, enquiries/cron, `admin/`
  - `services/` — orders and payments, catalogue, emails, invoices
  - `lib/` — pricing and GST, Razorpay, storage, email, CSV, validation
- `server/routes/llms.ts` — `/llms.txt`, a Markdown guide to the store for AI assistants (books, prices, formats, delivery, policies), built from the live catalogue like `/sitemap.xml`; `public/robots.txt` points to both
- `scripts/seed.ts` — `npm run db:seed` (categories) or `-- --demo` (sample catalogue)
- `tests/` — Vitest suites for pricing, checkout/payments and admin
- `docs/STORE-SETUP.md` — connecting Supabase, Razorpay, Google Workspace email and Vercel
- `docs/supabase-setup.sql` — the database setup to paste into Supabase's SQL Editor (generated from the migrations: `npm run db:setup-sql`)
- `public/assets/` — logo marks

## Still placeholder

- **Products:** the live store starts empty — add titles in the admin (or import a spreadsheet). The sample catalogue in `src/data.ts` is only for local development (`npm run db:seed -- --demo` loads it into a database).
- **GST:** default rates (printed books 0%, e-books 18%), HSN/SAC codes (4901 / 998431) and the bundle split should be confirmed with your accountant.
- **Covers:** typeset colour-block covers until real cover images are uploaded in the admin.
- **Distributors:** the list on `/contact` is still static in `src/data.ts`.
- **elmaster:** no URL yet (`elmasterUrl: ''`), so it's mentioned without links or buttons — set the address in `src/config.ts` to turn them on. The teal colour, text wordmark and home-page screenshot placeholder also need the real branding.
