import { expect } from 'vitest';
import type { setup } from './helpers.js';
import { supabaseToken } from './helpers.js';

type T = Awaited<ReturnType<typeof setup>>;
export const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const as = async (u: { sub: string; email: string }) => ({ Authorization: `Bearer ${await supabaseToken(u)}` });
export const ist = (s: string) => new Date(`${s}+05:30`).toISOString();

/** A competition with two groups (A: classes 3–5, B: 6–8), a resource and a prize; not saved yet. */
export async function createCompetition(tt: T, overrides: Record<string, unknown> = {}) {
  const h = await as(OWNER);
  const created = await tt.call('POST', '/admin/competitions', { headers: h, body: { title: 'Elden Comic Challenge 2026', type: 'comic' } });
  expect(created.status).toBe(201);
  const d = created.json;
  const { id: _id, publishState: _p, resultsPublished: _r, status: _s, createdAt: _c, updatedAt: _u, createdBy: _b, ...competition } = d.competition;
  const save = {
    competition: {
      ...competition,
      prompt: 'A hero from your town', tagline: 'Draw a comic, win books',
      announceAt: ist('2026-11-10T00:00:00'), registrationOpensAt: ist('2026-11-14T00:00:00'), registrationClosesAt: ist('2026-12-08T23:59:59.999'),
      submissionOpensAt: ist('2026-11-14T00:00:00'), submissionClosesAt: ist('2026-12-08T23:59:59.999'),
      judgingStartsAt: ist('2026-12-10T00:00:00'), resultsAt: ist('2026-12-20T10:00:00'),
      ...overrides,
    },
    groups: [
      { id: d.groups[0].id, name: 'Group A', letter: 'A', classMin: 3, classMax: 5, formatNote: '4 panels, 1 A4 page' },
      { name: 'Group B', letter: 'B', classMin: 6, classMax: 8, formatNote: '6 to 8 panels' },
    ],
    fields: d.fields,
    resources: [{ title: 'Starter kit', description: 'Panels template', fileKey: '2026/kit.pdf', fileName: 'kit.pdf', visibility: 'registered_only' }],
    prizes: [{ groupLetter: 'A', rankFrom: 1, rankTo: null, awardName: 'First prize', description: 'Books worth ₹2,000', prizeType: 'voucher' }],
  };
  return { id: d.competition.id as string, h, save };
}

