// Store database schema (Postgres / Supabase). All money is integer paise.
import { sql } from 'drizzle-orm';
import type { OrderSource } from '../../src/shared/attribution.js';
import type { PopupAudience, PopupContent, PopupDesign, PopupFrequency, PopupTrigger } from '../../src/shared/popups.js';
import type { CallKind, CallSettings, CallStatus, CodConfirmation } from '../../src/shared/calls.js';
import type { WaKind, WaStatus, WhatsAppSettings } from '../../src/shared/whatsapp.js';
import {
  boolean, check, date, index, integer, jsonb, pgEnum, pgSequence, pgTable, primaryKey, serial, smallint, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

/** One file of an e-book: where it's stored, its file name, and a label for buyers ("Part 1"). */
export interface EbookFile { path: string; name: string; title: string; size: number | null }
/** An extra photo of a product (inside pages, back cover…), in the covers bucket. The cover stays separate. */
export interface ProductImage { path: string; alt: string }

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const productStatus = pgEnum('product_status', ['draft', 'active', 'archived']);
export const variantKind = pgEnum('variant_kind', ['print', 'digital', 'bundle']);
export const levelEnum = pgEnum('level', ['P', 'M', 'S', 'SS', 'C', 'H']);
export const paymentStatus = pgEnum('payment_status', ['pending', 'paid', 'partially_refunded', 'refunded', 'failed', 'expired']);
export const fulfillmentStatus = pgEnum('fulfillment_status', ['unfulfilled', 'packed', 'shipped', 'delivered', 'not_required']);
export const refundStatus = pgEnum('refund_status', ['pending', 'processed', 'failed']);
export const couponType = pgEnum('coupon_type', ['percent', 'fixed']);
export const enquiryKind = pgEnum('enquiry_kind', ['sample', 'bulk', 'teacher', 'dist', 'contact', 'proposal']);
export const enquiryStatus = pgEnum('enquiry_status', ['new', 'in_progress', 'closed']);
export const adminRole = pgEnum('admin_role', ['owner', 'manager', 'staff']);
export const subscriberStatus = pgEnum('subscriber_status', ['pending', 'subscribed', 'unsubscribed']);
export const campaignStatus = pgEnum('campaign_status', ['draft', 'scheduled', 'sending', 'sent', 'cancelled']);
export const sendStatus = pgEnum('send_status', ['queued', 'sent', 'failed', 'skipped']);

export const orderNumberSeq = pgSequence('order_number_seq', { startWith: 100001 });

/* ---------------- Catalogue ---------------- */

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description').notNull().default(''),
  sort: integer('sort').notNull().default(0),
  createdAt: timestamps.createdAt,
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  series: text('series').notNull().default(''),
  author: text('author').notNull().default(''),
  blurb: text('blurb').notNull().default(''),
  description: text('description').notNull().default(''),
  categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
  level: levelEnum('level').notNull(),
  classLabel: text('class_label').notNull().default(''),
  grade: smallint('grade'),
  boards: text('boards').array().notNull().default(sql`'{}'::text[]`),
  subject: text('subject').notNull().default(''),
  language: text('language').notNull().default('English'),
  pages: integer('pages'),
  edition: text('edition').notNull().default(''),
  isbn: text('isbn').notNull().default(''),
  highlights: text('highlights').array().notNull().default(sql`'{}'::text[]`),
  contents: text('contents').array().notNull().default(sql`'{}'::text[]`),
  coverPath: text('cover_path'),
  coverPalette: smallint('cover_palette').notNull().default(0),
  images: jsonb('images').$type<ProductImage[]>().notNull().default([]),
  hasCompanion: boolean('has_companion').notNull().default(false),
  isNew: boolean('is_new').notNull().default(false),
  featured: boolean('featured').notNull().default(false),
  /** Buyers of the printed copy also get the e-book files free (set per book). */
  ebookWithPrint: boolean('ebook_with_print').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  status: productStatus('status').notNull().default('draft'),
  seoTitle: text('seo_title').notNull().default(''),
  seoDescription: text('seo_description').notNull().default(''),
  ...timestamps,
}, (t) => [index('products_status_idx').on(t.status), index('products_category_idx').on(t.categoryId)]);

/**
 * One row per way a product is sold. `bundle` is the e-book with a printed
 * copy added; it has its own price and draws stock from the print variant.
 */
export const productVariants = pgTable('product_variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  kind: variantKind('kind').notNull(),
  price: integer('price').notNull(),
  compareAtPrice: integer('compare_at_price'),
  sku: text('sku'),
  stock: integer('stock').notNull().default(0),
  trackStock: boolean('track_stock').notNull().default(true),
  weightGrams: integer('weight_grams'),
  /** GST % included in the price (printed books are usually 0, e-books 18). */
  taxRate: smallint('tax_rate').notNull().default(0),
  /** The e-book's first file (kept in step with `files[0]`). */
  filePath: text('file_path'),
  fileName: text('file_name'),
  fileSize: integer('file_size'),
  /** All of the e-book's files, in order (e.g. Part 1, Part 2, Answer key). */
  files: jsonb('files').$type<EbookFile[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  ...timestamps,
}, (t) => [
  uniqueIndex('variants_product_kind_idx').on(t.productId, t.kind),
  uniqueIndex('variants_sku_idx').on(t.sku),
  check('variants_price_check', sql`${t.price} >= 0`),
  check('variants_stock_check', sql`${t.stock} >= 0`),
]);

export const inventoryMovements = pgTable('inventory_movements', {
  id: serial('id').primaryKey(),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  delta: integer('delta').notNull(),
  stockAfter: integer('stock_after').notNull(),
  reason: text('reason').notNull(),
  orderId: uuid('order_id'),
  actor: text('actor').notNull().default('system'),
  note: text('note').notNull().default(''),
  createdAt: timestamps.createdAt,
}, (t) => [index('inventory_variant_idx').on(t.variantId)]);

/* ---------------- Customers, coupons ---------------- */

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  phone: text('phone').notNull().default(''),
  name: text('name').notNull().default(''),
  ordersCount: integer('orders_count').notNull().default(0),
  totalSpent: integer('total_spent').notNull().default(0),
  firstOrderAt: timestamp('first_order_at', { withTimezone: true }),
  lastOrderAt: timestamp('last_order_at', { withTimezone: true }),
  notes: text('notes').notNull().default(''),
  ...timestamps,
});

