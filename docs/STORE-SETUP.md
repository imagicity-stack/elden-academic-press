# Store setup — from code to live payments

This is the one-time checklist to connect the store to real services. Do it in
**test mode** first; nothing here charges real money until step 7.

You will create four accounts: **Supabase** (database, admin sign-in, files),
**Razorpay** (payments), **Resend** (emails) and **Vercel Pro** (hosting).
Keys go into Vercel's settings — never into code, chat or email.

---

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com). Choose region **Mumbai (ap-south-1)** and save the database password somewhere safe.
2. **Project Settings → API**: copy the **Project URL**, the **anon / publishable key** and the **service_role / secret key**.
3. **Connect** (top of the dashboard): copy two connection strings —
   - **Transaction pooler** (port 6543) → this becomes `DATABASE_URL` on Vercel.
   - **Session pooler** (port 5432) → used once, below, to create the tables.
4. Create the tables and storage folders from a computer with this repository:
   ```sh
   npm install
   DATABASE_URL="<session pooler string>" npm run db:migrate
   DATABASE_URL="<session pooler string>" npm run db:seed      # the six standard categories
   ```
   This also creates the `covers`, `resources` (public) and `ebooks` (private) storage buckets and locks every table so Supabase's public API keys can't read store data.
5. **Authentication → Sign In / Providers**: turn **off** “Allow new users to sign up”. Staff accounts are only created by invitation from the admin.
6. **Authentication → URL Configuration**: Site URL `https://eldenap.in`; add `https://eldenap.in/admin` to Redirect URLs.
7. **Authentication → Multi-Factor**: make sure **TOTP (authenticator app)** is enabled.
8. **Authentication → Users → Add user**: create your own account with the email you'll use as owner (e.g. `hello@eldenap.in`) and a strong password; tick *Auto confirm*.
9. **Authentication → Emails → SMTP settings**: connect Resend's SMTP (step 3) so invitation and password-reset emails come from your domain and aren't rate-limited.

## 2. Razorpay

1. Sign up at [razorpay.com](https://razorpay.com) and complete KYC (needed later for live payments).
2. Switch the dashboard to **Test mode** → **Account & Settings → API Keys → Generate key**. Copy the Key ID (`rzp_test_…`) and Key Secret.
3. **Account & Settings → Webhooks → Add new webhook** (still in Test mode):
   - URL: `https://eldenap.in/api/webhooks/razorpay`
   - Secret: a long random string (keep it — it's `RAZORPAY_WEBHOOK_SECRET`)
   - Events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`
4. Payment capture can stay automatic; the store also captures authorised payments itself.

## 3. Resend (emails)

1. Sign up at [resend.com](https://resend.com) → **Domains → Add domain** `eldenap.in` and add the DNS records it shows at your domain registrar.
2. **API Keys → Create** → that's `RESEND_API_KEY`. Emails are sent from `orders@eldenap.in` (change with `MAIL_FROM`).

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
   | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay test keys |
   | `RAZORPAY_WEBHOOK_SECRET` | the webhook secret from step 2 |
   | `RESEND_API_KEY`, `MAIL_FROM` | from step 3 |
   | `ADMIN_OWNER_EMAIL` | the email of the account you created in 1.8 |
   | `ORDER_LINK_SECRET`, `CRON_SECRET` | two different long random strings (e.g. `openssl rand -base64 48`) |

3. **Redeploy**. Then open `https://eldenap.in/api/health` — it should say `"ok":true,"payments":true`.

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
| Resend | Free up to its monthly email allowance |

## Good to know

- **Unpaid checkouts** hold printed stock for 30 minutes (Settings), then a job every 10 minutes releases it. If someone pays late, the stock is re-taken, or the order is flagged *Needs attention* if it sold out meanwhile.
- **Needs attention** also flags duplicate payments and amount mismatches — check the dashboard.
- **GST**: prices include GST. Printed books are set to 0% and e-books to 18% by default (per product). In a bundle, the price is split between the printed and e-book parts in proportion to their own prices. Invoice numbers run per financial year (`EAP/27-28/00001`). Confirm rates, HSN/SAC codes (4901 / 998431) and the bundle split with your accountant.
- **E-book protection**: files are private; buyers get links that expire after 5 minutes, limited downloads per purchase (default 10) and a download period (default 1 year). Change these in Settings.
- **Backups**: Supabase Pro takes daily backups. Exports (orders, customers, products, enquiries) are in the admin as CSV.
