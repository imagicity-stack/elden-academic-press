import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminUsers, auditLog, competitionEmailTemplates } from '../server/db/schema.js';
import { setup, supabaseToken } from './helpers.js';
import { createCompetition, ist } from './competitionHelpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup(); });

const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const MANAGER = { sub: '22222222-2222-4222-8222-222222222222', email: 'manager@eldenap.in' };
const as = async (u: { sub: string; email: string }) => ({ Authorization: `Bearer ${await supabaseToken(u)}` });

describe('competitions admin', () => {
  it('is for the store owner only', async () => {
    await t.db.insert(adminUsers).values({ userId: MANAGER.sub, email: MANAGER.email, role: 'manager' });
    expect((await t.call('GET', '/admin/competitions', { headers: await as(MANAGER) })).status).toBe(403);
    expect((await t.call('GET', '/admin/competitions', { headers: await as(OWNER) })).status).toBe(200);
  });

  it('creates a draft with a group, the “how did you hear” question and the default emails', async () => {
    const h = await as(OWNER);
    const r = await t.call('POST', '/admin/competitions', { headers: h, body: { title: 'Story Sprint', type: 'story' } });
    expect(r.json.competition).toMatchObject({ slug: 'story-sprint', entryCodePrefix: 'SS', publishState: 'draft', status: 'DRAFT' });
    expect(r.json.groups).toHaveLength(1);
    expect(r.json.fields.map((f: any) => f.key)).toEqual(['how_heard']);
    expect((await t.db.select().from(competitionEmailTemplates).where(eq(competitionEmailTemplates.competitionId, r.json.competition.id))).length).toBe(4);
    expect((await t.db.select().from(auditLog).where(eq(auditLog.action, 'competition.create'))).length).toBe(1);
  });

  it('saves every tab, refuses overlapping groups and dates out of order, and checks before publishing', async () => {
    const { id, h, save } = await createCompetition(t);
    const ok = await t.call('PUT', `/admin/competitions/${id}`, { headers: h, body: save });
    expect(ok.status).toBe(200);
    expect(ok.json.groups.map((g: any) => `${g.letter}:${g.classMin}-${g.classMax}`)).toEqual(['A:3-5', 'B:6-8']);
    expect(ok.json.prizes[0]).toMatchObject({ groupLetter: 'A', awardName: 'First prize' });

    const overlap = await t.call('PUT', `/admin/competitions/${id}`, { headers: h, body: { ...save, groups: [...save.groups.slice(0, 1), { ...save.groups[1], classMin: 5 }] } });
    expect(overlap.status).toBe(400);
    expect(overlap.json.details.problems[0]).toMatch(/share a class/);
    const backwards = await t.call('PUT', `/admin/competitions/${id}`, { headers: h, body: { ...save, competition: { ...save.competition, registrationClosesAt: ist('2026-11-01T00:00:00') } } });
    expect(backwards.json.details.problems).toContain('Registration must open before it closes.');

    const empty = await t.call('POST', `/admin/competitions/${id}/publish`, { headers: h, body: { ...save, groups: [], competition: { ...save.competition, registrationOpensAt: null } } });
    expect(empty.status).toBe(400);
    expect(empty.json.details.problems).toEqual(expect.arrayContaining(['Add at least one group (which classes can enter).', 'Set when registration opens and closes.']));
    const pub = await t.call('POST', `/admin/competitions/${id}/publish`, { headers: h, body: save });
    expect(pub.json.competition.publishState).toBe('published');
  });

  it('duplicates everything but the dates, as a draft', async () => {
    const { id, h, save } = await createCompetition(t);
    await t.call('PUT', `/admin/competitions/${id}`, { headers: h, body: save });
    const copy = await t.call('POST', `/admin/competitions/${id}/duplicate`, { headers: h });
    expect(copy.status).toBe(201);
    expect(copy.json.competition).toMatchObject({ title: 'Elden Comic Challenge 2026 (copy)', publishState: 'draft', registrationOpensAt: null, prompt: 'A hero from your town' });
    expect(copy.json.competition.slug).not.toBe(save.competition.slug);
    expect(copy.json.groups).toHaveLength(2);
    expect(copy.json.prizes[0].groupLetter).toBe('A');
    expect(copy.json.templates).toHaveLength(4);
  });
});
