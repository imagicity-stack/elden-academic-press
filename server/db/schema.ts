// Store database schema (Postgres / Supabase). All money is integer paise.
import { sql } from 'drizzle-orm';
import {
  boolean, check, index, integer, jsonb, pgEnum, pgSequence, pgTable, serial, smallint, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

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
  hasCompanion: boolean('has_companion').notNull().default(false),
  isNew: boolean('is_new').notNull().default(false),
  featured: boolean('featured').notNull().default(false),
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
  filePath: text('file_path'),
  fileName: text('file_name'),
  fileSize: integer('file_size'),
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
