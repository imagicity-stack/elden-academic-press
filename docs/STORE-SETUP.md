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

Order confirmations (with the PDF invoice and, when small enough, the e-book attached), shipping and refund emails are sent from your Google Workspace mailbox. Contact-form messages arrive in the inbox you choose.

1. Sign in to the Google account that will send the emails (e.g. `hello@eldenap.in`) → [myaccount.google.com](https://myaccount.google.com) → **Security** → turn on **2-Step Verification**.
2. Same page → **App passwords** (or search “App passwords”) → name it “Elden website” → **Create**. Copy the 16-letter password (spaces don't matter). If the option is missing, a Workspace admin must allow it: **admin.google.com → Security → Less secure apps / App passwords**.
3. In Vercel set:
   - `SMTP_USER` = that email address
   - `SMTP_PASS` = the app password
   - `MAIL_FROM` = `Elden Academic Press <hello@eldenap.in>` (the same address, or an alias of it added in Gmail → Settings → Accounts → *Send mail as*; otherwise Gmail shows the main address)
   - `MAIL_TO` = the inbox for contact forms and enquiries (several allowed, comma-separated)
4. So emails don't land in spam, make sure `eldenap.in` has Google's SPF and DKIM records: **admin.google.com → Apps → Google Workspace → Gmail → Authenticate email** → generate the DKIM key, add the TXT record at your domain registrar, then **Start authentication**. SPF: a TXT record `v=spf1 include:_spf.google.com ~all`.

Google Workspace sends up to 2,000 emails a day per account. (Instead of SMTP you can use [Resend](https://resend.com) with `RESEND_API_KEY`; it's used only when `SMTP_USER`/`SMTP_PASS` are empty.)

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
4. **Products**: add products one by one, or **Import** a spreadsheet (export first to get the column layout). For each e-book, upload the PDF/EPUB in the product. Upload covers (or pick typeset colours).
5. **Study Hub**: upload the free PDFs.
6. **Settings → Staff**: invite team members as *Staff* (orders, packing, enquiries) or *Manager* (also products, prices, discounts, refunds).

## 6. Test purchase (test mode)

1. Set `VITE_SITE_LIVE=true` temporarily on a **Preview** deployment, or test on production before announcing.
2. Buy a printed book and an e-book. In Razorpay's test window use UPI ID `success@razorpay` (or a [test card](https://razorpay.com/docs/payments/payments/test-card-details/)).
3. Check: the order page and e-book download work; both confirmation emails arrive; the order appears in the admin; mark it shipped (customer gets the tracking email); refund it (Razorpay test dashboard shows the refund).
4. Open the browser console during the payment: if no “Content-Security-Policy” warnings appear, change the header name `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `vercel.json` to enforce it.

## 7. Go live

1. Razorpay: switch to **Live mode**, generate live API keys and add the **same webhook** again in Live mode (webhooks are separate per mode).
2. Vercel: replace `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` with the live values; set `VITE_SITE_LIVE=true`; redeploy.
3. Place one small real order and refund it.

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
- **GST**: prices include GST. Printed books are set to 0% and e-books to 18% by default (per product). In a bundle, the price is split between the printed and e-book parts in proportion to their own prices. Invoice numbers run per financial year (`EAP/27-28/00001`). Confirm rates, HSN/SAC codes (4901 / 998431) and the bundle split with your accountant.
- **E-book protection**: files are private; buyers get links that expire after 5 minutes, limited downloads per purchase (default 10) and a download period (default 1 year). Change these in Settings.
- **Backups**: Supabase Pro takes daily backups. Exports (orders, customers, products, enquiries) are in the admin as CSV.
