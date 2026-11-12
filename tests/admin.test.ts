import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminUsers, auditLog, productVariants, products } from '../server/db/schema.js';
import { address, contact, setup, supabaseToken } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof setup>>;
let t: Ctx;
const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const STAFF = { sub: '22222222-2222-4222-8222-222222222222', email: 'packer@eldenap.in' };

async function as(who: { sub: string; email: string; aal?: string }) {
  return { Authorization: `Bearer ${await supabaseToken(who)}` };
}
async function paidOrder(kind: 'print' | 'bundle' = 'print', quantity = 1) {
  const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
  const r = await t.call('POST', '/checkout', { body: { items: [{ productId: p.id, kind, quantity }], contact, shipping: address } });
  const payload = t.razorpay.simulatePayment(r.json.razorpay.orderId);
  await t.call('POST', '/checkout/verify', { body: payload });
  return { id: r.json.orderId as string, number: r.json.number as number, productId: p.id, total: r.json.total as number };
}

beforeEach(async () => {
  t = await setup();
});

describe('admin sign-in', () => {
  it('requires a valid Supabase session', async () => {
    expect((await t.call('GET', '/admin/dashboard')).status).toBe(401);
    expect((await t.call('GET', '/admin/dashboard', { headers: { Authorization: 'Bearer junk' } })).status).toBe(401);
    const forged = await supabaseToken(OWNER, 'some-other-secret-that-is-long-enough-xx');
    expect((await t.call('GET', '/admin/dashboard', { headers: { Authorization: `Bearer ${forged}` } })).status).toBe(401);
  });

  it('makes the configured owner the first admin, and nobody else', async () => {
    const stranger = await t.call('GET', '/admin/me', { headers: await as({ sub: STAFF.sub, email: 'random@gmail.com' }) });
    expect(stranger.status).toBe(403);
    expect(stranger.json.code).toBe('not_admin');
    const me = await t.call('GET', '/admin/me', { headers: await as(OWNER) });
    expect(me.status).toBe(200);
    expect(me.json.role).toBe('owner');
  });

  it('insists on two-step verification', async () => {
    const headers = await as({ ...OWNER, aal: 'aal1' });
    const me = await t.call('GET', '/admin/me', { headers });
    expect(me.json.mfaSatisfied).toBe(false);
    const r = await t.call('GET', '/admin/dashboard', { headers });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('mfa_required');
  });

  it('ignores the developer login outside local development', async () => {
    expect((await t.call('GET', '/admin/dashboard', { headers: { Authorization: 'Bearer dev-owner' } })).status).toBe(401);
    const local = await setup({ env: { ALLOW_DEV_ADMIN: 'true' } });
    expect((await local.call('GET', '/admin/dashboard', { headers: { Authorization: 'Bearer dev-owner' } })).status).toBe(200);
    const onVercel = await setup({ env: { ALLOW_DEV_ADMIN: 'true', VERCEL: '1' } });
    expect((await onVercel.call('GET', '/admin/dashboard', { headers: { Authorization: 'Bearer dev-owner' } })).status).toBe(401);
  });

  it('limits what staff can do', async () => {
    await t.call('GET', '/admin/me', { headers: await as(OWNER) });
    await t.db.insert(adminUsers).values({ userId: STAFF.sub, email: STAFF.email, role: 'staff' });
    const staff = await as(STAFF);
    expect((await t.call('GET', '/admin/orders', { headers: staff })).status).toBe(200);
    expect((await t.call('GET', '/admin/staff', { headers: staff })).status).toBe(403);
    const o = await paidOrder();
    expect((await t.call('POST', `/admin/orders/${o.id}/refund`, { headers: staff, body: { amount: 100 } })).status).toBe(403);
    await t.db.update(adminUsers).set({ active: false }).where(eq(adminUsers.userId, STAFF.sub));
    expect((await t.call('GET', '/admin/orders', { headers: staff })).status).toBe(403);
  });
});

