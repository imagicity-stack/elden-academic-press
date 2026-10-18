# Elden Academic Press

Website for Elden Academic Press — textbooks, reference books, study guides, practice papers, workbooks, e-books and journals for Indian classrooms, with link-outs to the separate **elmaster** learning platform.

Built with React, TypeScript, Vite and React Router from the Claude Design prototype in [`design/`](design/).

## Getting started

```sh
npm install
npm run dev      # local dev server
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build
```

The site uses client-side routing, so the host must serve `index.html` for all paths (SPA fallback).

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

- `src/config.ts` — elmaster URL, announcement bar and header elmaster link toggles
- `src/data.ts` — catalogue, Study Hub resources, distributors
- `src/catalogue.ts` — filtering, sorting and URL helpers
- `src/api.ts` — form submission hook (`submitForm`)
- `src/styles.css` — all styles; design tokens on `:root`
- `public/assets/` — logo marks

## Still placeholder

- **Content:** book titles, authors, prices, ISBNs, distributors, email and office address are sample data in `src/data.ts` / `src/pages/Contact.tsx`.
- **Covers:** typeset colour-block covers (`BookCover`) — swap in real cover images.
- **Forms:** `submitForm` in `src/api.ts` only logs in dev; connect it to email/CRM/API.
- **Downloads:** Study Hub buttons mark items as downloaded; link them to the real PDFs.
- **elmaster:** URL (`https://elmaster.in`), teal colour, text wordmark and the screenshot placeholder on the home page.