export const coupons = pgTable('coupons', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  description: text('description').notNull().default(''),
  type: couponType('type').notNull(),
  /** Percent (1–100) or fixed amount in paise. */
  value: integer('value').notNull(),
  minSubtotal: integer('min_subtotal').notNull().default(0),
  maxDiscount: integer('max_discount'),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  usageLimit: integer('usage_limit'),
  usedCount: integer('used_count').notNull().default(0),
  oncePerCustomer: boolean('once_per_customer').notNull().default(false),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

/* ---------------- Orders & payments ---------------- */

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: integer('number').notNull().unique().default(sql`nextval('order_number_seq')`),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  shipName: text('ship_name'),
  shipLine1: text('ship_line1'),
  shipLine2: text('ship_line2'),
  shipCity: text('ship_city'),
  shipState: text('ship_state'),
  shipPincode: text('ship_pincode'),
  /** GST state code for place of supply. */
  billingState: text('billing_state').notNull(),
  requiresShipping: boolean('requires_shipping').notNull(),
  subtotal: integer('subtotal').notNull(),
  discount: integer('discount').notNull().default(0),
  shipping: integer('shipping').notNull().default(0),
  /** GST included in the total. */
  tax: integer('tax').notNull().default(0),
  total: integer('total').notNull(),
  couponCode: text('coupon_code'),
  paymentStatus: paymentStatus('payment_status').notNull().default('pending'),
  fulfillmentStatus: fulfillmentStatus('fulfillment_status').notNull().default('unfulfilled'),
  razorpayOrderId: text('razorpay_order_id').unique(),
  razorpayPaymentId: text('razorpay_payment_id'),
  paymentMethod: text('payment_method'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  stockReserved: boolean('stock_reserved').notNull().default(false),
  invoiceNumber: text('invoice_number').unique(),
  invoiceDate: timestamp('invoice_date', { withTimezone: true }),
  courier: text('courier'),
  trackingNumber: text('tracking_number'),
  trackingUrl: text('tracking_url'),
  packedAt: timestamp('packed_at', { withTimezone: true }),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
  refundedAmount: integer('refunded_amount').notNull().default(0),
  customerNote: text('customer_note').notNull().default(''),
  /** Ticked "email me about new books and offers" at checkout; subscribed once paid. */
  newsletterOptIn: boolean('newsletter_opt_in').notNull().default(false),
  /** Another email whose account may also open this order's e-books (set by staff, e.g. the
   *  buyer's Google address when they ordered with a different one). */
  ebookEmail: text('ebook_email'),
  /** 'online' (paid in full) or 'cod' (an advance paid online, the rest in cash on delivery). */
  paymentMode: text('payment_mode').notNull().default('online'),
  /** Cash on delivery: the balance to collect when the books are delivered (0 for online orders). */
  codAmount: integer('cod_amount').notNull().default(0),
  codCollectedAt: timestamp('cod_collected_at', { withTimezone: true }),
  /** Cash on delivery: the confirmation call (src/shared/calls.ts CodConfirmation; '' for online orders). */
  codConfirmation: text('cod_confirmation').$type<CodConfirmation>().notNull().default(''),
  codConfirmedAt: timestamp('cod_confirmed_at', { withTimezone: true }),
  /** 'call' (the agent) or the email of the team member who confirmed it. */
  codConfirmedBy: text('cod_confirmed_by'),
  /** Accepted ad cookies when ordering: the purchase may be reported to Meta, with these browser details. */
  adConsent: boolean('ad_consent').notNull().default(false),
  fbp: text('fbp'),
  fbc: text('fbc'),
  userAgent: text('user_agent'),
  /** Where the order came from (src/shared/attribution.ts): 'meta_ads', 'search', 'direct'… ('unknown' before it was recorded). */
  channel: text('channel').notNull().default('unknown'),
  /** The buyer's first visit and last visit with a source: UTM tags, referring site, landing page. Nothing personal. */
  source: jsonb('source').$type<OrderSource>(),
  internalNote: text('internal_note').notNull().default(''),
  needsAttention: boolean('needs_attention').notNull().default(false),
  attentionReason: text('attention_reason'),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  ip: text('ip'),
  ...timestamps,
}, (t) => [
  index('orders_created_idx').on(t.createdAt),
  index('orders_payment_idx').on(t.paymentStatus),
  index('orders_email_idx').on(t.email),
  index('orders_channel_idx').on(t.channel),
]);

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  variantKind: variantKind('variant_kind').notNull(),
  title: text('title').notNull(),
  formatLabel: text('format_label').notNull(),
  sku: text('sku'),
  unitPrice: integer('unit_price').notNull(),
  quantity: integer('quantity').notNull(),
  lineTotal: integer('line_total').notNull(),
  discount: integer('discount').notNull().default(0),
  taxableValue: integer('taxable_value').notNull().default(0),
  taxAmount: integer('tax_amount').notNull().default(0),
  /** Highest GST rate in this line (bundles mix 0% print and the e-book rate). */
  taxRate: smallint('tax_rate').notNull().default(0),
  requiresShipping: boolean('requires_shipping').notNull(),
  isDigital: boolean('is_digital').notNull(),
  weightGrams: integer('weight_grams').notNull().default(0),
  downloadsUsed: integer('downloads_used').notNull().default(0),
  /** A printed copy that came with the e-book free (decided at purchase, kept if the book's setting changes). */
  includesEbook: boolean('includes_ebook').notNull().default(false),
}, (t) => [index('order_items_order_idx').on(t.orderId)]);

export const orderEvents = pgTable('order_events', {
  id: serial('id').primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  message: text('message').notNull(),
  actor: text('actor').notNull().default('system'),
  data: jsonb('data'),
  createdAt: timestamps.createdAt,
}, (t) => [index('order_events_order_idx').on(t.orderId)]);

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  razorpayPaymentId: text('razorpay_payment_id').notNull().unique(),
  razorpayOrderId: text('razorpay_order_id').notNull(),
  amount: integer('amount').notNull(),
  status: text('status').notNull(),
  method: text('method'),
  raw: jsonb('raw'),
  ...timestamps,
});

export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  razorpayRefundId: text('razorpay_refund_id').unique(),
  razorpayPaymentId: text('razorpay_payment_id').notNull(),
  amount: integer('amount').notNull(),
  status: refundStatus('status').notNull().default('pending'),
  reason: text('reason').notNull().default(''),
  restocked: boolean('restocked').notNull().default(false),
  actor: text('actor').notNull(),
  ...timestamps,
});

export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  event: text('event').notNull(),
  payload: jsonb('payload'),
  error: text('error'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

export const invoiceCounters = pgTable('invoice_counters', {
  fy: text('fy').primaryKey(),
  last: integer('last').notNull().default(0),
});

/* ---------------- Enquiries & Study Hub ---------------- */

export const enquiries = pgTable('enquiries', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: enquiryKind('kind').notNull(),
  status: enquiryStatus('status').notNull().default('new'),
  name: text('name').notNull(),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  institution: text('institution').notNull().default(''),
  city: text('city').notNull().default(''),
  role: text('role').notNull().default(''),
  title: text('title').notNull().default(''),
  message: text('message').notNull().default(''),
  data: jsonb('data'),
  handledBy: text('handled_by'),
  ip: text('ip'),
  ...timestamps,
}, (t) => [index('enquiries_status_idx').on(t.status), index('enquiries_created_idx').on(t.createdAt)]);