describe('orders', () => {
  it('lists, filters and exports orders', async () => {
    const h = await as(OWNER);
    const o = await paidOrder();
    const list = await t.call('GET', '/admin/orders', { headers: h });
    expect(list.json.total).toBe(1);
    expect(list.json.items[0]).toMatchObject({ number: o.number, status: 'Confirmed', items: 1 });
    expect((await t.call('GET', `/admin/orders?q=${o.number}`, { headers: h })).json.total).toBe(1);
    expect((await t.call('GET', '/admin/orders?q=nobody', { headers: h })).json.total).toBe(0);
    const csv = await t.call('GET', '/admin/orders/export.csv', { headers: h });
    expect(csv.headers.get('content-type')).toMatch(/text\/csv/);
    expect(csv.text).toContain(String(o.number));
  });

  it('packs and ships an order, emailing the tracking number', async () => {
    const h = await as(OWNER);
    const o = await paidOrder();
    expect((await t.call('POST', `/admin/orders/${o.id}/fulfillment`, { headers: h, body: { status: 'shipped' } })).status).toBe(400);
    await t.call('POST', `/admin/orders/${o.id}/fulfillment`, { headers: h, body: { status: 'packed' } });
    const r = await t.call('POST', `/admin/orders/${o.id}/fulfillment`, { headers: h, body: { status: 'shipped', courier: 'India Post', trackingNumber: 'EK123456789IN' } });
    expect(r.status).toBe(200);
    expect(r.json.order.fulfillmentStatus).toBe('shipped');
    const mail = t.mailer.sent.at(-1)!;
    expect(mail.subject).toBe(`Your books are on their way · order #${o.number}`);
    expect(mail.html).toContain('EK123456789IN');
    const detail = await t.call('GET', `/admin/orders/${o.id}`, { headers: h });
    expect(detail.json.events.map((e: any) => e.type)).toEqual(['created', 'paid', 'packed', 'shipped']);
    const audits = await t.db.select().from(auditLog);
    expect(audits.filter((a) => a.action === 'order.fulfillment').length).toBe(2);
  });

  it('refunds partly, then fully with restock', async () => {
    const h = await as(OWNER);
    const o = await paidOrder('print', 2);
    const stockBefore = (await t.db.select().from(productVariants).where(eq(productVariants.productId, o.productId))).find((x) => x.kind === 'print')!.stock;
    const part = await t.call('POST', `/admin/orders/${o.id}/refund`, { headers: h, body: { amount: 5000, reason: 'Damaged cover' } });
    expect(part.json.order.paymentStatus).toBe('partially_refunded');
    const tooMuch = await t.call('POST', `/admin/orders/${o.id}/refund`, { headers: h, body: { amount: o.total } });
    expect(tooMuch.status).toBe(400);
    const rest = await t.call('POST', `/admin/orders/${o.id}/refund`, { headers: h, body: { amount: o.total - 5000, reason: 'Cancelled', restock: true, cancel: true } });
    expect(rest.json.order.paymentStatus).toBe('refunded');
    expect(rest.json.order.cancelledAt).toBeTruthy();
    const stockAfter = (await t.db.select().from(productVariants).where(eq(productVariants.productId, o.productId))).find((x) => x.kind === 'print')!.stock;
    expect(stockAfter).toBe(stockBefore + 2);
    expect(t.mailer.sent.filter((m) => m.subject.startsWith('Refund')).length).toBe(2);
  });

  it('shows dashboard figures', async () => {
    const h = await as(OWNER);
    const o = await paidOrder();
    const d = await t.call('GET', '/admin/dashboard', { headers: h });
    expect(d.status).toBe(200);
    expect(d.json.today).toEqual({ revenue: o.total, orders: 1 });
    expect(d.json.toFulfil).toBe(1);
    expect(d.json.series).toHaveLength(30);
    expect(d.json.lowStock.map((x: any) => x.title)).toContain('English Grammar Practice');
  });
});

