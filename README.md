# Elden Academic Press

Website for Elden Academic Press ([eldenap.in](https://eldenap.in)) — textbooks, reference books, study guides, practice papers, workbooks, e-books and journals for Indian classrooms, alongside the separate **elmaster** learning platform.

Built with React, TypeScript, Vite and React Router from the Claude Design prototype in [`design/`](design/).

## Getting started

```sh
npm install
npm run dev      # local dev server
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build
```

The site uses client-side routing, so the host must serve `index.html` for all paths (`vercel.json` does this on Vercel).

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

## Pages

| Route | Page |
|---|---|
| `/` | Home |
| `/catalogue` | Catalogue with search, sort and filters (type, level, subject, board, format). Filters live in the URL, e.g. `/catalogue?type=Textbook&level=P` |
| `/books/:id` | Book detail (formats, specs, contents, teacher resources, related titles) |
| `/study-hub` | Free downloads, filterable by kind and level (`?kind=Sample%20papers&level=S`) |
| `/about` | About Elden, publishing with Elden, journals |
| `/contact` | Contact form and distributors by state |

There's no checkout. Every title offers **Request a sample**, plus school/bulk, teacher-access and distributor enquiry forms (`src/components/EnquiryModal.tsx`).

## Project layout

- `src/config.ts` — site URL, contact email, head office, elmaster URL, intro and header/top-bar toggles
- `src/data.ts` — catalogue, Study Hub resources, distributors
- `src/catalogue.ts` — filtering, sorting and URL helpers
- `src/api.ts` — form submission hook (`submitForm`)
- `src/styles.css` — all styles; design tokens on `:root`
- `public/assets/` — logo marks

## Still placeholder

- **Content:** book titles, authors, prices, ISBNs and distributors are sample data in `src/data.ts`.
- **Covers:** typeset colour-block covers (`BookCover`) — swap in real cover images.
- **Forms:** `submitForm` in `src/api.ts` only logs in dev; connect it to email/CRM/API.
- **Downloads:** Study Hub buttons mark items as downloaded; link them to the real PDFs.
- **elmaster:** no URL yet (`elmasterUrl: ''`), so it's mentioned without links or buttons — set the address in `src/config.ts` to turn them on. The teal colour, text wordmark and home-page screenshot placeholder also need the real branding.