export const resources = pgTable('resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  kind: text('kind').notNull(),
  level: levelEnum('level').notNull(),
  subject: text('subject').notNull().default(''),
  filePath: text('file_path'),
  fileSize: integer('file_size'),
  published: boolean('published').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  downloadCount: integer('download_count').notNull().default(0),
  ...timestamps,
});

/* ---------------- Admin & system ---------------- */

export const settings = pgTable('settings', {
  id: smallint('id').primaryKey().default(1),
  storeName: text('store_name').notNull().default('Elden Academic Press'),
  legalName: text('legal_name').notNull().default('Elden Academic Press'),
  gstin: text('gstin').notNull().default(''),
  address: text('address').notNull().default('Hazaribagh, Jharkhand'),
  /** GST state code of the business (20 = Jharkhand). */
  stateCode: text('state_code').notNull().default('20'),
  supportEmail: text('support_email').notNull().default('hello@eldenap.in'),
  supportPhone: text('support_phone').notNull().default(''),
  shippingFlat: integer('shipping_flat').notNull().default(6000),
  freeShippingAbove: integer('free_shipping_above').notNull().default(99900),
  orderExpiryMinutes: integer('order_expiry_minutes').notNull().default(30),
  invoicePrefix: text('invoice_prefix').notNull().default('EAP'),
  notifyEmails: text('notify_emails').array().notNull().default(sql`'{}'::text[]`),
  requireMfa: boolean('require_mfa').notNull().default(true),
  lowStockThreshold: integer('low_stock_threshold').notNull().default(5),
  maxDownloads: integer('max_downloads').notNull().default(10),
  downloadExpiryDays: integer('download_expiry_days').notNull().default(365),
  /** Newsletter emails sent per rolling 24 hours (Google Workspace allows about 2,000 a day in total). */
  newsletterDailyLimit: integer('newsletter_daily_limit').notNull().default(1500),
  /** Cash on delivery for printed-book orders, with an advance paid online (paise). */
  codEnabled: boolean('cod_enabled').notNull().default(true),
  codAdvance: integer('cod_advance').notNull().default(6000),
  /** How the advance is worked out: 'flat' (cod_advance) or 'percent' of the order total. */
  codAdvanceType: text('cod_advance_type').$type<'flat' | 'percent'>().notNull().default('flat'),
  /** Percentage, in basis points (1000 = 10%). */
  codAdvanceBps: integer('cod_advance_bps').notNull().default(1000),
  /** Percentage only: the smallest advance (paise; 0 = none). */
  codAdvanceMin: integer('cod_advance_min').notNull().default(0),
  /**
   * Cookie banner off: every visitor is treated as having accepted cookies (analytics and ads),
   * except staff, the admin, and students under Meta's minimum age; a visitor can still turn
   * them off from "Cookie settings". Meant until India's DPDP consent rules apply (May 2027).
   */
  consentAuto: boolean('consent_auto').notNull().default(false),
  updatedAt: timestamps.updatedAt,
}, (t) => [check('settings_singleton', sql`${t.id} = 1`)]);

export const adminUsers = pgTable('admin_users', {
  /** Supabase Auth user id. */
  userId: uuid('user_id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull().default(''),
  role: adminRole('role').notNull().default('staff'),
  active: boolean('active').notNull().default(true),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamps.createdAt,
});

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  details: jsonb('details'),
  ip: text('ip'),
  createdAt: timestamps.createdAt,
}, (t) => [index('audit_created_idx').on(t.createdAt)]);

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(0),
});

/* ---------------- Accounts & newsletter ---------------- */

/** Customers who signed in on the website (Google), with the mobile number they add. */
/** "I am a…" on the profile. */
export const accountType = pgEnum('account_type', ['parent', 'student', 'teacher', 'other']);

export const accounts = pgTable('accounts', {
  userId: uuid('user_id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull().default(''),
  phone: text('phone').notNull().default(''),
  avatarUrl: text('avatar_url'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  /** The profile ("Complete your profile" on the account page). Shopping never needs it; competitions do.
   *  The mobile (WhatsApp) number is `phone` above. */
  accountType: accountType('account_type'),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  fullName: text('full_name').notNull().default(''),
  /** Not used (the earlier competitions system); the number is in `phone`. */
  whatsapp: text('whatsapp').notNull().default(''),
  city: text('city').notNull().default(''),
  /** GST state code, as at checkout. */
  state: text('state').notNull().default(''),
  /** Not used (the earlier competitions system). */
  typeLockedAt: timestamp('type_locked_at', { withTimezone: true }),
  /** Profile details that depend on "I am a" (students: date of birth, class or year, institution,
   *  a parent's contact if under 18; teachers: institution). */
  dob: date('dob', { mode: 'string' }),
  institutionType: text('institution_type').notNull().default(''),
  institutionName: text('institution_name').notNull().default(''),
  grade: text('grade').notNull().default(''),
  guardianName: text('guardian_name').notNull().default(''),
  guardianPhone: text('guardian_phone').notNull().default(''),
  instagram: text('instagram').notNull().default(''),
  /** How they reached the site before signing up (the visit their browser remembered), and its channel. */
  source: jsonb('source').$type<OrderSource>(),
  channel: text('channel').notNull().default(''),
  channelDetail: text('channel_detail').notNull().default(''),
  ...timestamps,
}, (t) => [index('accounts_email_idx').on(t.email)]);

export const subscribers = pgTable('subscribers', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull().default(''),
  phone: text('phone').notNull().default(''),
  status: subscriberStatus('status').notNull().default('pending'),
  /** Where they signed up: footer, newsletter page, checkout, account, admin, import. */
  source: text('source').notNull().default(''),
  consentAt: timestamp('consent_at', { withTimezone: true }),
  consentIp: text('consent_ip'),
  unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
  /** Ticked "Subscribe to calls" when signing up (we may call or WhatsApp them about new books). */
  callConsent: boolean('call_consent').notNull().default(false),
  callConsentAt: timestamp('call_consent_at', { withTimezone: true }),
  /** How they reached the site before signing up (Meta ads, Google…), and its channel. */
  visit: jsonb('visit').$type<OrderSource>(),
  channel: text('channel').notNull().default(''),
  channelDetail: text('channel_detail').notNull().default(''),
  /** Signed up through this popup. */
  popupId: uuid('popup_id'),
  ...timestamps,
}, (t) => [index('subscribers_status_idx').on(t.status)]);

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  subject: text('subject').notNull(),
  preheader: text('preheader').notNull().default(''),
  heading: text('heading').notNull().default(''),
  body: text('body').notNull().default(''),
  ctaLabel: text('cta_label').notNull().default(''),
  ctaUrl: text('cta_url').notNull().default(''),
  /** Books shown in the email with cover, price and a buy button. */
  productIds: jsonb('product_ids').$type<string[]>().notNull().default([]),
  status: campaignStatus('status').notNull().default('draft'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  recipients: integer('recipients').notNull().default(0),
  sentCount: integer('sent_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  createdBy: text('created_by').notNull().default(''),
  ...timestamps,
}, (t) => [index('campaigns_status_idx').on(t.status)]);

/** One row per recipient of a campaign, so sending can resume in batches and never repeats. */
export const campaignSends = pgTable('campaign_sends', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  subscriberId: uuid('subscriber_id').notNull().references(() => subscribers.id, { onDelete: 'cascade' }),
  status: sendStatus('status').notNull().default('queued'),
  error: text('error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('campaign_sends_unique').on(t.campaignId, t.subscriberId),
  index('campaign_sends_queue_idx').on(t.status, t.createdAt),
  index('campaign_sends_sent_idx').on(t.sentAt),
]);


/* ======================= Competitions ======================= */
// Each competition is built in code (src/shared/competitions.ts); people who register
// are stored here, one row per registration (one person, or a group with its members).

export const signupMode = pgEnum('signup_mode', ['individual', 'group']);

export const competitionSignups = pgTable('competition_signups', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** The competition's slug in src/shared/competitions.ts. */
  competitionSlug: text('competition_slug').notNull(),
  userId: uuid('user_id').notNull(),
  /** The account's email when they registered. */
  email: text('email').notNull(),
  mode: signupMode('mode').notNull(),
  /** Groups only. */
  groupName: text('group_name').notNull().default(''),
  /** Answers to the competition's questions for the whole registration. */
  answers: jsonb('answers').$type<Record<string, string>>().notNull().default({}),
  /** One entry per person taking part (just one for an individual registration). */
  participants: jsonb('participants').$type<Record<string, string>[]>().notNull().default([]),
  createdAt: timestamps.createdAt,
}, (t) => [index('signup_competition_idx').on(t.competitionSlug, t.createdAt), index('signup_user_idx').on(t.userId)]);

