# Store setup — from code to live payments

This is the one-time checklist to connect the store to real services. Do it in
**test mode** first; nothing here charges real money until step 7.

You will create four accounts: **Supabase** (database, admin sign-in, files),
**Razorpay** (payments), **Google Workspace** (emails) and **Vercel Pro** (hosting).
Keys go into Vercel's settings — never into code, chat or email.

---

## 1. Supabase

Everything here is done in the browser at [supabase.com/dashboard](https://supabase.com/dashboard) — no software to install.

**a. Check the region.** Click **Connect** (top of the project). In the connection strings, the address should contain `ap-south-1` (Mumbai). If it shows somewhere far away (e.g. `us-east-1`), delete the project and create a new one in **Mumbai** now, while it's empty — the region can't be changed later. If you keep a project elsewhere, set `"regions"` in `vercel.json` to the Vercel region nearest it (see *Speed* under Good to know), otherwise every page is slower.

**b. Create the tables.** Left sidebar → **SQL Editor** → **New query**. Paste the whole of [`docs/supabase-setup.sql`](supabase-setup.sql) and click **Run**. If Supabase shows a warning, choose to run it anyway (the script switches on row-level security itself). You should see *Success. No rows returned*. This creates the store's tables, locks them against Supabase's public keys, creates the `covers`, `resources` and `ebooks` storage buckets, and adds six starting categories. Run it only once.

**Updating later.** When a new version of the store needs database changes, they come as a file in [`docs/supabase-updates/`](supabase-updates/). Run each new file once, the same way, **before** the new version goes live (the changes only add things, so the running site keeps working). `/api/health` names any update that's still missing. A database created from `supabase-setup.sql` already includes every update up to that point.

**c. Sign-in settings** (left sidebar → **Authentication**):
1. **Sign In / Providers** → turn **off** *Allow new users to sign up* → Save. Staff are added only by invitation from the admin.
2. **URL Configuration** → *Site URL* `https://eldenap.in` → Save; under *Redirect URLs* → **Add URL** → `https://eldenap.in/admin`.
3. **Multi-Factor** → check *TOTP (App Authenticator)* is enabled (it is by default).
4. **Users** → **Add user** → **Create new user** → your email (e.g. `hello@eldenap.in`) and a strong password, tick **Auto Confirm User** → Create. This is the owner login for `/admin`.

**d. Copy the values for Vercel** (keep them private — paste them only into Vercel):

| Vercel variable | Where in Supabase |
|---|---|
| `SUPABASE_URL` and `VITE_SUPABASE_URL` | `https://<Project ID>.supabase.co` — the Project ID is in **Project Settings → General** |
| `VITE_SUPABASE_ANON_KEY` | **Project Settings → API Keys** → *Publishable key* (`sb_publishable_…`), or on the *Legacy API Keys* tab the `anon` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → *Secret key* (`sb_secret_…`, click Reveal), or the legacy `service_role` key. **Never share this one.** |
| `DATABASE_URL` | **Connect** → *Connection String* → **Transaction pooler** (port **6543**). Replace `[YOUR-PASSWORD]` with your database password (no brackets). |
| `SUPABASE_JWT_SECRET` | **Project Settings → JWT Keys** → *Legacy JWT Secret* tab → Reveal. Needed while the project still signs with the legacy secret; harmless otherwise. |

Forgot the database password, or it contains symbols like `@ # / ? %`? **Project Settings → Database → Reset database password** and use one made of letters and numbers only (symbols break the connection string).

> Supabase's **Security Advisor** will list *“RLS enabled, no policy”* for the store tables. That's intended: nothing but the store's server may read them.

<details><summary>Developers: the same from a terminal</summary>

```sh
npm install
DATABASE_URL="<session pooler string, port 5432>" npm run db:migrate
DATABASE_URL="<session pooler string, port 5432>" npm run db:seed
```
Use either this or the SQL file, not both. After changing the schema: `npm run db:generate && npm run db:setup-sql`.
</details>

**e. Emails from Supabase (later, before inviting staff).** **Authentication → Emails → SMTP Settings**: enter Google Workspace SMTP (host `smtp.gmail.com`, port `465`, the same user and app password as step 3) so staff invitations and password resets come from your domain. Supabase's built-in sender only delivers to your own Supabase team members.

## 2. Razorpay

1. Sign up at [razorpay.com](https://razorpay.com) and complete KYC (needed later for live payments).
2. Switch the dashboard to **Test mode** → **Account & Settings → API Keys → Generate key**. Copy the Key ID (`rzp_test_…`) and Key Secret.
3. **Account & Settings → Webhooks → Add new webhook** (still in Test mode):
   - URL: `https://eldenap.in/api/webhooks/razorpay`
   - Secret: a long random string (keep it — it's `RAZORPAY_WEBHOOK_SECRET`)
   - Events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`
4. Payment capture can stay automatic; the store also captures authorised payments itself.

## 3. Email (Google Workspace)

Customer emails (order confirmation with the PDF invoice attached and download buttons for e-books; shipping; refunds) are sent from **noreply@eldenap.in**. Every one of them is also copied, hidden (BCC), to your own inboxes in `MAIL_TO`, which also receive the contact forms and enquiries. When a customer presses Reply, it goes to the support email in **Admin → Settings → Store** (e.g. hello@eldenap.in), not to noreply.

1. **Create the sender.** Either
   - make `noreply@eldenap.in` its **own user** in [admin.google.com](https://admin.google.com) → Directory → Users (uses a licence), and sign in as it for the next steps; or
   - add `noreply@eldenap.in` as an **alternate email (alias)** of an existing user such as hello@ (Users → hello → User information → Alternate emails, free). Then, signed in as hello@, open Gmail → ⚙ Settings → **Accounts → Send mail as → Add another email address** → `noreply@eldenap.in`, untick “Treat as an alias”, and confirm.
2. Signed in as the sending account → [myaccount.google.com](https://myaccount.google.com) → **Security** → turn on **2-Step Verification**, then search **App passwords** → name it “Elden website” → **Create** and copy the 16-letter password. (If the option is missing, a Workspace admin must allow it in admin.google.com → Security.)
3. In Vercel set:
   - `MAIL_FROM` = `Elden Academic Press <noreply@eldenap.in>`
   - `SMTP_USER` = the account that signs in (noreply@eldenap.in, or hello@eldenap.in if noreply is its alias)
   - `SMTP_PASS` = the app password
   - `MAIL_TO` = `hello@eldenap.in` (add more, comma-separated: `hello@eldenap.in, orders@eldenap.in`)
4. So emails don't land in spam, turn on DKIM: **admin.google.com → Apps → Google Workspace → Gmail → Authenticate email** → generate the key, add the TXT record at your domain registrar, then **Start authentication**. SPF: a TXT record `v=spf1 include:_spf.google.com ~all`.

Tip: copies are easiest to read when the `MAIL_TO` inbox is not the sending account itself (Gmail files mail you send to yourself under Sent). New-order alerts with an “Open in admin” button go to **Admin → Settings → Order alerts** if you fill that in.

Google Workspace sends up to 2,000 emails a day per account. (Instead of SMTP you can use [Resend](https://resend.com) with `RESEND_API_KEY`; it's used only when `SMTP_USER`/`SMTP_PASS` are empty.)

## 3b. Customer sign-in with Google

Customers can sign in at **eldenap.in/account** with Google to read their e-books and journals online, download them again and see their orders. Orders are matched by email, so past guest orders appear automatically when they use the same address.

**In Google Cloud** ([console.cloud.google.com](https://console.cloud.google.com), signed in with your Workspace admin account):
1. Create a project, e.g. “Elden website”.
2. **APIs & Services → OAuth consent screen** (also called *Google Auth Platform*):
   - App name `Elden Academic Press`, user support email `hello@eldenap.in`, authorised domain `eldenap.in`, developer contact email.
   - Audience: **External**, then **Publish app** (status *In production*) so any Google user can sign in. The basic scopes used (email, profile) need no review by Google.
3. **Credentials / Clients → Create OAuth client → Web application**, name “Elden website”:
   - Authorised JavaScript origins: `https://eldenap.in` and `https://www.eldenap.in`
   - Authorised redirect URI: `https://<your-project-id>.supabase.co/auth/v1/callback` (for this project `https://zrnmeisgzobjfygkouue.supabase.co/auth/v1/callback`)
   - **Create**, then copy the **Client ID** and **Client secret**.

**In Supabase:**
4. **Authentication → Sign In / Providers → Google** → turn on, paste the Client ID and Client secret → **Save**.
5. Same page → turn **on** *Allow new users to sign up* (a first-time Google user needs an account). This is safe: the admin only lets in people listed under **Admin → Settings → Staff**, with two-step verification. Keep *Confirm email* on.
6. **Authentication → URL Configuration**: set **Site URL** to `https://eldenap.in` (Supabase's default is a localhost address; left as it is, sign-in ends on “localhost refused to connect”), and under **Redirect URLs** add `https://eldenap.in/account` and `https://www.eldenap.in/account`.

**In Vercel:**
7. Add `VITE_GOOGLE_CLIENT_ID` = the Client ID from step 3 (it's public, not a secret) and redeploy. The account page then shows Google's own *Sign in with Google* button: the sign-in happens on eldenap.in, so Google names **eldenap.in** rather than the Supabase address. Without this variable the page falls back to a redirect through Supabase, which Google labels with `…supabase.co`.
8. Open `https://eldenap.in/account` → **Continue with Google**.

**Optional: your name and logo on Google's screen.** Google shows the app name and logo once it has verified your branding: Google Cloud → **Google Auth Platform → Branding** → app name, logo (120 × 120 px), home page `https://eldenap.in`, privacy policy `https://eldenap.in/privacy`, terms `https://eldenap.in/terms` → **Submit for verification**. Google asks you to prove you own `eldenap.in` through Google Search Console; it usually takes a few working days.

## 4. Vercel

1. The project must be on **Vercel Pro** (the free plan doesn't allow commercial sites).
2. **Settings → Environment Variables** (Production) — every variable in [`.env.example`](../.env.example):

   | Variable | Value |
   |---|---|
   | `VITE_SITE_LIVE` | `false` for now (coming-soon page; the admin still works) |
   | `SITE_URL` | `https://eldenap.in` |
   | `VITE_SUPABASE_URL`, `SUPABASE_URL` | Supabase Project URL |
   | `VITE_SUPABASE_ANON_KEY` | Supabase anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role / secret key |
   | `DATABASE_URL` | Transaction pooler string (port 6543) |
   | `SUPABASE_JWT_SECRET` | Legacy JWT secret (step 1d) |
   | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay test keys |
   | `RAZORPAY_WEBHOOK_SECRET` | the webhook secret from step 2 |
   | `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_TO` | from step 3 |
   | `ADMIN_OWNER_EMAIL` | the email of the user you created in step 1c |
   | `ORDER_LINK_SECRET`, `CRON_SECRET` | two different long random strings (e.g. `openssl rand -base64 48`) |

3. **Redeploy** (Deployments → ⋯ on the latest → Redeploy). Then open `https://eldenap.in/api/health`: `"ok": true` means the database and storage are connected, and the `todo` list names anything still missing or wrong (it never shows the values).

## 5. First sign-in and store setup

1. Go to `https://eldenap.in/admin` and sign in. Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy) and enter the code. You're now the owner.
2. **Settings → Store**: GSTIN (if registered), legal name, address, support email/phone, shipping charge and free-shipping threshold, who gets order alerts.
3. **Settings → Categories**: adjust the categories.
4. **Products**: add products one by one, or **Import** a spreadsheet (export first to get the column layout). For each e-book, upload the PDF/EPUB in the product; a book in parts can have several files (**Add another file**), each with a label such as "Part 1" or "Answer key", in the order buyers see them. To give the e-book free with the printed copy, tick **Include the e-book (PDF) free with every printed copy** under the printed book; the e-book can still be sold on its own as well (**Sell the e-book separately**), or not. The choice is kept with each order, so changing it later doesn't affect people who already bought. Upload covers (or pick typeset colours).
5. **Study Hub**: upload the free PDFs.
6. **Settings → Staff**: invite team members as *Staff* (orders, packing, enquiries) or *Manager* (also products, prices, discounts, refunds).

## 6. Test purchase (test mode)

1. Set `VITE_SITE_LIVE=true` temporarily on a **Preview** deployment, or test on production before announcing.
2. Buy a printed book and an e-book, and one printed book with cash on delivery (only the advance is charged). In Razorpay's test window use UPI ID `success@razorpay` (or a [test card](https://razorpay.com/docs/payments/payments/test-card-details/)).
3. Check: the order page and e-book download work; both confirmation emails arrive; the order appears in the admin; mark it shipped (customer gets the tracking email); refund it (Razorpay test dashboard shows the refund).
4. The Content Security Policy is enforced: if the payment window doesn't open, search **Vercel → Logs** for `[csp]` to see what was blocked (see section 12).

## 7. Go live

1. Razorpay: switch to **Live mode**, generate live API keys and add the **same webhook** again in Live mode (webhooks are separate per mode).
2. Vercel: replace `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` with the live values; set `VITE_SITE_LIVE=true`; redeploy.
3. Place one small real order and refund it.

## 8. Newsletter

Email your subscribers about new books and offers from **Admin → Newsletter**, sent through the same Google Workspace account as order emails. No outside service.

**One-time:** if your database was set up before this feature arrived, run [`docs/supabase-updates/0003_newsletter.sql`](supabase-updates/0003_newsletter.sql) in the SQL Editor (see *Updating later* in step 1).

**How people join** (everyone is told they are joining and can leave in one click; Indian law and Gmail both expect that):
- the form in the website footer and on `/newsletter` (name, email, mobile, and a "Yes, email me…" box, ticked by default). No confirmation email: a welcome email with an unsubscribe link follows;
- the *Email me about new books and offers* box at checkout, ticked by default; buyers can untick it (subscribed once the order is paid);
- creating an account (first sign-in with Google): the sign-in page says new accounts get the newsletter, and a welcome email follows with an unsubscribe link. Anyone who unsubscribed before is never re-added;
- the newsletter switch on the customer's account page, where they can also add their mobile number;
- staff can add someone who asked in person (tick the consent box), or import a CSV of people who opted in elsewhere.

**Sending a campaign:** **New campaign** (or **Announce by email** on a published product) → write the subject, heading and message, add books (each shows its cover, price and a buy link) and an optional button → watch the live preview → **Send a test** to yourself → **Schedule** or **Send now**.

**Limits:** Google Workspace allows about 2,000 emails a day per account, order emails included. The newsletter stops at **1,500 a day** by default (Settings → Store → Newsletter), and a bigger list simply continues the next day. Emails go out in small batches every 5 minutes (faster while the campaign page is open in the admin).

**Unsubscribing:** every email has an unsubscribe link, and Gmail and Apple Mail show their own *Unsubscribe* button. Unsubscribed people are never re-added by staff or by an import; only they can subscribe again.

**Avoid the spam folder:** besides SPF and DKIM (step 3), add a DMARC record at your domain registrar: TXT, name `_dmarc`, value `v=DMARC1; p=none; rua=mailto:hello@eldenap.in`. Gmail and Yahoo require all three for bulk senders. Never import bought lists or customers who didn't opt in: spam complaints get *all* mail from eldenap.in blocked, receipts included.

**Your lists:** Admin → Newsletter → **Subscribers** (with mobile numbers; export as CSV) and **Signed-up accounts** (everyone who signed in with Google, with the mobile number they added).

**Who gets a campaign:** only people marked *Subscribed*. The send dialog says who is left out:
- *Not confirmed*: people who used the sign-up form when it still asked them to confirm by email. **Add them to the list** on the Newsletter page subscribes them all.
- Accounts that aren't subscribed: Google sign-ins from before new accounts joined automatically. They can turn it on in their account, or add them under Subscribers if they agreed.

## 9. Meta Pixel and Conversions API (Facebook and Instagram ads)

The site reports visits, add-to-carts, checkouts, enquiries, sign-ups and purchases to Meta, from the browser (Pixel) **and** from the server (Conversions API). Each event has one id on both sides, so Meta counts it once, and purchases still count when the buyer used an ad blocker or closed the tab. Only for visitors who press **Accept all** on the cookie banner; the admin and staff (anyone signed in to `/admin` in that browser) are never tracked.

1. **Events Manager** → your dataset (e.g. *EAP Website Data*) → copy the **ID** under its name.
2. Dataset → **Settings** → **Conversions API** → **Generate access token** → copy it (secret: only into Vercel).
3. **Business settings → Brand safety → Domains → Add** `eldenap.in` → verify with the DNS TXT record at your registrar.
4. Run [`docs/supabase-updates/0004_meta_tracking.sql`](supabase-updates/0004_meta_tracking.sql) in Supabase → SQL Editor (before the new version goes live).
5. Vercel → Environment Variables: `VITE_META_PIXEL_ID` = the ID, `META_CAPI_TOKEN` = the token, and while testing `META_TEST_EVENT_CODE` = the code from **Events Manager → Test events**. Redeploy.
6. **Test:** in Test events, enter `www.eldenap.in/?meta-test` as the website URL and click **Test events**. The page that opens shows a *Meta test mode* panel listing anything still missing (Pixel ID, cookie choice, ad blocker), and it tracks you even though you're signed in to the admin (staff are otherwise never tracked). Press *Accept all*, open a book, add it to the cart, and place a test order. Each event should appear from **Browser** and **Server**, marked *Deduplicated*, and Purchase should show the order value in ₹.
7. **Go live:** delete `META_TEST_EVENT_CODE`, redeploy. `/api/health` reminds you while it's still set.

**Students and Meta.** Nothing goes to Meta without *Accept all*. On top of that, a signed-in **Student** account is sent to Meta (all events, browser and server) only from the age in `META_MIN_AGE`, worked out from their date of birth (India time). The default is 13. A student under that age, or one who hasn't given a date of birth, sends nothing, whatever the cookie choice: no Pixel loads, and the cookie tells the server "essential". Teacher, Parent and Other accounts don't give a date of birth and aren't affected. To change the age (to 18, say), set `META_MIN_AGE` in Vercel → Environment Variables and redeploy; the privacy policy shows the same number. Google Analytics and Tag Manager stay off for every student, whatever the age.

Events: PageView, ViewContent (book page), Search (store search), CustomizeProduct (switching between e-book, print and both), AddToCart, InitiateCheckout (checkout opened), AddPaymentInfo (Pay pressed), Purchase (payment confirmed), Lead (sample, school-order and teacher forms), SubmitApplication (author proposals and distributor applications), Contact (contact form, or tapping your email, phone or WhatsApp link), CompleteRegistration (a competition registration: a DoomsDay Diaries team, or an individual or group entry; sent once when it's saved, with event id `reg_<registration id>`, never for edits, approval, rejection or withdrawal), AccountSignup (a custom event, sent once when a new account first saves its profile with who they are, i.e. the account type and, for a student, the date of birth; event id `signup-<user id>`), Subscribe (newsletter sign-up). Cart, checkout and purchase events carry a `format` (`ebook`, `print`, `ebook+print`) for audiences such as "added an e-book, didn't buy". Meta's automatic button-click events are switched off, so only these appear. With purchases, leads and sign-ups the server sends the customer's email, phone, name, city, state and PIN code, SHA-256 hashed as Meta requires, which raises Meta's match rate; with registrations, the account's email, WhatsApp number and name, hashed the same way. Nothing is sent without *Accept all*, and nothing ever for Student accounts.

## 10. Google: Analytics, Ads, Merchant Center and Search

The website already sends everything Google needs; these are the settings on Google's side.

**What the site sends to Google Analytics (GA4, `G-0TR5TFH9KP`):** `view_item`, `search`, `add_to_cart`, `begin_checkout`, `add_payment_info`, `purchase` (order number, revenue, tax, shipping, books and formats), `generate_lead` (enquiry forms), `sign_up` (first Google sign-in), `newsletter_signup` and `contact` (email/phone taps). Consent Mode applies: until a visitor accepts cookies, Google gets cookie-free signals only. Staff signed in to the admin send no shopping events, and their page views are marked as internal traffic.

**Google Analytics** ([analytics.google.com](https://analytics.google.com) → Admin):
1. **Data display → Events:** after the first sale, `purchase` is a key event automatically. Mark `generate_lead`, `sign_up` and `newsletter_signup` as key events too (star them).
2. **Data collection and modification → Data filters:** open *Internal traffic* and set it to **Active**, so your own visits are left out.
3. **Data collection and modification → Data collection:** turn on **User-provided data collection** (the site sends hashed customer details after checkout, for Google Ads' enhanced conversions).
4. **Product links:** link **Google Ads**, **Search Console** and **Merchant Center**.

**Google Ads** ([ads.google.com](https://ads.google.com)):
1. **Goals → Conversions → New conversion action → Import → Google Analytics 4 → Web** → tick `purchase` (and `generate_lead` if you advertise to schools). Use `purchase` as the primary goal; it brings the order value.
2. **Goals → Settings → Enhanced conversions:** turn on, choose *Google tag / Google Analytics*.
3. Shopping and Performance Max campaigns use the Merchant Center feed below.

**Google Merchant Center** ([merchants.google.com](https://merchants.google.com)): your books on Google Shopping, free listings and ads.
1. Business info: name, address, logo; verify and claim `eldenap.in` (it suggests Search Console, which you already use).
2. **Products → Add products → Add from a file → Enter a link to your file:** `https://eldenap.in/feeds/products.xml`, fetched **daily**. It lists printed books that have a cover image (books without an uploaded cover are left out, as Google requires an image), with price, stock, and the ISBN as GTIN.
3. **Shipping and returns:** add a shipping service for India matching the store (flat charge, free above your threshold, delivery time) and the return policy from `/refunds`.
4. Free listings start once products are approved (a few days). The same feed works for Meta: **Commerce Manager → Catalogue → Data sources → Data feed** with the same link.

**Search Console:** sitemap `sitemap.xml` (see above). Book pages carry structured data (price, availability, ISBN, author), so Google can show them as products; check **Shopping → Product snippets / Merchant listings** after a few weeks.

---

## 11. Competitions and profiles

**One-time:** run these in the SQL Editor, oldest first, skipping any you've already run: [`0009_competitions.sql`](supabase-updates/0009_competitions.sql), [`0010_newsletter_everyone_subscribed.sql`](supabase-updates/0010_newsletter_everyone_subscribed.sql), [`0011_simple_competitions.sql`](supabase-updates/0011_simple_competitions.sql), [`0012_doomsday_diaries.sql`](supabase-updates/0012_doomsday_diaries.sql). They only add things; `/api/health` lists any that are missing. (0009 also created tables for an earlier competitions system that has been removed; they stay unused so nothing saved is lost.)

**Bigger uploads (one-time):** comic PDFs can be up to 100 MB. 0012 lets the private `competition-entries` bucket take that, but Supabase also has a project-wide limit: **Storage → Settings → Upload file size limit**: set it to **110 MB** or more (the default is 50 MB).

**Profile.** After signing up, everyone sees *Complete your profile* (they can *Skip for now*, after a warning that competitions need it). It starts with *I am a* Student / Parent / Teacher / Other: students also give their date of birth, class or year, school, college or institution and, if under 18, a parent's or guardian's name and number; teachers give their institution. Shopping never needs it. Registering for a competition asks only for what's still missing.

**DoomsDay Diaries** (team competition, `/competitions/doomsday-diaries`):
- *Registration:* a signed-in captain, teacher or parent fills one form for the whole team (2 to 4 members, roles, an ID document each, a parent's or guardian's details and consent for anyone under 18). The site checks the age rules (8 to 24 on 6 Nov 2026, no mixing under-18s and adults, age group from the oldest member), the Writer and Artist roles, same school or college for school and college teams, and one team per person. The team gets an application ID (DD-0001) and an email; its status is *Pending verification*. You get a **New registration** email with the team's details and a button to review it (and a **Changes sent** email when a team sends its application back after *Request changes*), at the addresses in **Admin → Settings → Send new-order, enquiry and team registration alerts to** (empty: `MAIL_TO`, else the support email).
- *Review (Admin → Competitions → DoomsDay Diaries → Applications):* open a team, look at each ID (a link that works for 5 minutes; every view is logged), then **Approve**, **Request changes** (with a message; the team edits and resends) or **Reject**. Each sends the team an email.
- *What people see:* before signing in, a short page (banner, key facts, how it works, age groups, prizes). Once signed in, the rules and key dates and the full rules page too. The **story brief** (the comic's title, the story, what it must include and the hashtag) is never on the public page or in the website's code: the server sends it only to approved teams. To change it, edit `server/services/briefs.ts`.
- *After approval:* the team's page shows the story brief and unlocks the comic and the rough-sketch PDF uploads (40 pages at least, counted from the PDF; up to 100 MB; replaceable until the deadline), a printable registration confirmation, notices and resources. See uploads under **Submissions**.
- *Notices & email:* post to groups of teams (by status, age group, shortlisted) or one team; they show on the teams' pages and can be emailed (BCC, transactional, separate from the newsletter). Public announcements show on the competition page.
- *Shortlist & results:* set each approved team's result; **Publish results** shows the winners on the page (team name, first names and city, as the terms say).
- *Settings:* change the dates, pause registration, upload a different hero banner (it replaces the one on the competition page; the card on /competitions keeps the one in the code), artwork, sponsor logos, the official rules PDF and a topic document (both shown only to approved teams, since they name the story), and **Delete ID documents of decided teams** once checks are done (please do this after reviewing).
- *Exports:* participants CSV, one row per member, with or without contact and guardian details (recorded in Settings → Activity).
- *Comic kit (Settings → Comic kit):* upload the kit PDF (up to 50 MB). It's stored privately in Supabase (`competition-files` bucket). Every team that registers gets it attached to its “Application received” email, sent to the person who registered and the captain. A kit over 15 MB isn't attached; the email points to the team page instead. Every registered team (pending, approved or asked for changes, but not rejected or withdrawn) can download it from its team page through a 5-minute link. Teams that registered before the upload see it on their page straight away; to email them, send a notice (Notices & email). **Replace** gives out the new file from then on; **Remove** stops giving it out.

**Other competitions** are built on request: ask Claude for one (title, dates, description, rules, who can enter, individual, group or team, and what the form asks). It's added to `src/shared/competitions.ts` and appears on **/competitions** and in **Admin → Competitions** by itself.

## 12. Security

**Already built in.** HTTPS only (HSTS); an enforced Content Security Policy (only the site's own scripts and those of Google, Razorpay and Meta can run); no framing of the site; prices, payments and webhooks checked on the server; every database query parameterised; every form checked on the server, rate-limited and with a hidden spam trap; admin sign-in with two-step verification; each customer sees only their own orders and teams; uploaded files checked by content, size-limited, photo location data removed, kept private and opened only through short-lived, logged links; database tables locked to the server (row-level security); spreadsheet exports safe to open in Excel; no secrets in the code.

**After each deploy that changes vercel.json:** open the site, open the payment window at checkout once (you can close it without paying) and try *Sign in with Google*. Then in **Vercel → Logs**, search for `[csp]`. Anything the policy blocked is listed with its address; ask Claude to allow it if it's a service you use. **If you add a tag from another company in Google Tag Manager**, its address has to be added to the policy in `vercel.json` too, or it won't run.

**In your accounts (once):**
1. **Two-step sign-in everywhere:** GitHub, Vercel, Supabase, Razorpay, Google Workspace (Admin console → Security → 2-Step Verification → *Enforce*), Meta Business, and the company where eldenap.in is registered. Turn on the domain's *registrar lock* there too.
2. **Email authentication for eldenap.in** (stops others sending mail as you; check at [mxtoolbox.com](https://mxtoolbox.com/SuperTool.aspx) → *SPF*, *DMARC* and *DKIM*):
   - SPF: a TXT record on `eldenap.in`: `v=spf1 include:_spf.google.com ~all`. (If you send with Resend instead, add the records Resend shows under *Domains*.)
   - DKIM: Google Admin → Apps → Google Workspace → Gmail → **Authenticate email** → *Generate new record*, add it at your DNS provider, then **Start authentication**.
   - DMARC: a TXT record on `_dmarc.eldenap.in`: `v=DMARC1; p=none; rua=mailto:hello@eldenap.in`. After two weeks of reports showing only your own mail, change `p=none` to `p=quarantine`.
3. **GitHub → the repository → Settings → Code security:** turn on *Dependabot alerts* and *Dependabot security updates*. (Weekly update pull requests are already set up in `.github/dependabot.yml`.)
4. **Supabase → Advisors → Security Advisor:** it should show nothing marked *Error*. (*RLS enabled, no policy* is intended, see step 1.)
5. **Backups:** Supabase Pro backs up daily. Once, restore a backup into a new project to see that it works.
6. **Uptime alert:** a free monitor at [UptimeRobot](https://uptimerobot.com) on `https://eldenap.in/api/health` emails you if the site or its database goes down (that address answers 503 when something is wrong).
7. **Razorpay:** live keys only in Vercel's *Production* environment, test keys in *Preview*; webhook secret set (step 2).

**If something leaks or looks wrong:** change the key at its provider (Razorpay, Supabase, Google, Meta), update it in **Vercel → Settings → Environment Variables**, and redeploy. Sign out every admin from Supabase → Authentication → Users if an admin account may be affected. In India, CERT-In asks for certain cyber incidents to be reported within 6 hours ([cert-in.org.in](https://www.cert-in.org.in)); under the DPDP rules, as they come into force, a personal data breach is also reported to the people affected and to the Data Protection Board.

## 13. Where orders come from

**One-time:** run [`0013_order_source.sql`](supabase-updates/0013_order_source.sql) in Supabase → SQL Editor **before** this version goes live (until then, orders can't be saved).

**Admin → Orders** shows *Where orders came from* (paid orders and revenue for each source in the chosen dates, or the last 30 days, and the campaigns that sold most), a **Source** column and filter, and on each order *Where this order came from*: the visit that led to the order, the first visit, and how many days in between. The CSV export has Source, Campaign and Landing page columns. Orders placed before this update show *Not recorded*.

The site notes how each visitor arrived: the link's UTM tags, an ad-click marker, the referring site and the landing page (never who they are), keeps it in their browser for 90 days and sends it with an order. The order is credited to the **last visit that had a source**, so a later direct visit doesn't hide the ad that brought them.

| Shows as | When |
|---|---|
| Meta ads | a Facebook or Instagram ad whose link is tagged as paid (see below) |
| Google Ads | Google Ads clicks (auto-tagging is on by default in Google Ads) |
| Search | Google, Bing and other search results |
| Facebook / Instagram | posts, profile and bio links, or Meta ads whose links aren't tagged |
| Other social | YouTube, WhatsApp Web, X, LinkedIn… |
| Email | the newsletter (its links are tagged automatically) and webmail |
| Other websites / Other campaigns | a link on another site / other tagged links |
| Direct | typed address, bookmark, or an app that hides where the link was (WhatsApp often does) |

**Tag your Meta ads** (Ads Manager → the ad → *Tracking* → **URL parameters**), once per ad or in the ad set's template:
`utm_source={{site_source_name}}&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`

**Tag links you share yourself** so they don't land in *Direct*, e.g.
- WhatsApp groups: `https://eldenap.in/?utm_source=whatsapp&utm_medium=social&utm_campaign=class-10-launch`
- Instagram bio: `https://eldenap.in/?utm_source=instagram&utm_medium=bio`
- A poster's QR code: `https://eldenap.in/?utm_source=poster&utm_medium=qr&utm_campaign=book-fair`

## 14. Popups

**One-time:** run [`0014_popups.sql`](supabase-updates/0014_popups.sql) in Supabase → SQL Editor before this version goes live.

**Admin → Popups** (managers and the owner): **New popup** opens a gallery of templates (welcome offer with a discount code, exit-intent coupon, announcement bar, competition promo, new book, big launch, blank). The builder has five tabs, with a live preview for computer and phone:
- *Content:* the goal (email sign-up, discount code, link or announcement), heading, text, a picture, the button, a discount code (visitors can copy it or apply it to their cart), a “No thanks” link and an optional countdown. Sign-ups join the newsletter with the same consent box as the rest of the site and get the welcome email.
- *Design:* centred, slide-in, top or bottom bar, or full screen; size, colours (or a ready palette), heading style, rounding, how much the page is dimmed, and the entrance.
- *When it opens:* after some seconds, at a scroll depth, when the visitor is about to leave (phones: after some seconds), on the Nth page of a visit, or from a link ending in `#popup-<id>`. How often: once per visit, once every few days, or only once, and not again after a sign-up or click.
- *Who sees it:* pages (e.g. `/books/*`), computers or phones, first visit or returning, signed in or not, where they came from (Meta ads, Google search… as in Orders → Where orders came from), a campaign name, and whether their cart has books.
- *Schedule:* start and end dates (India time), and a priority when two could open on the same page.

**Publish** makes it live; the website picks it up within a minute. **Preview on the site** opens it on the real site straight away (draft or not, nothing counted). The results show how many times it was shown, sign-ups or clicks, the rate, closes, a day-by-day chart, and paid orders that used its discount code. Visits by people signed in to the admin aren't counted.

**Built in for every popup:** never at checkout or on order pages, never over the cookie choice or another window, at most one per page, two minutes between different popups, Esc and × always close it, keyboard focus stays inside a centred one, full-screen and centred popups become a bottom sheet on phones (Google lowers the ranking of pages with full-screen popups on phones), and email sign-up popups are never shown to signed-in student accounts.

## 15. Calls (voice agent)

**One-time:** run [`0015_calls.sql`](supabase-updates/0015_calls.sql) and then [`0016_subscriber_call_consent.sql`](supabase-updates/0016_subscriber_call_consent.sql) in Supabase → SQL Editor before this version goes live.

Two voice agents on Sarvam (persona “Priya”, Hindi and English), each with its own number: **Cart Recovery on +91 79658 60108** and **Order Feedback on +91 79658 60105**. The website decides who to call and when.
- **Incoming calls:** a customer who rings either number reaches that agent. It greets them, helps (a missed call from us, a question, a problem with an order) and transfers to 7370002080 when a person is needed. The website records the call in Admin → Calls marked *Incoming*, linked by the caller's number to their saved checkout: “send me the link” emails it, “don't call me” adds them to Do not call, a reported problem emails your order alert addresses, and “call me back” repeats our own call for that checkout. Incoming calls are counted apart and don't change the answer rates.
- **Cart recovery:** someone leaves *“Elden Academic Press may call or WhatsApp me about this order”* ticked at checkout (it starts ticked; unticking is remembered), gives a mobile number and doesn't pay. After the set delay (default 60 minutes) the agent calls, helps them finish, and only if they hesitate twice offers the coupon you set. If they want the link, they get a “Finish your order” email that restores their cart (and the coupon).
- **Order feedback:** the set number of days after a paid order from a checkout with that tick (default 3; printed books only once shipped), the agent asks how it went and mentions the new titles you choose. A reported problem emails your order alert addresses and shows as an open issue.

- **Earlier buyers:** *Settings → Order feedback → Also call earlier buyers* adds feedback calls for paid orders from the last 7 to 90 days whose buyer never saw the call box (orders from before it existed). Anyone who unticked it is never called, and a number gets at most one feedback call a month however many orders it has. Off by default.
- **Newsletter subscribers:** the sign-up form has two boxes, *“Subscribe to newsletter”* (required) and *“Subscribe to calls”* (ticked by default; it means Elden Academic Press may call or WhatsApp them about new books). It's recorded with the date; unsubscribing withdraws it. Admin → Calls shows how many subscribers allow calls. Nobody is called from this list yet: a “new books” call needs its own agent (and ideally a registered telemarketing number, since it's a sales call).

Nothing is saved before payment without the tick, and nobody is ever called without it. Calls go out only in the calling hours (default 10:00–19:00, Monday to Saturday, India time), with retries (default 2, two hours apart). Anyone who says “don't call” on a call, or whom you add in **Do not call**, is never called again. Unticking the box cancels their pending call.

**Admin → Calls** (managers and the owner): *Overview* (the master switch, a switch per agent, answered rate, recovered orders and revenue, coupons given, average rating, open issues, a day-by-day chart), *Call log* (each call's result, transcript, recording and the customer's earlier calls), *Queue* (Call now or Skip), *Checkouts* (who said yes to calls), *Do not call* and *Settings* (hours, days, delay, coupon code and what it gives, feedback day, new titles, retries). Create the coupon in **Discounts** first, then put its code here. Everything starts **off**.

**To connect:** set `CALLS_WEBHOOK_SECRET` in Vercel (a long random string) and set each number's call-end webhook in Sarvam to `https://eldenap.in/api/calls/webhook/<that string>`, with metadata `purpose` = `cart_recovery_call_end` (…0108) or `feedback_call_end` (…0105). Both are set already: copy the string at the end of that address into Vercel. A Vercel cron runs every 10 minutes to queue and place calls.

**Placing calls (Sarvam outgoing campaigns):** the site places a call by adding that one customer to a running Sarvam campaign (Sarvam's *Stream cohort* API, `POST https://apps.sarvam.ai/api/scheduling/v1/orgs/<org>/workspaces/<workspace>/campaigns/<campaign>/cohorts/stream`, header `X-API-Key`). Our call id goes in as `user_identifier` and comes back in the call-end webhook; the agent's variables go in as `app_variables`. Each campaign already has its agent, number, dialling hours (10:00–19:00 Mon–Sat, India time) and call-end webhook; Sarvam's own retries are off because the website retries. Set these in Vercel (Production), then redeploy:

| Variable | Value |
|---|---|
| `SARVAM_API_KEY` | The **Voice Agents** workspace key: apps.sarvam.ai → Settings → API Key (secret). A key for Sarvam's speech APIs (dashboard.sarvam.ai) is a different key and is refused here. |
| `SARVAM_ORG_ID` | From the Sarvam dashboard address: `…/orgs/<this>/workspaces/…` |
| `SARVAM_WORKSPACE_ID` | From the same address: `…/workspaces/<this>/…` |
| `SARVAM_CART_CAMPAIGN_ID` | `Elden---Car-4ab29de8-5933` (Cart Recovery, +91 79658 60108) |
| `SARVAM_FEEDBACK_CAMPAIGN_ID` | `Elden---Ord-7b9b8ed1-4ddd` (Order Feedback, +91 79658 60105) |

With all five set, Admin → Calls shows **Outgoing calls: Connected (sarvam)**; with any missing it shows *Not connected* and nothing is dialled, while checkouts, the queue, settings and do-not-call still work. If Sarvam refuses a call (wrong key, campaign not active, a bad number), its message is shown on the call in the Call log and the call is retried like an unanswered one.

**The campaigns end on 7 February 2027 at 19:00** (Sarvam allows at most 90 days per campaign; they started 10 November 2026). After that every call fails with Sarvam's message until they are extended or replaced. Before then, either:
- **Extend:** pause the campaign, change its end date (in the Sarvam dashboard or the *Update campaign* API, `PATCH …/campaigns/<id>` with `end_timestamp`; Sarvam accepts it only while a campaign is *paused* or *scheduled*), then resume it. If Sarvam refuses an end date more than 90 days after the start, replace it instead.
- **Replace:** create a new outgoing campaign for each agent with the same settings (agent version, connection `9e746ce3-f7-f288c8b7-cd97` and its number, dial rate 1/second, Sarvam retries off, the same hours, the same webhook address and `purpose`), then put the new ids in `SARVAM_CART_CAMPAIGN_ID` / `SARVAM_FEEDBACK_CAMPAIGN_ID` in Vercel and redeploy. Calls already handed to the old campaign finish there.

## Running costs

| Service | Cost |
|---|---|
| Supabase Pro | ~$25/month (daily backups, no pausing) |
| Vercel Pro | $20/month |
| Razorpay | No monthly fee; a percentage per payment |
| Google Workspace | Your existing plan (up to 2,000 emails a day per account) |

## Good to know

- **Link previews and book pages**: a shared link to a book (`/books/<slug>`) shows that book's title, description and cover on WhatsApp, Facebook and in search results. The server builds the page from the database (`server/routes/og.ts`), with the book's content and structured data already in the HTML. Visitors see it at once, and the full page takes over when its scripts have loaded. A book with no uploaded cover has no preview picture: upload a cover in Admin → Products to get one. The site as a whole no longer sets a preview address or picture, so other pages show only the site's name and description. Competition pages set their own.

- **Unpaid checkouts** hold printed stock for 30 minutes (Settings), then a job every 10 minutes releases it. If someone pays late, the stock is re-taken, or the order is flagged *Needs attention* if it sold out meanwhile.
- **Needs attention** also flags duplicate payments and amount mismatches — check the dashboard.
- **GST**: prices include GST. Printed books are set to 0% and e-books to 18% by default (per product). A printed copy that includes the e-book free is charged and taxed as a printed book. Invoice numbers run per financial year (`EAP/27-28/00001`). Confirm rates, HSN/SAC codes (4901 / 998431) and the bundle split with your accountant.
- **E-book protection**: files are private; buyers get links that expire after 5 minutes, limited downloads per purchase (default 10 per file, so a 3-file e-book allows 30) and a download period (default 1 year). E-books are never attached to emails; buyers download them from their order page, account or the email's buttons. Change these in Settings.
- **Book photos**: the **Cover** is the book's picture everywhere in the store. **More photos** (in the product editor, under the cover) adds up to 20 extra pictures — inside pages, the back cover, a sample chapter — with an optional description each. They appear as a row under the cover on the book's page and open full screen; they're also sent to Google Merchant Center as extra images. Pick several at once, reorder with the arrows, and save to keep them.
- **Cash on delivery** (printed books only): the customer pays an advance online through Razorpay (default ₹60) and the rest in cash on delivery. It is not offered for e-books, for carts that include an e-book, or for orders that cost no more than the advance. Change the advance or switch it off in **Settings → Cash on delivery**. COD orders show a *COD* badge in Orders, and the order page shows the cash to collect. When you mark the order **Delivered**, the cash is recorded as collected and, if the book comes with a free e-book, it unlocks and the customer is emailed the download links (until then it is locked). Refunds through the admin cover only the advance paid online; refund any cash by bank transfer or UPI yourself.
- **Speed**: the server must run in the same region as the Supabase project, because each page makes several database queries and the distance is paid on every one. `"regions"` in `vercel.json` sets the server's region (now `cdg1`, Paris, next to the Supabase project in eu-west-3). `/api/health` shows `speed.queryMs` (one small database query: a few milliseconds when they're together, ~100 between India and Europe), `serverRegion` and `databaseRegion`, and its `todo` names the right region if they don't match. Database connections are closed before Vercel pauses the server, so the first visit after a quiet spell doesn't hang; if a load still fails, the website retries once by itself. The store's book list, settings and study resources are fresh at Vercel's edge for one to five minutes. After that the edge still answers at once with its copy and refreshes it in the background (for up to a day), so visitors in India don't wait for the server in Paris. Saving in the admin clears them, and while you're signed in to the admin your browser always gets the latest. The page itself asks for the book list and settings as soon as it opens, alongside its scripts. Pages also load fast because: there's no opening animation (`showIntro` in `src/config.ts`; switching it on holds every new visitor, including every ad click, for about 5 seconds); the header logo is a small copy (`elden-mark-sm.png`); Google Fonts load only in the admin; and phones get a 1080-px copy of the competition banner.
- **Backups**: Supabase Pro takes daily backups. Exports (orders, customers, products, enquiries, competition registrations) are in the admin as CSV.
