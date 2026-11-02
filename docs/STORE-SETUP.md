# Store setup — from code to live payments

This is the one-time checklist to connect the store to real services. Do it in
**test mode** first; nothing here charges real money until step 7.

You will create four accounts: **Supabase** (database, admin sign-in, files),
**Razorpay** (payments), **Google Workspace** (emails) and **Vercel Pro** (hosting).
Keys go into Vercel's settings — never into code, chat or email.

---

## 1. Supabase

Everything here is done in the browser at [supabase.com/dashboard](https://supabase.com/dashboard) — no software to install.

**a. Check the region.** Click **Connect** (top of the project). In the connection strings, the address should contain `ap-south-1` (Mumbai). If it shows somewhere far away (e.g. `us-east-1`), delete the project and create a new one in **Mumbai** now, while it's empty — the region can't be changed later, and a distant database makes every page slower.

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
4. Open the browser console during the payment: if no “Content-Security-Policy” warnings appear, change the header name `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `vercel.json` to enforce it.

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

Events: PageView, ViewContent (book page), Search (store search), CustomizeProduct (switching between e-book, print and both), AddToCart, InitiateCheckout (checkout opened), AddPaymentInfo (Pay pressed), Purchase (payment confirmed), Lead (sample, school-order and teacher forms), SubmitApplication (author proposals and distributor applications), Contact (contact form, or tapping your email, phone or WhatsApp link), CompleteRegistration (first Google sign-in), Subscribe (newsletter sign-up). Cart, checkout and purchase events carry a `format` (`ebook`, `print`, `ebook+print`) for audiences such as "added an e-book, didn't buy". Meta's automatic button-click events are switched off, so only these appear. With purchases, leads and sign-ups the server sends the customer's email, phone, name, city, state and PIN code, SHA-256 hashed as Meta requires, which raises Meta's match rate.

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

## Running costs

| Service | Cost |
|---|---|
| Supabase Pro | ~$25/month (daily backups, no pausing) |
| Vercel Pro | $20/month |
| Razorpay | No monthly fee; a percentage per payment |
| Google Workspace | Your existing plan (up to 2,000 emails a day per account) |

## Good to know

- **Unpaid checkouts** hold printed stock for 30 minutes (Settings), then a job every 10 minutes releases it. If someone pays late, the stock is re-taken, or the order is flagged *Needs attention* if it sold out meanwhile.
- **Needs attention** also flags duplicate payments and amount mismatches — check the dashboard.
- **GST**: prices include GST. Printed books are set to 0% and e-books to 18% by default (per product). A printed copy that includes the e-book free is charged and taxed as a printed book. Invoice numbers run per financial year (`EAP/27-28/00001`). Confirm rates, HSN/SAC codes (4901 / 998431) and the bundle split with your accountant.
- **E-book protection**: files are private; buyers get links that expire after 5 minutes, limited downloads per purchase (default 10 per file, so a 3-file e-book allows 30) and a download period (default 1 year). E-books are never attached to emails; buyers download them from their order page, account or the email's buttons. Change these in Settings.
- **Cash on delivery** (printed books only): the customer pays an advance online through Razorpay (default ₹60) and the rest in cash on delivery. It is not offered for e-books, for carts that include an e-book, or for orders that cost no more than the advance. Change the advance or switch it off in **Settings → Cash on delivery**. COD orders show a *COD* badge in Orders, and the order page shows the cash to collect. When you mark the order **Delivered**, the cash is recorded as collected and, if the book comes with a free e-book, it unlocks and the customer is emailed the download links (until then it is locked). Refunds through the admin cover only the advance paid online; refund any cash by bank transfer or UPI yourself.
- **Speed**: `/api/health` shows `speed.queryMs` (one small database query; a few milliseconds when Supabase and Vercel are both in Mumbai) and `serverRegion` (should be `bom1`). Database connections are closed before Vercel pauses the server, so the first visit after a quiet spell doesn't hang; if a load still fails, the website retries once by itself. The store's book list is cached by Vercel for a minute and cleared whenever you save in the admin; while you're signed in to the admin, your browser always gets the latest.
- **Backups**: Supabase Pro takes daily backups. Exports (orders, customers, products, enquiries) are in the admin as CSV.