/* ---- Team competitions (DoomsDay Diaries first) ----
 * One application per team: the person who registers fills in the whole team (2 to 4
 * members, roles, an ID document each, a parent's or guardian's details and consent for
 * anyone under 18). The organiser reviews it; once approved the team uploads its files. */

export const teamApplications = pgTable('team_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  competitionSlug: text('competition_slug').notNull(),
  /** Shown as DD-0001 (prefix from the competition). */
  applicationNo: serial('application_no').notNull().unique(),
  /** The account that registered the team (a student, teacher or parent). */
  userId: uuid('user_id').notNull(),
  email: text('email').notNull(),
  teamName: text('team_name').notNull(),
  /** school | college | other */
  institutionType: text('institution_type').notNull(),
  /** The team's school or college (for "other": the group or organisation, optional). */
  institutionName: text('institution_name').notNull().default(''),
  city: text('city').notNull(),
  state: text('state').notNull(),
  /** Age group from the oldest member, e.g. junior | rising | senior | open. */
  category: text('category').notNull(),
  /** pending | changes_requested | approved | rejected | withdrawn */
  status: text('status').notNull().default('pending'),
  /** What the organiser told the team (changes needed, or why it was rejected). */
  reviewNote: text('review_note').notNull().default(''),
  adminNotes: text('admin_notes').notNull().default(''),
  /** '' | shortlisted | first | second | third | peoples_choice */
  result: text('result').notNull().default(''),
  /** Automatic checks, e.g. possible_duplicate. */
  flags: text('flags').array().notNull().default(sql`'{}'::text[]`),
  acceptedTermsAt: timestamp('accepted_terms_at', { withTimezone: true }).notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedBy: text('reviewed_by').notNull().default(''),
  ...timestamps,
}, (t) => [index('team_app_comp_idx').on(t.competitionSlug, t.status), index('team_app_user_idx').on(t.userId)]);

export const teamMembers = pgTable('team_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => teamApplications.id, { onDelete: 'cascade' }),
  /** 0 is the team captain. */
  position: smallint('position').notNull(),
  fullName: text('full_name').notNull(),
  dob: date('dob', { mode: 'string' }).notNull(),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  /** Their own school, college or institution (the team's, unless the team is "other"). */
  institutionName: text('institution_name').notNull().default(''),
  /** writer, artist, colourist, letterer */
  roles: text('roles').array().notNull(),
  instagram: text('instagram').notNull().default(''),
  /** school_id | institution_letter | masked_aadhaar | govt_id */
  idDocType: text('id_doc_type').notNull().default(''),
  /** Private bucket; removed once no longer needed (idDocDeletedAt). */
  idDocKey: text('id_doc_key'),
  idDocDeletedAt: timestamp('id_doc_deleted_at', { withTimezone: true }),
  guardianName: text('guardian_name').notNull().default(''),
  guardianRelation: text('guardian_relation').notNull().default(''),
  guardianPhone: text('guardian_phone').notNull().default(''),
  guardianEmail: text('guardian_email').notNull().default(''),
  /** When the person registering confirmed the parent's or guardian's consent (under 18 only). */
  guardianConsentAt: timestamp('guardian_consent_at', { withTimezone: true }),
}, (t) => [index('team_member_app_idx').on(t.applicationId)]);

export const teamFiles = pgTable('team_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => teamApplications.id, { onDelete: 'cascade' }),
  /** comic | sketches */
  kind: text('kind').notNull(),
  /** Null once replaced by a newer upload (the history row stays). */
  storageKey: text('storage_key'),
  originalName: text('original_name').notNull().default(''),
  sizeBytes: integer('size_bytes').notNull(),
  /** Counted from the PDF; null if it couldn't be counted (the organiser checks by hand). */
  pages: integer('pages'),
  uploadedBy: text('uploaded_by').notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  replacedAt: timestamp('replaced_at', { withTimezone: true }),
}, (t) => [index('team_files_app_idx').on(t.applicationId, t.kind)]);

/** Notices from the organiser: on the website (public, or in teams' dashboards) and optionally emailed. */
export const competitionNotices = pgTable('competition_notices', {
  id: uuid('id').primaryKey().defaultRandom(),
  competitionSlug: text('competition_slug').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  /** Who sees it: { public?: true } or { statuses?, categories?, results?, applicationIds? } */
  audience: jsonb('audience').$type<NoticeAudience>().notNull(),
  emailed: integer('emailed').notNull().default(0),
  createdBy: text('created_by').notNull(),
  createdAt: timestamps.createdAt,
}, (t) => [index('notices_comp_idx').on(t.competitionSlug, t.createdAt)]);

export interface NoticeAudience { public?: boolean; statuses?: string[]; categories?: string[]; results?: string[]; applicationIds?: string[] }