describe('products', () => {
  const draft = {
    title: 'Chemistry Lab Manual', level: 'SS', classLabel: 'Class 11', grade: 11, boards: ['CBSE'], subject: 'Chemistry', status: 'draft',
    print: { enabled: true, price: 29900, stock: 40, sku: 'CLM-P' },
    digital: { enabled: true, price: 19900 },
    bundle: { enabled: true, price: 39900 },
  };

  it('creates a product with formats, logs stock, and blocks publishing an e-book without a file', async () => {
    const h = await as(OWNER);
    const r = await t.call('POST', '/admin/products', { headers: h, body: draft });
    expect(r.status).toBe(201);
    expect(r.json.product.slug).toBe('chemistry-lab-manual');
    expect(r.json.variants.bundle.price).toBe(39900);
    expect(r.json.movements[0]).toMatchObject({ delta: 40, reason: 'edit' });

    const publish = await t.call('PUT', `/admin/products/${r.json.product.id}`, { headers: h, body: { ...draft, status: 'active' } });
    expect(publish.status).toBe(400);
    expect(publish.json.details.digital[0]).toMatch(/Upload the e-book/);

    const ok = await t.call('PUT', `/admin/products/${r.json.product.id}`, { headers: h, body: { ...draft, status: 'active', digital: { ...draft.digital, filePath: '2027/x/clm.pdf', fileName: 'clm.pdf' } } });
    expect(ok.status).toBe(200);
    const catalog = await t.call('GET', '/catalog');
    const item = catalog.json.items.find((i: any) => i.slug === 'chemistry-lab-manual');
    expect(item.formats.digital.price).toBe(19900);
    expect(item.formats.bundle).toBeUndefined(); // bundles are no longer sold
  });

  it('gives the e-book free with the printed copy, sold on its own or not', async () => {
    const h = await as(OWNER);
    const files = [{ path: '2027/x/clm.pdf', name: 'clm.pdf', title: '', size: 1000 }];
    const body = { ...draft, status: 'active', ebookWithPrint: true, digital: { ...draft.digital, enabled: false, files: [] }, bundle: { enabled: false, price: 0 } };
    const noFile = await t.call('POST', '/admin/products', { headers: h, body });
    expect(noFile.status).toBe(400);
    expect(noFile.json.details.digital[0]).toMatch(/free with the printed copy/);
    const r = await t.call('POST', '/admin/products', { headers: h, body: { ...body, digital: { ...body.digital, files } } });
    expect(r.status).toBe(201);
    expect(r.json.product.ebookWithPrint).toBe(true);
    expect(r.json.variants.digital).toMatchObject({ active: false, files, filePath: '2027/x/clm.pdf' });
    const item = (await t.call('GET', '/catalog')).json.items.find((i: any) => i.slug === 'chemistry-lab-manual');
    expect(item.formats.digital).toBeUndefined(); // not sold on its own
    expect(item.formats.print.includesEbook).toBe(true);
  });

  it('saves an e-book with several labelled files, in order', async () => {
    const h = await as(OWNER);
    const files = [
      { path: '2027/x/part-1.pdf', name: 'Part 1.pdf', title: 'Part 1', size: 1000 },
      { path: '2027/x/answers.pdf', name: 'Answers.pdf', title: 'Answer key', size: 500 },
    ];
    const r = await t.call('POST', '/admin/products', { headers: h, body: { ...draft, status: 'active', digital: { ...draft.digital, files } } });
    expect(r.status).toBe(201);
    expect(r.json.variants.digital).toMatchObject({ files, filePath: '2027/x/part-1.pdf', fileName: 'Part 1.pdf', fileSize: 1000 });
    const reordered = [files[1], files[0]];
    const u = await t.call('PUT', `/admin/products/${r.json.product.id}`, { headers: h, body: { ...draft, status: 'active', digital: { ...draft.digital, files: reordered } } });
    expect(u.json.variants.digital).toMatchObject({ files: reordered, filePath: '2027/x/answers.pdf' });
    const empty = await t.call('PUT', `/admin/products/${r.json.product.id}`, { headers: h, body: { ...draft, status: 'active', digital: { ...draft.digital, files: [] } } });
    expect(empty.status).toBe(400);
  });

  it('keeps more photos besides the cover, in order, and shows them in the store', async () => {
    const h = await as(OWNER);
    const book = { ...draft, status: 'active', digital: { enabled: false, price: 0 }, bundle: { enabled: false, price: 0 }, coverPath: '2027/c/cover.jpg' };
    const images = [
      { path: '2027/a/inside.jpg', alt: 'Inside: chapter 3' },
      { path: '2027/b/back.jpg', alt: '' },
    ];
    const r = await t.call('POST', '/admin/products', { headers: h, body: { ...book, images } });
    expect(r.status).toBe(201);
    const id = r.json.product.id;
    expect(r.json.product.coverPath).toBe('2027/c/cover.jpg'); // the cover is untouched
    expect(r.json.product.images).toEqual(images.map((i) => ({ ...i, url: `https://files.test/public/covers/${i.path}` })));

    // In the store: the cover stays the picture, the photos come separately.
    const listed = (await t.call('GET', '/catalog')).json.items.find((b: any) => b.id === id);
    expect(listed.coverUrl).toBe('https://files.test/public/covers/2027/c/cover.jpg');
    expect(listed.images).toEqual([
      { url: 'https://files.test/public/covers/2027/a/inside.jpg', alt: 'Inside: chapter 3' },
      { url: 'https://files.test/public/covers/2027/b/back.jpg', alt: '' },
    ]);

    // Reordered and one removed.
    const u = await t.call('PUT', `/admin/products/${id}`, { headers: h, body: { ...book, images: [images[1]] } });
    expect(u.json.product.images.map((i: any) => i.path)).toEqual(['2027/b/back.jpg']);
    // A save from an admin page without the photos field (opened before this update) keeps them.
    const old = await t.call('PUT', `/admin/products/${id}`, { headers: h, body: book });
    expect(old.json.product.images.map((i: any) => i.path)).toEqual(['2027/b/back.jpg']);
    // So does a spreadsheet import of the same book.
    const slug = u.json.product.slug;
    await t.call('POST', '/admin/products/import', { headers: h, body: { csv: `slug,title,print_price,status\n${slug},${draft.title},250,active\n` } });
    const [p] = await t.db.select().from(products).where(eq(products.id, id));
    expect(p.images.map((i) => i.path)).toEqual(['2027/b/back.jpg']);
  });

  it('rejects duplicate SKUs and bundles without both formats', async () => {
    const h = await as(OWNER);
    const dup = await t.call('POST', '/admin/products', { headers: h, body: { ...draft, print: { ...draft.print, sku: 'M8-P' } } });
    expect(dup.status).toBe(409);
    const bad = await t.call('POST', '/admin/products', { headers: h, body: { ...draft, digital: { enabled: false, price: 0 } } });
    expect(bad.status).toBe(400);
  });

  it('adjusts stock with a reason', async () => {
    const h = await as(OWNER);
    const inv = await t.call('GET', '/admin/inventory?low=1', { headers: h });
    const item = inv.json.items.find((i: any) => i.title === 'English Grammar Practice');
    const r = await t.call('POST', `/admin/inventory/${item.variantId}/adjust`, { headers: h, body: { delta: 50, reason: 'received', note: 'Reprint' } });
    expect(r.json.stock).toBe(53);
    const neg = await t.call('POST', `/admin/inventory/${item.variantId}/adjust`, { headers: h, body: { delta: -100, reason: 'correction' } });
    expect(neg.status).toBe(400);
  });

  it('round-trips a spreadsheet', async () => {
    const h = await as(OWNER);
    const csv = (await t.call('GET', '/admin/products/export.csv', { headers: h })).text;
    expect(csv.split('\r\n')[0]).toContain('slug,title,status');
    const newRows = 'title,category,level,class,print_price,stock,ebook_price,bundle_price\n"Hindi Reader, Book 1",Textbooks,P,Class 1,180,25,,\nBad Row,,ZZ,,,,,\n';
    const dry = await t.call('POST', '/admin/products/import', { headers: h, body: { csv: newRows, dryRun: true } });
    expect(dry.json).toMatchObject({ created: 1, updated: 0 });
    expect(dry.json.errors[0].row).toBe(3);
    const real = await t.call('POST', '/admin/products/import', { headers: h, body: { csv: newRows } });
    expect(real.json.created).toBe(1);
    const [p] = await t.db.select().from(products).where(eq(products.title, 'Hindi Reader, Book 1'));
    expect(p.status).toBe('draft');
  });

  it('signs uploads only for allowed file types', async () => {
    const h = await as(OWNER);
    const ok = await t.call('POST', '/admin/uploads', { headers: h, body: { bucket: 'ebooks', fileName: 'Maths 8.pdf', contentType: 'application/pdf', size: 2_000_000 } });
    expect(ok.status).toBe(200);
    expect(ok.json.path).toMatch(/^\d{4}\/[0-9a-f-]{36}\/maths-8\.pdf$/);
    expect(ok.json.publicUrl).toBeNull();
    expect((await t.call('POST', '/admin/uploads', { headers: h, body: { bucket: 'covers', fileName: 'x.exe', contentType: 'application/x-msdownload', size: 10 } })).status).toBe(400);
  });
});

