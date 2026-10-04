# ElMaster · by Elden Academic Press

The ElMaster student app: courses, olympiad prep, timed mock tests, live classes and certificates. It's a mobile-first **Next.js 16** web app you can install on a phone (PWA), backed by **Supabase** (Postgres, phone-OTP auth, row-level security).

It's built from the Claude Design prototype `ElMaster Mobile App`. Colours, type, spacing and animations follow that file.

## Quick start (demo mode)

```bash
npm install
npm run dev        # http://localhost:3000
```

With no Supabase keys the app runs in **demo mode**. It uses the built-in placeholder catalog and the demo student "Aarav Mehta", and it keeps the cart, wishlist, progress, notes and registrations in the browser. The coupon `ELDEN20` works.

## Connect Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `supabase/migrations/0001_init.sql`, then `supabase/seed.sql`.
   (Or, with the Supabase CLI: `supabase link` then `supabase db push`, then run the seed file.)
3. Turn on **Authentication → Providers → Phone** and connect an SMS provider (Twilio, MessageBird, Vonage or Textlocal). For local testing you can add test phone numbers with a fixed OTP.
4. Copy `.env.example` to `.env.local` and fill in:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ```
5. `npm run dev`. Sign-up now sends a real OTP, and everything a student does is saved to their account.

If you change the placeholder catalog in `lib/seed.ts`, regenerate the SQL with `npm run db:seed`.

### What the database does

| Area | Tables |
|---|---|
| Catalog (public read) | `courses`, `lessons`, `exams`, `live_classes`, `quiz_questions` |
| Student (owner only, RLS) | `profiles`, `cart_items`, `wishlist`, `enrollments`, `registrations`, `class_reminders`, `notes`, `quiz_attempts` |
| Commerce | `orders`, `order_items`, `coupons` (not readable by clients) |

- `place_order(course_ids, coupon, pay_method)` prices the cart **on the server**, applies the coupon, writes the order and enrolments in one transaction, and clears the cart. Clients can't insert enrolments directly.
- `check_coupon(code)` returns the discount percent without exposing the coupons table.
- A trigger creates the `profiles` row when someone signs up, using the name, grade and goals from the sign-up form.

## Deploy

Push to GitHub and import the repo in Vercel, then add the two `NEXT_PUBLIC_SUPABASE_*` env vars. No other config is needed.

## Project layout

```
app/
  (tabs)/            Home, Explore, Olympiads, Learning, Profile (with the floating tab bar)
  welcome/ signup/   Onboarding and phone sign-up
  course/[id]/       Course detail with the buy bar
  cart/ checkout/ success/
  learn/[id]/        Lesson player, lesson list and timestamped notes
  quiz/              Timed daily mock with results
  live/ certificates/ wishlist/ notifications/
components/          UI kit (book covers, chips, segmented controls, toggles, bars), tab bar, toast
lib/
  store.tsx          Student state and actions. Uses localStorage in demo mode and Supabase when signed in
  catalog.ts         Server-side catalog loader (Supabase, falling back to the demo catalog)
  seed.ts            Placeholder content from the design
supabase/            Schema migration and generated seed
proxy.ts             Keeps the Supabase session cookie fresh (Next 16's replacement for middleware)
```

## Before launch: still placeholder

These parts work in the UI but aren't backed by real systems yet:

- **Payments.** `place_order()` marks orders `paid` straight away. Wire in Razorpay (create the order server-side, verify the webhook signature, then enrol) **before taking real money**.
- **Lesson video.** The player simulates playback using each lesson's duration. Add `lessons.video_url` playback (Mux or Cloudflare Stream).
- **Leaderboard, medals, past papers, mock list, notifications feed, weekly study stats, profile stats.** These are static content from the design in `lib/seed.ts` and the screens.
- **Certificates.** The issue date and ID are placeholders, and "Download PDF" only shows a toast.
- **Live classes.** "Join now" only shows a toast. Hook it up to your streaming provider.
- **Parent access, orders & invoices, settings.** These are menu entries only.
