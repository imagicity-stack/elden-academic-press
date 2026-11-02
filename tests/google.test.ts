import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { products, productVariants } from '../server/db/schema.js';
import { isbn13 } from '../server/routes/feeds.js';
import { setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup({ env: { SITE_URL: 'https://eldenap.in' } }); });

const feed = async () => {
  const res = await t.app.request('/feeds/products.xml');
  return { res, xml: await res.text() };
};

describe('ISBN as GTIN', () => {
  it('accepts valid ISBN-13 and converts ISBN-10, rejects the rest', () => {
    expect(isbn13('978-0-306-40615-7')).toBe('9780306406157');
    expect(isbn13('0-306-40615-2')).toBe('9780306406157');
    expect(isbn13('080442957X')).toBe('9780804429573');
    expect(isbn13('978-0-306-40615-8')).toBeNull();
    expect(isbn13('12345')).toBeNull();
  });
});

describe('/feeds/products.xml', () => {
  it('lists printed books that have a cover, in Merchant Center format', async () => {
    const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    await t.db.update(products).set({ coverPath: 'math.jpg', isbn: '978-0-306-40615-7', images: [{ path: 'inside.jpg', alt: '' }, { path: 'back.jpg', alt: 'Back cover' }] }).where(eq(products.id, p.id));
    const { res, xml } = await feed();
    expect(res.headers.get('content-type')).toContain('application/xml');
    expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
    const item = xml.split('<item>').find((x) => x.includes(`<g:id>${p.id}</g:id>`))!;
    expect(item).toBeTruthy();
    expect(item).toContain('<g:link>https://eldenap.in/books/mathematics-today</g:link>');
    expect(item).toContain('<g:image_link>https://files.test/public/covers/math.jpg</g:image_link>');
    expect(item).toContain('<g:additional_image_link>https://files.test/public/covers/inside.jpg</g:additional_image_link>\n      <g:additional_image_link>https://files.test/public/covers/back.jpg</g:additional_image_link>');
    expect(item).toMatch(/<g:price>\d+\.\d\d INR<\/g:price>/);
    expect(item).toContain('<g:availability>in_stock</g:availability>');
    expect(item).toContain('<g:gtin>9780306406157</g:gtin>');
    expect(item).toContain('<g:google_product_category>543543</g:google_product_category>');
    expect(item).toContain('<g:brand>Elden Academic Press</g:brand>');
    expect(item).toContain('(Printed book)');
    // Books without a cover image are left out (Google needs an image).
    expect((xml.match(/<item>/g) ?? []).length).toBe(1);
  });

  it('marks sold-out books and sale prices', async () => {
    const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    await t.db.update(products).set({ coverPath: 'math.jpg', isbn: '' }).where(eq(products.id, p.id));
    const [v] = await t.db.select().from(productVariants).where(eq(productVariants.productId, p.id)).then((r) => r.filter((x) => x.kind === 'print'));
    await t.db.update(productVariants).set({ stock: 0, trackStock: true, compareAtPrice: v.price + 5000 }).where(eq(productVariants.id, v.id));
    const { xml } = await feed();
    expect(xml).toContain('<g:availability>out_of_stock</g:availability>');
    expect(xml).toContain(`<g:price>${((v.price + 5000) / 100).toFixed(2)} INR</g:price>`);
    expect(xml).toContain(`<g:sale_price>${(v.price / 100).toFixed(2)} INR</g:sale_price>`);
    expect(xml).toContain('<g:identifier_exists>no</g:identifier_exists>');
  });
});