/** What the admin changes for a competition without new code: dates, pictures, documents, results. */
export const competitionSettings = pgTable('competition_settings', {
  slug: text('slug').primaryKey(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: text('updated_by').notNull().default(''),
  updatedAt: timestamps.updatedAt,
});

/* ---- The earlier competitions system (switched off, November 2026) ----
 * Parent approval, children, per-competition editor and entries. Its tables stay so that
 * nothing already saved is lost; nothing in the website or the admin uses them now. */

export const approvalStatus = pgEnum('approval_status', ['pending', 'approved', 'declined', 'expired']);
export const competitionType = pgEnum('competition_type', ['comic', 'story', 'essay', 'drawing', 'poem', 'quiz', 'video', 'photo', 'live_event', 'other']);
export const publishState = pgEnum('publish_state', ['draft', 'published', 'archived']);
export const regionScope = pgEnum('region_scope', ['pan_india', 'states']);
export const participationMode = pgEnum('participation_mode', ['individual', 'team']);
export const formFieldType = pgEnum('form_field_type', ['text', 'textarea', 'select', 'multiselect', 'checkbox', 'number']);
export const resourceVisibility = pgEnum('resource_visibility', ['public', 'registered_only']);
export const prizeType = pgEnum('prize_type', ['physical', 'voucher', 'digital', 'certificate']);
export const compEmailType = pgEnum('comp_email_type', ['registration_confirmed', 'submission_received']);
export const emailAudience = pgEnum('email_audience', ['parent', 'student']);
export const consentType = pgEnum('consent_type', ['data_processing', 'publication', 'marketing']);
export const registrationStatus = pgEnum('registration_status', ['registered', 'withdrawn', 'disqualified']);
export const submissionStatus = pgEnum('submission_status', ['draft', 'submitted', 'withdrawn', 'under_review', 'shortlisted', 'winner', 'disqualified']);
export const fileKind = pgEnum('file_kind', ['main', 'extra']);
export const notifyChannel = pgEnum('notify_channel', ['email', 'whatsapp']);
export const notifyStatus = pgEnum('notify_status', ['queued', 'sent', 'failed']);

export const studentProfiles = pgTable('student_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** The student's own login, if they have one. */
  studentUserId: uuid('student_user_id'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  classGrade: smallint('class_grade').notNull(),
  schoolName: text('school_name').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  approvalStatus: approvalStatus('approval_status').notNull().default('pending'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  /** Class confirmed for the academic session (asked again each April). */
  classConfirmedAt: timestamp('class_confirmed_at', { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  ...timestamps,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('student_user_idx').on(t.studentUserId).where(sql`student_user_id IS NOT NULL AND deleted_at IS NULL`),
  index('student_status_idx').on(t.approvalStatus, t.createdAt),
  check('student_class_range', sql`class_grade BETWEEN 3 AND 12`),
]);

export const studentGuardians = pgTable('student_guardians', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentProfileId: uuid('student_profile_id').notNull().references(() => studentProfiles.id, { onDelete: 'cascade' }),
  parentUserId: uuid('parent_user_id').notNull(),
  relation: text('relation').notNull().default(''),
  isPrimary: boolean('is_primary').notNull().default(true),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('guardian_pair_idx').on(t.studentProfileId, t.parentUserId), index('guardian_parent_idx').on(t.parentUserId)]);

export const parentApprovalRequests = pgTable('parent_approval_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentProfileId: uuid('student_profile_id').notNull().references(() => studentProfiles.id, { onDelete: 'cascade' }),
  parentName: text('parent_name').notNull(),
  parentWhatsapp: text('parent_whatsapp').notNull(),
  parentEmail: text('parent_email').notNull(),
  /** SHA-256 of the link's token; the token itself is never stored. */
  tokenHash: text('token_hash').notNull().unique(),
  status: approvalStatus('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  approvedByUserId: uuid('approved_by_user_id'),
  createdAt: timestamps.createdAt,
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => [index('approval_student_idx').on(t.studentProfileId), index('approval_status_idx').on(t.status, t.createdAt)]);

export const studentLoginInvites = pgTable('student_login_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentProfileId: uuid('student_profile_id').notNull().references(() => studentProfiles.id, { onDelete: 'cascade' }),
  createdByParentUserId: uuid('created_by_parent_user_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  claimedByUserId: uuid('claimed_by_user_id'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  createdAt: timestamps.createdAt,
});

/** Append-only: a change of mind is a new row, never an edit. */
export const consentRecords = pgTable('consent_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentProfileId: uuid('student_profile_id').notNull(),
  /** Always a linked parent. */
  givenByUserId: uuid('given_by_user_id').notNull(),
  /** Null in Phase 1: consents are for the account, not one competition. */
  competitionId: uuid('competition_id'),
  consentType: consentType('consent_type').notNull(),
  textVersion: text('text_version').notNull(),
  granted: boolean('granted').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamps.createdAt,
}, (t) => [index('consent_student_idx').on(t.studentProfileId, t.consentType, t.createdAt)]);

export interface CompetitionFaq { question: string; answer: string }
export interface CompetitionJudge { name: string; role: string; photoKey: string | null }
export interface ExtraFileSpec { key: string; label: string; helpText: string; required: boolean }
export interface UpsellRule { classMin: number; classMax: number; productId: string | null; url: string | null; headline: string }
export type SubmissionKind = 'file' | 'text' | 'link';

export const competitions = pgTable('competitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  /** 2–4 capital letters at the start of every entry code (ABC-A-0042). */
  entryCodePrefix: text('entry_code_prefix').notNull().unique(),
  title: text('title').notNull(),
  tagline: text('tagline').notNull().default(''),
  type: competitionType('type').notNull().default('other'),
  prompt: text('prompt').notNull().default(''),
  description: text('description').notNull().default(''),
  rulesContent: text('rules_content').notNull().default(''),
  rulesPdfKey: text('rules_pdf_key'),
  disclaimer: text('disclaimer').notNull().default(''),
  thumbnail9x16Key: text('thumbnail_9x16_key'),
  image1x1Key: text('image_1x1_key'),
  banner16x9Key: text('banner_16x9_key'),
  languages: text('languages').array().notNull().default(sql`'{English}'::text[]`),
  organiserName: text('organiser_name').notNull().default('Elden Academic Press'),
  faqs: jsonb('faqs').$type<CompetitionFaq[]>().notNull().default([]),
  judges: jsonb('judges').$type<CompetitionJudge[]>().notNull().default([]),
  regionScope: regionScope('region_scope').notNull().default('pan_india'),
  states: text('states').array().notNull().default(sql`'{}'::text[]`),
  participationMode: participationMode('participation_mode').notNull().default('individual'),
  teamMin: smallint('team_min'),
  teamMax: smallint('team_max'),
  maxEntriesPerStudent: smallint('max_entries_per_student').notNull().default(1),
  isPaid: boolean('is_paid').notNull().default(false),
  feeAmountInr: integer('fee_amount_inr'),
  seatCap: integer('seat_cap'),
  announceAt: timestamp('announce_at', { withTimezone: true }),
  registrationOpensAt: timestamp('registration_opens_at', { withTimezone: true }),
  registrationClosesAt: timestamp('registration_closes_at', { withTimezone: true }),
  submissionOpensAt: timestamp('submission_opens_at', { withTimezone: true }),
  submissionClosesAt: timestamp('submission_closes_at', { withTimezone: true }),
  submissionGraceMinutes: smallint('submission_grace_minutes').notNull().default(0),
  judgingStartsAt: timestamp('judging_starts_at', { withTimezone: true }),
  shortlistAt: timestamp('shortlist_at', { withTimezone: true }),
  votingOpensAt: timestamp('voting_opens_at', { withTimezone: true }),
  votingClosesAt: timestamp('voting_closes_at', { withTimezone: true }),
  resultsAt: timestamp('results_at', { withTimezone: true }),
  submissionRequired: boolean('submission_required').notNull().default(true),
  allowedSubmissionTypes: text('allowed_submission_types').array().$type<SubmissionKind[]>().notNull().default(sql`'{file}'::text[]`),
  allowedMimeTypes: text('allowed_mime_types').array().notNull().default(sql`'{image/jpeg,image/png,application/pdf}'::text[]`),
  maxFileSizeMb: smallint('max_file_size_mb').notNull().default(10),
  maxMainFiles: smallint('max_main_files').notNull().default(1),
  extraFiles: jsonb('extra_files').$type<ExtraFileSpec[]>().notNull().default([]),
  minWords: integer('min_words'),
  maxWords: integer('max_words'),
  allowEditUntilDeadline: boolean('allow_edit_until_deadline').notNull().default(true),
  allowWithdraw: boolean('allow_withdraw').notNull().default(true),
  declarationText: text('declaration_text').notNull().default(''),
  consentTextVersion: text('consent_text_version').notNull().default('v1'),
  termsVersion: text('terms_version').notNull().default('v1'),
  upsellRules: jsonb('upsell_rules').$type<UpsellRule[]>().notNull().default([]),
  seoTitle: text('seo_title').notNull().default(''),
  seoDescription: text('seo_description').notNull().default(''),
  ogImageKey: text('og_image_key'),
  publishState: publishState('publish_state').notNull().default('draft'),
  resultsPublished: boolean('results_published').notNull().default(false),
  createdBy: text('created_by').notNull().default(''),
  ...timestamps,
}, (t) => [check('entry_prefix_format', sql`entry_code_prefix ~ '^[A-Z]{2,4}$'`), index('competitions_state_idx').on(t.publishState)]);

export const competitionGroups = pgTable('competition_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  competitionId: uuid('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** A, B, C… used in entry codes. */
  letter: text('letter').notNull(),
  classMin: smallint('class_min').notNull(),
  classMax: smallint('class_max').notNull(),
  formatNote: text('format_note').notNull().default(''),
  minWords: integer('min_words'),
  maxWords: integer('max_words'),
  maxMainFiles: smallint('max_main_files'),
  /** Next number for this group's entry codes (taken atomically). */
  nextEntryNo: integer('next_entry_no').notNull().default(1),
  sortOrder: smallint('sort_order').notNull().default(0),
}, (t) => [uniqueIndex('group_letter_idx').on(t.competitionId, t.letter), check('group_class_range', sql`class_min BETWEEN 3 AND 12 AND class_max BETWEEN class_min AND 12`)]);

export const competitionFormFields = pgTable('competition_form_fields', {
  id: uuid('id').primaryKey().defaultRandom(),
  competitionId: uuid('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  label: text('label').notNull(),
  type: formFieldType('type').notNull(),
  options: text('options').array().notNull().default(sql`'{}'::text[]`),
  required: boolean('required').notNull().default(false),
  helpText: text('help_text').notNull().default(''),
  sortOrder: smallint('sort_order').notNull().default(0),
}, (t) => [uniqueIndex('form_field_key_idx').on(t.competitionId, t.key)]);

export const competitionResources = pgTable('competition_resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  competitionId: uuid('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  /** Public files are in competition-media; registered-only ones in the private competition-files. */
  fileKey: text('file_key').notNull(),
  fileName: text('file_name').notNull().default(''),
  visibility: resourceVisibility('visibility').notNull().default('registered_only'),
  sortOrder: smallint('sort_order').notNull().default(0),
});

export const resourceDownloads = pgTable('resource_downloads', {
  id: uuid('id').primaryKey().defaultRandom(),
  resourceId: uuid('resource_id').notNull().references(() => competitionResources.id, { onDelete: 'cascade' }),
  registrationId: uuid('registration_id'),
  userId: uuid('user_id'),
  downloadedAt: timestamp('downloaded_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('resource_downloads_idx').on(t.resourceId)]);

export const prizes = pgTable('prizes', {
  id: uuid('id').primaryKey().defaultRandom(),
  competitionId: uuid('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  /** Null: every group. */
  groupId: uuid('group_id'),
  /** Null: a special award. */
  rankFrom: smallint('rank_from'),
  rankTo: smallint('rank_to'),
  awardName: text('award_name').notNull(),
  description: text('description').notNull().default(''),
  prizeType: prizeType('prize_type').notNull().default('certificate'),
  sortOrder: smallint('sort_order').notNull().default(0),
});

export interface EmailBlocks { showDetails: boolean; showPrizes: boolean; showRules: boolean; showResources: boolean; showReferral: boolean; showUpsell: boolean }

export const competitionEmailTemplates = pgTable('competition_email_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  competitionId: uuid('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  templateType: compEmailType('template_type').notNull(),
  audience: emailAudience('audience').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  subject: text('subject').notNull(),
  preheader: text('preheader').notNull().default(''),
  /** In competition-media; empty = the competition's 16:9 banner. */
  bannerImageKey: text('banner_image_key'),
  bannerAlt: text('banner_alt').notNull().default(''),
  heading: text('heading').notNull(),
  bodyContent: text('body_content').notNull(),
  primaryCtaLabel: text('primary_cta_label').notNull().default(''),
  primaryCtaUrl: text('primary_cta_url').notNull().default(''),
  secondaryCtaLabel: text('secondary_cta_label').notNull().default(''),
  secondaryCtaUrl: text('secondary_cta_url').notNull().default(''),
  blocks: jsonb('blocks').$type<EmailBlocks>().notNull(),
  /** In competition-files (private); at most 2 files, 5 MB together. */
  attachmentKeys: text('attachment_keys').array().notNull().default(sql`'{}'::text[]`),
  updatedBy: text('updated_by').notNull().default(''),
  updatedAt: timestamps.updatedAt,
}, (t) => [uniqueIndex('comp_email_idx').on(t.competitionId, t.templateType, t.audience)]);

export const registrations = pgTable('registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  competitionId: uuid('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').notNull().references(() => competitionGroups.id),
  studentProfileId: uuid('student_profile_id').notNull().references(() => studentProfiles.id),
  registeredByUserId: uuid('registered_by_user_id').notNull(),
  registeredByType: accountType('registered_by_type').notNull(),
  /** Class when they registered (the profile's class can change later). */
  classAtRegistration: smallint('class_at_registration').notNull(),
  status: registrationStatus('status').notNull().default('registered'),
  disqualifyReason: text('disqualify_reason').notNull().default(''),
  customAnswers: jsonb('custom_answers').$type<Record<string, unknown>>().notNull().default({}),
  howHeard: text('how_heard').notNull().default(''),
  utmSource: text('utm_source').notNull().default(''),
  utmMedium: text('utm_medium').notNull().default(''),
  utmCampaign: text('utm_campaign').notNull().default(''),
  utmContent: text('utm_content').notNull().default(''),
  utmTerm: text('utm_term').notNull().default(''),
  referralCode: text('referral_code').notNull().unique(),
  referredByCode: text('referred_by_code').notNull().default(''),
  createdAt: timestamps.createdAt,
}, (t) => [
  uniqueIndex('registration_once_idx').on(t.competitionId, t.studentProfileId),
  index('registration_comp_idx').on(t.competitionId, t.createdAt),
  index('registration_student_idx').on(t.studentProfileId),
]);

export const submissions = pgTable('submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  registrationId: uuid('registration_id').notNull().references(() => registrations.id, { onDelete: 'cascade' }),
  entryCode: text('entry_code').notNull().unique(),
  title: text('title').notNull().default(''),
  language: text('language').notNull().default(''),
  textContent: text('text_content').notNull().default(''),
  linkUrl: text('link_url').notNull().default(''),
  status: submissionStatus('status').notNull().default('draft'),
  submittedByUserId: uuid('submitted_by_user_id'),
  lastEditedByUserId: uuid('last_edited_by_user_id'),
  declarationAcceptedAt: timestamp('declaration_accepted_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  /** suspected_ai, possibly_copied, content_issue */
  adminFlags: text('admin_flags').array().notNull().default(sql`'{}'::text[]`),
  adminNotes: text('admin_notes').notNull().default(''),
  hiddenFromPublic: boolean('hidden_from_public').notNull().default(false),
  ...timestamps,
}, (t) => [index('submission_registration_idx').on(t.registrationId)]);

export const submissionFiles = pgTable('submission_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id, { onDelete: 'cascade' }),
  kind: fileKind('kind').notNull(),
  extraKey: text('extra_key'),
  /** In the private competition-entries bucket, under a random key. */
  storageKey: text('storage_key').notNull(),
  thumbnailKey: text('thumbnail_key'),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  originalName: text('original_name').notNull().default(''),
  /** Set once the server has checked the file's type and removed photo metadata (location). */
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  sortOrder: smallint('sort_order').notNull().default(0),
  uploadedByUserId: uuid('uploaded_by_user_id').notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('submission_files_idx').on(t.submissionId)]);

export const notificationLog = pgTable('notification_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  toAddress: text('to_address').notNull(),
  studentProfileId: uuid('student_profile_id'),
  registrationId: uuid('registration_id'),
  template: text('template').notNull(),
  channel: notifyChannel('channel').notNull().default('email'),
  status: notifyStatus('status').notNull().default('queued'),
  attempts: smallint('attempts').notNull().default(0),
  /** What's needed to build the email again for a retry (ids, never the HTML). */
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  error: text('error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamps.createdAt,
}, (t) => [index('notification_retry_idx').on(t.status, t.createdAt), index('notification_registration_idx').on(t.registrationId)]);

/* ---------------- Popups (Admin → Popups) ---------------- */

/** A popup built in the admin (src/shared/popups.ts describes each part). */
export const popups = pgTable('popups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** 'draft' | 'live' | 'paused'. Only live ones reach the website. */
  status: text('status').notNull().default('draft'),
  /** When several could open on a page, the highest goes first. */
  priority: integer('priority').notNull().default(0),
  content: jsonb('content').$type<PopupContent>().notNull(),
  design: jsonb('design').$type<PopupDesign>().notNull(),
  trigger: jsonb('trigger').$type<PopupTrigger>().notNull(),
  audience: jsonb('audience').$type<PopupAudience>().notNull(),
  frequency: jsonb('frequency').$type<PopupFrequency>().notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  createdBy: text('created_by').notNull().default(''),
  ...timestamps,
}, (t) => [index('popups_status_idx').on(t.status)]);

/** Counts per popup per day (India time): shown, button clicked, closed, signed up. */
export const popupStats = pgTable('popup_stats', {
  popupId: uuid('popup_id').notNull().references(() => popups.id, { onDelete: 'cascade' }),
  day: date('day', { mode: 'string' }).notNull(),
  views: integer('views').notNull().default(0),
  clicks: integer('clicks').notNull().default(0),
  closes: integer('closes').notNull().default(0),
  conversions: integer('conversions').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.popupId, t.day] })]);

