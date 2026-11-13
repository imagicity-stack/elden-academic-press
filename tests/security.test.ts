import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bare, cspLines } from '../server/routes/cspReport.js';
import { pageOrigin } from '../server/routes/og.js';
import { safeHref } from '../src/shared/links.js';
import { setup } from './helpers.js';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const header = (k: string) => vercel.headers[0].headers.find((h: { key: string }) => h.key === k)?.value as string | undefined;

describe('security headers (vercel.json)', () => {
  it('enforces the Content Security Policy, with the basics', () => {
    const csp = header('Content-Security-Policy')!;
    expect(header('Content-Security-Policy-Report-Only')).toBeUndefined();
    for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", 'report-uri /api/csp-report']) expect(csp).toContain(d);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
    expect(header('Strict-Transport-Security')).toMatch(/max-age=\d{8}/);
    expect(header('X-Frame-Options')).toBe('DENY');
  });

  it('allows every inline script in index.html by its hash (change the script → update the hash)', () => {
    const html = readFileSync('index.html', 'utf8');
    const csp = header('Content-Security-Policy')!;
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/application\/ld\+json/.test(m[1]));
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, , body] of scripts) expect(csp).toContain(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  });

  it("lets the Meta Pixel reach this pixel's Conversions API Gateway hosts, by exact name only", () => {
    // The Pixel (connect.facebook.net) also posts each event to these Meta-run gateway hosts. Exact
    // names, never *.run.app or *.on.aws: those would let any app on Google Cloud or AWS receive data.
    const connect = header('Content-Security-Policy')!.match(/connect-src([^;]*)/)![1].split(/\s+/);
    expect(connect).toContain('https://mpc2-prod-23-is5qnl632q-ue.a.run.app');
    expect(connect).toContain('https://e5-cce25cf3b4a5476fbb3aaa2312efbe1a.ecs.us-east-2.on.aws');
    expect(connect.filter((s) => /\*\.(a\.)?run\.app|\*\.([\w-]+\.)*on\.aws/.test(s))).toEqual([]);
  });
});

describe('CSP reports', () => {
  it('logs the blocked address and page without query strings (order links carry tokens)', () => {
    const old = JSON.stringify({ 'csp-report': { 'document-uri': 'https://eldenap.in/orders/abc?t=SECRET', 'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js?k=1' } });
    expect(cspLines(old)).toEqual(['[csp] blocked script-src-elem https://evil.example/x.js on https://eldenap.in/orders/abc']);
    const api = JSON.stringify([{ type: 'csp-violation', body: { documentURL: 'https://eldenap.in/?a=b', effectiveDirective: 'img-src', blockedURL: 'inline' } }, { type: 'deprecation', body: {} }]);
    expect(cspLines(api)).toEqual(['[csp] blocked img-src inline on https://eldenap.in/']);
    expect(cspLines('not json')).toEqual([]);
    expect(bare('data:image/png;base64,xxx')).toBe('data:');
  });

  it('are accepted at /api/csp-report without signing in', async () => {
    const t = await setup({ seed: false });
    const r = await t.call('POST', '/csp-report', { raw: JSON.stringify({ 'csp-report': { 'blocked-uri': 'inline', 'effective-directive': 'script-src-elem', 'document-uri': 'https://eldenap.in/' } }), headers: { 'Content-Type': 'application/csp-report' } });
    expect(r.status).toBe(204);
  });
});

describe('link previews', () => {
  it('fetch the page only from this site, never from an address in the request', () => {
    const env = { VERCEL: '1', VERCEL_URL: 'elden-abc123.vercel.app' };
    expect(pageOrigin('https://eldenap.in', 'https://www.eldenap.in', env)).toBe('https://www.eldenap.in');
    expect(pageOrigin('https://eldenap.in', 'https://elden-abc123.vercel.app', env)).toBe('https://elden-abc123.vercel.app');
    expect(pageOrigin('https://eldenap.in', 'https://attacker.example', env)).toBe('https://eldenap.in');
    expect(pageOrigin('https://eldenap.in', 'http://localhost:5173', {})).toBe('http://localhost:5173');
  });
});

describe('formatted text', () => {
  it('links only to https, mailto or a path on this site (not //other-site)', () => {
    for (const ok of ['https://eldenap.in/x', '/rules', '/competitions/doomsday-diaries#team', 'mailto:hello@eldenap.in']) expect(safeHref(ok)).toBe(ok);
    for (const bad of ['//evil.example', '/\\evil.example', 'javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'http:evil', 'evil.example']) expect(safeHref(bad)).toBeNull();
  });
});
