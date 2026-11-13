# Shipping with Delhivery

Printed books ship with **Delhivery** (B2C Express Parcel). E-books never ship. Everything is in
**Admin → Shipping** and on each order's page.

## What it does

| Step | What happens |
|---|---|
| Shopper types a PIN code | Book page and checkout show **"Delivery by Tue, 18 Nov"**. A PIN code Delhivery doesn't serve can't be ordered to, and cash on delivery is offered only where Delhivery collects cash. If Delhivery can't be reached, orders go ahead. |
| Order paid (COD: confirmed) | It waits under **Shipping → To book**, or is booked straight away with **Book automatically** on. |
| Booked | Delhivery gives a waybill (AWB). The order becomes **Packed**, with the AWB and Delhivery's tracking link. Print the label (4 × 6 thermal or A4), stick it on. |
| Pickup | **Shipping → Ready for pickup → Ask Delhivery to collect**. One open pickup per location at a time. |
| Picked up | The order becomes **Shipped**; the customer gets the "on its way" email and WhatsApp. |
| Out for delivery / delivered | The customer's order page shows the live journey. **Delivered** marks the order delivered; for cash on delivery the cash is recorded as collected and the free e-book unlocks. |
| Failed delivery (NDR) | The order is flagged **Needs attention** with the courier's reason. Call the customer, then **Failed delivery → Act**: deliver again, a new date (up to 6 days), or a corrected name, address or phone. |
| Returning (RTO) / returned / lost | Flagged for the team: refund or ship again. |

Tracking updates come two ways: a **sync every 30 minutes** (Vercel cron `/api/cron/shipments`,
always on) and, once Delhivery sets it up, an **instant push** (webhook). "Refresh tracking" in
the admin syncs on demand.

Each parcel holds the order's printed books only, weighed from each book's weight (Products →
the book → print weight) plus the packing weight, in the usual box (Shipping → Settings). Staff
can change the weight, box and speed on the order page before booking. Delhivery charges the
higher of the real weight and the volumetric weight (L × W × H ÷ 5000 kg), so set real weights.

## Setting it up (once)

1. **Delhivery account.** Sign up at one.delhivery.com (B2C / Express Parcel) and finish KYC.
2. **Pickup location.** Delhivery One → Settings → Pickup locations: add the place books are
   collected from. Note its **name exactly** (capitals and spaces matter) and its PIN code.
3. **API token.** Delhivery One → Settings → API setup (or ask your Delhivery account manager /
   `lastmile-integration@delhivery.com`). A production token works on `track.delhivery.com`.
   For trying it out first, ask Delhivery for a **staging** token.
4. **Vercel** → Project → Settings → Environment Variables (Production), then redeploy:
   - `DELHIVERY_API_TOKEN` = the token (secret)
   - `DELHIVERY_ENV` = `production` (or `staging` with a staging token)
   - `DELHIVERY_WEBHOOK_SECRET` = any long random string (e.g. from a password generator)
   - `CRON_SECRET` must already be set (the 30-minute sync uses it).
5. **Database:** run `docs/supabase-updates/0026_delhivery_shipping.sql` in Supabase → SQL Editor
   (the setup check at `/api/health` says so until it's done).
6. **Admin → Shipping → Settings:** tick *Ship printed books with Delhivery*, enter the pickup
   location name and PIN code, choose Surface (usual for books) or Express, set the usual box,
   and press **Test connection**. Leave *Book automatically* off for the first week, until you've
   checked a few labels.
7. **Instant tracking (optional, recommended):** email `lastmile-integration@delhivery.com` (copy
   your Delhivery account manager) asking for the **Scan Push webhook** for your account, with:
   - Endpoint: `https://eldenap.in/api/webhooks/delhivery/<DELHIVERY_WEBHOOK_SECRET>`
   - Method `POST`, `Content-Type: application/json`, their default scan payload
     (`{"Shipment": {"AWB", "ReferenceNo", "NSLCode", "Status": {"Status", "StatusType", "StatusDateTime", "StatusLocation", "Instructions"}}}`).
   - Expected response: `200` with `{"status": "Success"}`.
   - One or two live AWBs for their test. They take 4 to 6 working days.
   Instead of the secret in the address, they can send `Authorization: Bearer <secret>` to
   `https://eldenap.in/api/webhooks/delhivery`.

## Day to day

- **Morning:** Shipping → To book → tick the orders → *Book* → *Print their labels* → pack →
  Ready for pickup → *Ask Delhivery to collect*.
- **Failed delivery** tab: act the same day (Delhivery returns parcels after a few failed attempts).
- **Returns** tab: refund or reship each one from its order page.

## Technical notes

- Code: `server/lib/delhivery.ts` (API client and simulator), `server/services/shipping.ts`
  (booking, tracking, NDR, pickups), `server/services/fulfilment.ts` (order steps shared with
  staff actions), `server/routes/admin/shipping.ts`, `src/shared/shipping.ts` (statuses),
  `src/admin/pages/Shipping.tsx`, `src/components/DeliveryCheck.tsx`.
- Delhivery endpoints used (docs: one.delhivery.com/developer-portal → B2C; the older reference is
  delhivery-express-api-doc.readme.io): `GET /c/api/pin-codes/json/`, `GET /api/dc/expected_tat`,
  `GET /api/kinko/v1/invoice/charges/.json`, `POST /api/cmu/create.json` (`format=json&data=…`),
  `GET /api/p/packing_slip?pdf=true&pdf_size=4R|A4`, `POST /api/p/edit` (cancel),
  `POST /fm/request/new/` (pickup), `GET /api/v1/packages/json/` (track, 50 per call),
  `POST /api/p/update` and `GET /api/cmu/get_bulk_upl/<id>` (NDR). Auth: `Authorization: Token <token>`.
- Status mapping (Delhivery StatusType + Status → ours) is in `src/shared/shipping.ts`; unknown
  combinations keep the last known status, so a new Delhivery status never breaks the sync.
- An order is never booked twice: a live parcel blocks a new one, bookings are locked per order,
  and the order number is Delhivery's reference (it rejects duplicates). A second parcel after a
  cancellation is sent as `<order number>-2`.
- Locally (`npm run dev`, no token) a simulator stands in for Delhivery: bookings get `SIM…`
  waybills and labels are simple PDFs. Tests: `tests/shipping.test.ts`.
- Not yet built: reverse pickups (customer returns), e-waybills for parcels over ₹50,000 (not
  needed for book orders), COD remittance reconciliation.