/* ---------------- Calls (AI voice agents: cart recovery and order feedback) ---------------- */

/**
 * A checkout someone started and left: saved as soon as they type a phone number and tick
 * "you may call or WhatsApp me about this order". order_id is set once they pay.
 */
export const checkoutLeads = pgTable('checkout_leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** The browser's id for this checkout, so typing again updates the same lead. */
  clientKey: text('client_key').notNull().unique(),
  /** Secret part of the "finish your order" link. */
  resumeToken: text('resume_token').notNull().unique(),
  name: text('name').notNull().default(''),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull(),
  /** [{ productId, kind, quantity, title }] */
  items: jsonb('items').$type<{ productId: string; kind: string; quantity: number; title: string }[]>().notNull(),
  total: integer('total').notNull().default(0),
  consent: boolean('consent').notNull().default(false),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('checkout_leads_phone_idx').on(t.phone), index('checkout_leads_updated_idx').on(t.updatedAt)]);

/** One call (and its retries) by a voice agent. */
export const calls = pgTable('calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').$type<CallKind>().notNull(),
  status: text('status').$type<CallStatus>().notNull().default('queued'),
  phone: text('phone').notNull(),
  name: text('name').notNull().default(''),
  leadId: uuid('lead_id').references(() => checkoutLeads.id, { onDelete: 'set null' }),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  /** What the agent is told at the start of the call (customer_name, cart_items, ...). */
  variables: jsonb('variables').$type<Record<string, string>>().notNull().default({}),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  providerCallId: text('provider_call_id'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  durationSeconds: integer('duration_seconds'),
  /** call_outcome as the agent recorded it (will_order, callback, feedback_given, ...). */
  outcome: text('outcome').notNull().default(''),
  /** Everything the agent recorded after the call (rating, objection, issue_detail, ...). */
  result: jsonb('result').$type<Record<string, unknown>>().notNull().default({}),
  transcript: text('transcript').notNull().default(''),
  recordingUrl: text('recording_url').notNull().default(''),
  /** Why it was skipped or failed, in words. */
  note: text('note').notNull().default(''),
  /** An issue the customer reported (feedback calls): open until someone marks it handled. */
  issueOpen: boolean('issue_open').notNull().default(false),
  createdBy: text('created_by').notNull().default('system'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('calls_status_due_idx').on(t.status, t.dueAt),
  index('calls_phone_idx').on(t.phone),
  index('calls_created_idx').on(t.createdAt),
  uniqueIndex('calls_order_kind_uq').on(t.orderId, t.kind),
  uniqueIndex('calls_lead_kind_uq').on(t.leadId, t.kind),
]);

