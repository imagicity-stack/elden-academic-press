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

`npm run dev` needs no accounts or keys. It starts an embedded Postgres (PGlite, kept in `.data/`) filled with the sample catalogue and Study Hub PDFs, a **payment simulator** in place of Razorpay, and a developer sign-in for the admin at [`/admin`](http://localhost:5173/admin). Delete `.data/` to start fresh. None of these shortcuts exist on Vercel.

Connecting the real services (Supabase, Razorpay, Resend, Vercel) is a one-time checklist: **[docs/STORE-SETUP.md](docs/STORE-SETUP.md)**.

## Launch switch: `VITE_SITE_LIVE`

Until launch, every URL shows a single **coming-soon page** (`src/pages/ComingSoon.tsx`) describing what's on the way.

| `VITE_SITE_LIVE` | Result |
|---|---|
| `true` | Full website |
| unset / anything else | Coming-soon page |

On Vercel: **Project → Settings → Environment Variables**, add `VITE_SITE_LIVE` = `true` for Production, then **redeploy**. Vite bakes the value in at build time, so changing it only takes effect on the next deployment.

Locally: copy `.env.example` to `.env.local` and set `VITE_SITE_LIVE=true` to work on the full site.

## Opening animation

On a visitor's first page load of a browser session, a book opens, its pages riffle, three pages stop mid-turn and the shapes morph into the Elden mark; the screen then turns away like a page (`src/components/Intro.tsx`). It plays in both coming-soon and live modes, can be skipped by click, key press or the "Skip intro" button, and never plays for visitors who prefer reduced motion. Turn it off with `showIntro: false` in `src/config.ts`.

## Store

A self-hosted store and back office, run as one Vercel function (`api/index.ts`) next to the static site.

| Part | Service |
|---|---|
| Database, admin sign-in (password + authenticator app), file storage | Supabase (Postgres, Auth, Storage) |
| Payments (UPI, cards, net banking, wallets) | Razorpay |
| Order, shipping and staff emails | Resend |
| Hosting, scheduled jobs | Vercel Pro (`vercel.json`) |

**Shopping:** each title can be sold as a printed book, an e-book, or both, with an optional **bundle price** for "e-book + printed copy" (the "Also send me the printed copy" box). Guest checkout; flat-rate shipping that's free above a set amount; discount codes; prices include GST, with GST invoices numbered per financial year. Every order gets a private link for status, tracking, invoice and e-book downloads, and customers can find it again at `/track` with their email.

**Admin (`/admin`):** dashboard, orders (pack, ship with tracking, cancel, refund through Razorpay, invoice and packing slip), products and variants (prices, stock, covers, e-book files, CSV import/export, bulk actions), inventory with history, customers, discount codes, enquiries, Study Hub files, store settings, categories, staff roles (owner / manager / staff) and an activity log. The admin works even while the coming-soon page is on.

**Security:** card and UPI details never touch this server — Razorpay handles them; payments are confirmed by verified signatures and webhooks. All store tables are locked against Supabase's public API keys; the server alone talks to the database. Staff sign in with an authenticator app. E-book files are private and served through short-lived links with a download limit. Checkout and lookups are rate-limited, and every admin change is logged.

## Pages

| Route | Page |
|---|---|
| `/` | Home |
| `/catalogue` | Store with search, sort and filters (category, level, class, subject, board, format). Filters live in the URL, e.g. `/catalogue?type=textbooks&level=P` |
| `/books/:slug` | Book detail — choose printed / e-book / bundle, add to cart; specs, contents, related titles |
| `/checkout` | Contact, delivery address, discount code, Razorpay payment |
| `/order/:number` | Order status, tracking, invoice and e-book downloads (private link from the confirmation email) |
| `/track` | Find an order by number and email |
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
  - `styles.css` — all site styles; design tokens on `:root`
- `api/index.ts` — Vercel entry for the API
- `server/` — the API (Hono)
  - `app.ts` — routes, error handling; `env.ts`, `deps.ts` — configuration and services
  - `db/` — schema (Drizzle), SQL migrations, seed data
  - `routes/` — store, orders, webhooks, enquiries/cron, `admin/`
  - `services/` — orders and payments, catalogue, emails, invoices
  - `lib/` — pricing and GST, Razorpay, storage, email, CSV, validation
- `scripts/seed.ts` — `npm run db:seed` (categories) or `-- --demo` (sample catalogue)
- `tests/` — Vitest suites for pricing, checkout/payments and admin
- `docs/STORE-SETUP.md` — connecting Supabase, Razorpay, Resend and Vercel
- `public/assets/` — logo marks

## Still placeholder

- **Products:** the live store starts empty — add titles in the admin (or import a spreadsheet). The sample catalogue in `src/data.ts` is only for local development (`npm run db:seed -- --demo` loads it into a database).
- **GST:** default rates (printed books 0%, e-books 18%), HSN/SAC codes (4901 / 998431) and the bundle split should be confirmed with your accountant.
- **Covers:** typeset colour-block covers until real cover images are uploaded in the admin.
- **Distributors:** the list on `/contact` is still static in `src/data.ts`.
- **elmaster:** no URL yet (`elmasterUrl: ''`), so it's mentioned without links or buttons — set the address in `src/config.ts` to turn them on. The teal colour, text wordmark and home-page screenshot placeholder also need the real branding.
