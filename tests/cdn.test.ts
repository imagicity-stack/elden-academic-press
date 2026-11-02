import { afterEach, describe, expect, it } from 'vitest';
import { setup, supabaseToken } from './helpers.js';

// Vercel hands each request a context object; its cache helpers must never break a response.
const CTX = Symbol.for('@vercel/request-context');
const g = globalThis as Record<symbol, unknown>;
const runtime = (ctx: Record<string, unknown>) => { g[CTX] = { get: () => ctx }; };
afterEach(() => { delete g[CTX]; });

const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };

describe('Vercel cache tags', () => {
  it.each([
    ['returns nothing', () => undefined],
    ['throws', () => { throw new Error('cache tags unavailable'); }],
    ['rejects', () => Promise.reject(new Error('cache tags unavailable'))],
    ['never settles', () => new Promise(() => {})],
  ])('the store still loads when tagging %s', async (_name, addCacheTag) => {
    const t = await setup();
    runtime({ addCacheTag, waitUntil: () => {} });
    for (const path of ['/catalog', '/config', '/resources']) expect((await t.call('GET', path)).status, path).toBe(200);
  });

  it('saving a product clears the cached store, and a failing purge doesn’t fail the save', async () => {
    const t = await setup();
    const purged: unknown[] = [];
    runtime({ purge: { dangerouslyDeleteByTag: (tag: unknown) => { purged.push(tag); throw new Error('purge failed'); } }, waitUntil: () => {} });
    const h = { Authorization: `Bearer ${await supabaseToken(OWNER)}` };
    const r = await t.call('POST', '/admin/categories', { headers: h, body: { name: 'Atlases' } });
    expect(r.status).toBe(201);
    expect(purged).toEqual(['catalog']);
  });
});