/** Numbers never to call. */
export const doNotCall = pgTable('do_not_call', {
  phone: text('phone').primaryKey(),
  reason: text('reason').notNull().default(''),
  /** 'customer' (asked on a call), 'admin' (added by hand). */
  source: text('source').notNull().default('admin'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The calls settings (Admin → Calls → Settings): one row. */
export const callSettings = pgTable('call_settings', {
  id: integer('id').primaryKey().default(1),
  data: jsonb('data').$type<Partial<CallSettings>>().notNull().default({}),
  updatedBy: text('updated_by').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ---------------- WhatsApp (Meta Cloud API) ---------------- */

/** Every WhatsApp message, ours and the customers': the log and the inbox. */
export const whatsappMessages = pgTable('whatsapp_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** +919876543210 */
  phone: text('phone').notNull(),
  /** Their WhatsApp profile name (incoming) or our customer's name. */
  name: text('name').notNull().default(''),
  direction: text('direction').$type<'in' | 'out'>().notNull(),
  kind: text('kind').$type<WaKind>().notNull(),
  status: text('status').$type<WaStatus>().notNull(),
  /** Template name (ours) and its variables. */
  template: text('template').notNull().default(''),
  params: jsonb('params').$type<string[]>().notNull().default([]),
  /** The text: what they wrote, our reply, or the template filled in (for the inbox). */
  body: text('body').notNull().default(''),
  /** WhatsApp's message id (wamid…), for status updates and to ignore repeats. */
  waId: text('wa_id').unique(),
  error: text('error').notNull().default(''),
  leadId: uuid('lead_id').references(() => checkoutLeads.id, { onDelete: 'set null' }),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  /** New-books sends: one id per send, so nobody gets the same one twice. */
  broadcastId: text('broadcast_id'),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  /** Incoming: when someone in the team opened it. */
  seenAt: timestamp('seen_at', { withTimezone: true }),
  createdBy: text('created_by').notNull().default('system'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('wa_phone_created_idx').on(t.phone, t.createdAt),
  index('wa_status_due_idx').on(t.status, t.dueAt),
  uniqueIndex('wa_order_kind_uq').on(t.orderId, t.kind),
  uniqueIndex('wa_lead_kind_uq').on(t.leadId, t.kind),
  uniqueIndex('wa_broadcast_phone_uq').on(t.broadcastId, t.phone),
]);

/** Numbers that replied STOP: no more WhatsApp messages from us (until they send START). */
export const whatsappOptOuts = pgTable('whatsapp_opt_outs', {
  phone: text('phone').primaryKey(),
  reason: text('reason').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Admin → WhatsApp → Settings: one row. */
export const whatsappSettings = pgTable('whatsapp_settings', {
  id: integer('id').primaryKey().default(1),
  data: jsonb('data').$type<Partial<WhatsAppSettings>>().notNull().default({}),
  updatedBy: text('updated_by').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ---------------- Competition analytics ---------------- */

/** How many browsers reached each step of a competition's registration, per day and channel (no personal data). */
export const competitionStats = pgTable('competition_stats', {
  competitionSlug: text('competition_slug').notNull(),
  /** India date. */
  day: date('day', { mode: 'string' }).notNull(),
  /** view | signin | start | members | review (src/shared/competitionFunnel.ts) */
  step: text('step').notNull(),
  /** The visit's channel (meta_ads, search, direct…). */
  channel: text('channel').notNull(),
  n: integer('n').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.competitionSlug, t.day, t.step, t.channel] })]);

/* ---------------- Cookie-banner analytics ---------------- */

/** How many visitors saw the cookie banner and what they chose: counters only, nothing that identifies anyone. */
export const consentStats = pgTable('consent_stats', {
  /** India date. */
  day: date('day', { mode: 'string' }).notNull(),
  /** shown | accept | essential | change_all | change_essential */
  event: text('event').notNull(),
  /** mobile | tablet | desktop */
  device: text('device').notNull(),
  /** Approximate, from the IP address at the time (not stored): an Indian state, or a country code. '' = unknown. */
  region: text('region').notNull(),
  /** The visit's channel (meta_ads, search, direct…). */
  channel: text('channel').notNull(),
  /** The kind of page (home, book, checkout…). */
  page: text('page').notNull(),
  /** How long they took to choose (lt5, lt15…); '' for "shown". */
  timing: text('timing').notNull(),
  n: integer('n').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.day, t.event, t.device, t.region, t.channel, t.page, t.timing] })]);

/* ---------------- Claude connector (MCP over OAuth) ---------------- */

/** Apps that registered themselves to connect to the store (OAuth dynamic client registration), e.g. Claude. */
export const mcpClients = pgTable('mcp_clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  /** Where the sign-in may send its one-time code: only Claude's own addresses and this computer (server/routes/mcp/oauth.ts). */
  redirectUris: text('redirect_uris').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A one-time code from the approval screen, swapped for tokens within minutes (only its hash is kept). */
export const mcpAuthCodes = pgTable('mcp_auth_codes', {
  codeHash: text('code_hash').primaryKey(),
  clientId: text('client_id').notNull().references(() => mcpClients.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => adminUsers.userId, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  /** PKCE: base64url(sha256(code_verifier)). */
  codeChallenge: text('code_challenge').notNull(),
  scope: text('scope').notNull().default(''),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A connection a team member approved (Admin → Settings → Claude): it acts with that person's role.
 * Only hashes of its tokens are kept; the refresh token changes each time it is used.
 */
export const mcpGrants = pgTable('mcp_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: text('client_id').notNull().references(() => mcpClients.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => adminUsers.userId, { onDelete: 'cascade' }),
  scope: text('scope').notNull().default(''),
  accessHash: text('access_hash').notNull().unique(),
  accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
  refreshHash: text('refresh_hash').notNull().unique(),
  refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
  /** The refresh token before the last swap, still accepted for a minute in case the reply to that swap was lost. */
  prevRefreshHash: text('prev_refresh_hash'),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('mcp_grants_user_idx').on(t.userId), index('mcp_grants_prev_refresh_idx').on(t.prevRefreshHash)]);