describe('settings, coupons, staff', () => {
  it('validates and saves settings (owner only)', async () => {
    const h = await as(OWNER);
    const s = (await t.call('GET', '/admin/settings', { headers: h })).json;
    const bad = await t.call('PUT', '/admin/settings', { headers: h, body: { ...s, gstin: '27ABCDE1234F1Z5' } });
    expect(bad.status).toBe(400);
    const ok = await t.call('PUT', '/admin/settings', { headers: h, body: { ...s, gstin: '20ABCDE1234F1Z5', shippingFlat: 5000 } });
    expect(ok.json.shippingFlat).toBe(5000);
  });

  it('the cookie banner switch: one click, owner only, and the site reads it from /config', async () => {
    expect((await t.call('GET', '/config')).json.consentAuto).toBe(false);
    expect((await t.call('PUT', '/admin/settings/consent', { headers: await as(STAFF), body: { auto: true } })).status).toBe(403);
    const h = await as(OWNER);
    const on = await t.call('PUT', '/admin/settings/consent', { headers: h, body: { auto: true } });
    expect(on.json).toEqual({ consentAuto: true });
    expect((await t.call('GET', '/config')).json.consentAuto).toBe(true);
    expect((await t.call('GET', '/admin/settings', { headers: h })).json.consentAuto).toBe(true);
    // Saving the other settings leaves it alone.
    const s = (await t.call('GET', '/admin/settings', { headers: h })).json;
    await t.call('PUT', '/admin/settings', { headers: h, body: { ...s, shippingFlat: 4000 } });
    expect((await t.call('GET', '/config')).json.consentAuto).toBe(true);
    await t.call('PUT', '/admin/settings/consent', { headers: h, body: { auto: false } });
    expect((await t.call('GET', '/config')).json.consentAuto).toBe(false);
  });

  it('manages coupon codes', async () => {
    const h = await as(OWNER);
    const r = await t.call('POST', '/admin/coupons', { headers: h, body: { code: 'diwali15', type: 'percent', value: 15 } });
    expect(r.json.code).toBe('DIWALI15');
    expect((await t.call('POST', '/admin/coupons', { headers: h, body: { code: 'DIWALI15', type: 'fixed', value: 100 } })).status).toBe(409);
    expect((await t.call('POST', '/admin/coupons', { headers: h, body: { code: 'TOO-MUCH', type: 'percent', value: 120 } })).status).toBe(400);
  });

  it('invites staff and protects the owner from locking themselves out', async () => {
    const local = await setup({ env: { SUPABASE_URL: '', ALLOW_DEV_ADMIN: 'true' } });
    const dev = { Authorization: 'Bearer dev-owner' };
    const invited = await local.call('POST', '/admin/staff', { headers: dev, body: { email: 'Packer@EldenAP.in', role: 'staff' } });
    expect(invited.status).toBe(201);
    expect(invited.json).toMatchObject({ email: 'packer@eldenap.in', role: 'staff', active: true });
    expect((await local.call('POST', '/admin/staff', { headers: dev, body: { email: 'packer@eldenap.in', role: 'manager' } })).status).toBe(409);

    const h = await as(OWNER);
    await t.call('GET', '/admin/me', { headers: h });
    const self = await t.call('PUT', `/admin/staff/${OWNER.sub}`, { headers: h, body: { role: 'staff', active: false } });
    expect(self.status).toBe(400);
    const [owner] = await t.db.select().from(adminUsers).where(eq(adminUsers.userId, OWNER.sub));
    expect(owner.role).toBe('owner');
  });

  it('keeps an audit trail', async () => {
    const h = await as(OWNER);
    await t.call('POST', '/admin/coupons', { headers: h, body: { code: 'AUDITME', type: 'fixed', value: 1000 } });
    const log = await t.call('GET', '/admin/audit', { headers: h });
    expect(log.json.items[0]).toMatchObject({ actor: 'owner@eldenap.in', action: 'coupon.create', entityId: 'AUDITME' });
  });
});
