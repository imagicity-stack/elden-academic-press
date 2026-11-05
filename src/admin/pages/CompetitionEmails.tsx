// Admin → competition → Emails: the registration and entry-received emails, each in a
// Parent and a Student version. Edit on the left, live preview (desktop / phone, sample
// data) on the right, send a test to yourself, reset to default, and see what was sent.
import { useEffect, useMemo, useRef, useState } from 'react';
import { adminApi, ApiError, fmtDate, uploadFile, useAdmin } from '../api';
import { useMe } from '../AdminApp';
import { Badge, Btn, Card, Check, ErrorBox, Loading, TextArea, TextField, Toggle, useAction, useToast } from '../ui';
import {
  ATTACHMENT_LIMIT, AUDIENCE_LABEL, BANNER_MAX_BYTES, EMAIL_KINDS, EMAIL_LABEL, tagsFor, templateProblems,
  type Audience, type EmailBlocks, type EmailType, type TemplateContent,
} from '../../shared/competitionEmail';

interface Item {
  type: EmailType; audience: Audience; template: TemplateContent; updatedBy: string; updatedAt: string | null;
  bannerUrl: string | null; attachments: { key: string; name: string }[];
}
interface Data {
  items: Item[];
  competition: { title: string; bannerUrl: string | null; submissionRequired: boolean; prizes: number; rules: boolean; resources: number; upsell: number };
}
interface Draft { t: TemplateContent; bannerUrl: string | null; names: Record<string, string>; sizes: Record<string, number> }
type Field = 'subject' | 'preheader' | 'heading' | 'bodyContent' | 'primaryCtaLabel' | 'primaryCtaUrl' | 'secondaryCtaLabel' | 'secondaryCtaUrl';

const kindKey = (type: EmailType, audience: Audience) => `${type}/${audience}`;
const BLOCKS: [keyof EmailBlocks, string, string][] = [
  ['showDetails', 'Key details', 'Group, format, registration ID, deadline'],
  ['showPrizes', 'Prizes', 'From the Prizes tab'],
  ['showRules', 'Quick rules', 'The first five rules, with a link to all of them'],
  ['showResources', 'Resources list', 'From the Resources tab, with a download link'],
  ['showReferral', 'Referral link', 'Parent version only'],
  ['showUpsell', 'Book suggestion', 'Parent version only, and only if the parent allowed book news'],
];

export function CompetitionEmails({ id, dirty }: { id: string; dirty: boolean }) {
  const { data, error, reload } = useAdmin<Data>(`/competitions/${id}/emails`);
  const [kind, setKind] = useState(kindKey('registration_confirmed', 'parent'));
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const saved = useMemo(() => Object.fromEntries((data?.items ?? []).map((i) => [kindKey(i.type, i.audience), i])), [data]);

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const item = saved[kind];
  const draft = drafts[kind] ?? toDraft(item);
  const changed = (k: string) => Boolean(drafts[k] && JSON.stringify(drafts[k].t) !== JSON.stringify(saved[k].template));
  const setDraft = (d: Draft) => setDrafts((all) => ({ ...all, [kind]: d }));
  const onSaved = (t: TemplateContent, meta: { updatedBy: string; updatedAt: string }) => {
    item.template = t; item.updatedBy = meta.updatedBy; item.updatedAt = meta.updatedAt;
    setDrafts((all) => ({ ...all, [kind]: { ...draft, t } }));
  };

  return (
    <div className="ad-stack">
      <div className="ad-chips ad-ce-kinds" role="tablist" aria-label="Which email">
        {EMAIL_KINDS.map(([type, audience]) => {
          const k = kindKey(type, audience);
          const t = (drafts[k] ?? toDraft(saved[k])).t;
          return (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'is-on' : ''} onClick={() => setKind(k)}>
              {EMAIL_LABEL[type]} · {AUDIENCE_LABEL[audience].replace(' version', '')}
              {!t.enabled && ' (off)'}{changed(k) && ' •'}
            </button>
          );
        })}
      </div>
      {dirty && <div className="ad-dirty">The competition has unsaved changes. Save it to see the latest details (prizes, rules, dates) in the preview.</div>}
      <Editor key={kind} competitionId={id} item={item} draft={draft} setDraft={setDraft} changed={changed(kind)} c={data.competition} onSaved={onSaved} />
      <SendLog id={id} />
    </div>
  );
}

const toDraft = (i: Item): Draft => ({ t: i.template, bannerUrl: i.bannerUrl, names: Object.fromEntries(i.attachments.map((a) => [a.key, a.name])), sizes: {} });

function Editor({ competitionId, item, draft, setDraft, changed, c, onSaved }: {
  competitionId: string; item: Item; draft: Draft; setDraft: (d: Draft) => void; changed: boolean; c: Data['competition'];
  onSaved: (t: TemplateContent, meta: { updatedBy: string; updatedAt: string }) => void;
}) {
  const { me } = useMe();
  const toast = useToast();
  const { busy, run } = useAction();
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const { type, audience } = item;
  const t = draft.t;
  const student = audience === 'student';
  const set = (p: Partial<TemplateContent>) => { setDraft({ ...draft, t: { ...t, ...p } }); setServerProblems([]); };
  const setBlock = (k: keyof EmailBlocks, v: boolean) => set({ blocks: { ...t.blocks, [k]: v } });
  const problems = templateProblems(t, type, audience, { hasBanner: Boolean(c.bannerUrl) });
  const shown = [...new Set([...problems, ...serverProblems])];

  // The tag picker puts the tag where the cursor was, in the last field you were typing in.
  const focus = useRef<{ field: Field; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const track = (field: Field) => ({ onFocus: (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => { focus.current = { field, el: e.currentTarget }; } });
  const insert = (tag: string) => {
    const f = focus.current ?? { field: 'bodyContent' as Field, el: null as unknown as HTMLTextAreaElement };
    const value = t[f.field];
    const at = f.el?.selectionStart ?? value.length;
    const end = f.el?.selectionEnd ?? at;
    const text = `{{${tag}}}`;
    set({ [f.field]: value.slice(0, at) + text + value.slice(end) });
    requestAnimationFrame(() => { if (f.el) { f.el.focus(); f.el.setSelectionRange(at + text.length, at + text.length); } });
  };

  const failWith = (e: unknown) => {
    const list = (e instanceof ApiError && (e.details as { problems?: string[] } | undefined)?.problems) || [];
    setServerProblems(list);
    throw e;
  };
  const save = () => run('save', async () => {
    const r = await adminApi<{ template: TemplateContent; updatedBy: string; updatedAt: string }>(`/competitions/${competitionId}/emails/${type}/${audience}`, { method: 'PUT', body: { template: t } }).catch(failWith);
    onSaved(r.template, r);
  }, 'Email saved');
  const reset = () => {
    if (!window.confirm(`Reset the ${EMAIL_LABEL[type].toLowerCase()} email (${AUDIENCE_LABEL[audience].toLowerCase()}) to the default wording? The banner and attachments are removed too.`)) return;
    run('reset', async () => {
      const r = await adminApi<{ template: TemplateContent; updatedBy: string; updatedAt: string }>(`/competitions/${competitionId}/emails/${type}/${audience}/reset`, { method: 'POST' });
      onSaved(r.template, r);
      setDraft({ t: r.template, bannerUrl: null, names: {}, sizes: {} });
    }, 'Back to the default');
  };
  const test = () => run('test', async () => {
    const r = await adminApi<{ to: string }>(`/competitions/${competitionId}/emails/test`, { body: { type, audience, template: t } }).catch(failWith);
    return r.to;
  }).then((to) => { if (to) toast(`Test sent to ${to}`); });

  const uploadBanner = (f: File) => {
    if (!/^image\/(jpeg|png)$/.test(f.type)) return setServerProblems(['The banner must be a JPG or PNG (some email apps don’t show WebP).']);
    if (f.size > BANNER_MAX_BYTES) return setServerProblems([`That image is ${Math.round(f.size / 1024)} KB; keep the banner under 300 KB so the email loads fast.`]);
    run('banner', () => uploadFile('competition-media', f)).then((r) => r && setDraft({ ...draft, bannerUrl: r.publicUrl, t: { ...t, bannerImageKey: r.path, bannerAlt: t.bannerAlt || c.title } }));
  };
  const knownTotal = t.attachmentKeys.reduce((n, k) => n + (draft.sizes[k] ?? 0), 0);
  const addAttachment = (f: File) => {
    if (!/^(application\/pdf|image\/(jpeg|png))$/.test(f.type)) return setServerProblems(['Attachments can be a PDF, JPG or PNG.']);
    if (knownTotal + f.size > ATTACHMENT_LIMIT.bytes) return setServerProblems(['Attachments must stay under 5 MB together.']);
    run('attach', () => uploadFile('competition-files', f)).then((r) => r && setDraft({
      ...draft, names: { ...draft.names, [r.path]: f.name }, sizes: { ...draft.sizes, [r.path]: f.size }, t: { ...t, attachmentKeys: [...t.attachmentKeys, r.path] },
    }));
  };

  const never = type === 'submission_received' && !c.submissionRequired;
  const empty: Partial<Record<keyof EmailBlocks, boolean>> = { showPrizes: !c.prizes, showRules: !c.rules, showResources: !c.resources, showUpsell: !c.upsell };
  const fieldProps = (field: Field) => ({ value: t[field], onChange: (e: { target: { value: string } }) => set({ [field]: e.target.value }), ...track(field) });

  return (
    <div className="ad-nl-editor">
      <Card title={`${EMAIL_LABEL[type]} · ${AUDIENCE_LABEL[audience]}`} actions={item.updatedAt && <small className="ad-muted">Saved {fmtDate(item.updatedAt, true)}{item.updatedBy && ` by ${item.updatedBy}`}</small>}>
        <div className="ad-form">
          <p className="ad-muted ad-ce-who">
            {student
              ? 'Goes to students who have their own login. It never includes the referral link, book suggestions or any marketing.'
              : 'Goes to every linked parent (and is the only version when the parent registered the child).'}
          </p>
          {never && <div className="ad-dirty">This competition doesn’t take entries, so this email is never sent.</div>}
          <div className="ad-row">
            <Toggle checked={t.enabled} onChange={(v) => set({ enabled: v })} label="Send this email" />
            <strong>{t.enabled ? 'This email is sent' : 'Switched off: this email is not sent'}</strong>
          </div>

          <TextField label="Subject" maxLength={200} {...fieldProps('subject')} />
          <TextField label="Preview text" hint="The grey line shown after the subject in the inbox." maxLength={200} {...fieldProps('preheader')} />

          <div className="ad-field">
            <span className="ad-label">Banner</span>
            {(draft.bannerUrl || c.bannerUrl) && <img src={(draft.bannerUrl || c.bannerUrl)!} alt="" className="ad-ce-banner" />}
            <small className="ad-muted">
              {t.bannerImageKey ? 'Your own banner for this email.' : c.bannerUrl ? 'Using the competition’s 16:9 banner.' : 'No banner: add one here, or the competition’s 16:9 banner in Basics.'}
              {' '}1200 × 600 px, JPG or PNG, under 300 KB.
            </small>
            <span className="ad-inline">
              <label className="ad-btn ad-btn--secondary ad-btn--sm">
                {busy === 'banner' ? 'Uploading…' : t.bannerImageKey ? 'Replace' : 'Upload a banner'}
                <input type="file" hidden accept="image/jpeg,image/png" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadBanner(f); }} />
              </label>
              {t.bannerImageKey && <button type="button" className="ad-link ad-neg" onClick={() => setDraft({ ...draft, bannerUrl: null, t: { ...t, bannerImageKey: null } })}>Use the competition banner</button>}
            </span>
          </div>
          <TextField label="Banner alt text" hint="Shown when images are off. Describe the picture in a few words." maxLength={200} value={t.bannerAlt} onChange={(e) => set({ bannerAlt: e.target.value })} />

          <TextField label="Heading" maxLength={200} {...fieldProps('heading')} />
          <TextArea label="Body" rows={11} hint="**bold**, *italic*, [link text](https://…), lists starting with - or 1., ## for a small heading. A blank line starts a new paragraph." {...fieldProps('bodyContent')} />

          <div className="ad-field">
            <span className="ad-label">Merge tags</span>
            <small className="ad-muted">Click to insert where your cursor is. Each is filled in for the person who gets the email.</small>
            <div className="ad-chips">
              {tagsFor(type, audience).map((m) => <button key={m.tag} type="button" title={`{{${m.tag}}}`} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(m.tag)}>{m.label}</button>)}
            </div>
          </div>

          <div className="ad-grid-2">
            <TextField label="Main button label" maxLength={60} {...fieldProps('primaryCtaLabel')} />
            <TextField label="Main button link" hint="A merge tag such as {{submit_url}}, or https://…" maxLength={500} {...fieldProps('primaryCtaUrl')} />
            <TextField label="Second button label" maxLength={60} {...fieldProps('secondaryCtaLabel')} />
            <TextField label="Second button link" hint="Leave both empty for no second button." maxLength={500} {...fieldProps('secondaryCtaUrl')} />
          </div>

          <div className="ad-field">
            <span className="ad-label">Boxes in the email</span>
            {BLOCKS.map(([k, label, hint]) => {
              const blocked = student && (k === 'showReferral' || k === 'showUpsell');
              return (
                <Check key={k} label={label} disabled={blocked} checked={!blocked && t.blocks[k]} onChange={(v) => setBlock(k, v)}
                  hint={blocked ? 'Never in the Student version.' : empty[k] && t.blocks[k] ? `${hint}. Nothing to show yet, so it’s left out.` : hint} />
              );
            })}
          </div>

          <div className="ad-field">
            <span className="ad-label">Attachments (optional)</span>
            <small className="ad-muted">A download button works better than an attachment. Attachments can push emails into spam. At most 2 files (PDF, JPG or PNG), 5 MB together.</small>
            {t.attachmentKeys.length > 0 && (
              <ul className="ad-nl-books">
                {t.attachmentKeys.map((k) => (
                  <li key={k}>
                    <span>{draft.names[k] ?? k.split('/').pop()}{draft.sizes[k] ? <small> · {(draft.sizes[k] / 1048576).toFixed(1)} MB</small> : null}</span>
                    <button type="button" className="ad-link" onClick={() => set({ attachmentKeys: t.attachmentKeys.filter((x) => x !== k) })}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
            {t.attachmentKeys.length < ATTACHMENT_LIMIT.files && (
              <span className="ad-inline">
                <label className="ad-btn ad-btn--secondary ad-btn--sm">
                  {busy === 'attach' ? 'Uploading…' : 'Attach a file'}
                  <input type="file" hidden accept="application/pdf,image/jpeg,image/png" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) addAttachment(f); }} />
                </label>
              </span>
            )}
          </div>

          {shown.length > 0 && (
            <div className="ad-error ad-ce-problems" role="alert">
              <strong>Fix before saving:</strong>
              <ul>{shown.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          <div className="ad-row">
            <Btn kind="primary" busy={busy === 'save'} disabled={!changed || problems.length > 0} onClick={save}>{changed ? 'Save email' : 'Saved'}</Btn>
            <Btn busy={busy === 'test'} disabled={problems.length > 0} onClick={test}>Send test email to me</Btn>
            <Btn kind="ghost" busy={busy === 'reset'} onClick={reset}>Reset to default</Btn>
          </div>
          <small className="ad-muted">The test goes to {me.email} with sample details (Riya, parent Meera) and the subject starts with [Test]. It uses what’s on screen, even if not saved yet.</small>
        </div>
      </Card>
      <Preview competitionId={competitionId} type={type} audience={audience} t={t} />
    </div>
  );
}

/** The email filled with sample data, updated as you type. */
function Preview({ competitionId, type, audience, t }: { competitionId: string; type: EmailType; audience: Audience; t: TemplateContent }) {
  const [out, setOut] = useState<{ subject: string; html: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const key = useMemo(() => JSON.stringify({ type, audience, template: t }), [type, audience, t]);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      adminApi<{ subject: string; html: string }>(`/competitions/${competitionId}/emails/preview`, { body: JSON.parse(key), retry: true })
        .then((r) => { if (mine === seq.current) { setOut(r); setErr(null); } })
        .catch((e) => { if (mine === seq.current) setErr((e as Error).message); });
    }, 450);
    return () => clearTimeout(timer);
  }, [key, competitionId]);
  return (
    <Card title="Preview" className="ad-nl-preview" actions={
      <div className="ad-nl-seg">
        <button type="button" className={!mobile ? 'is-on' : ''} onClick={() => setMobile(false)}>Desktop</button>
        <button type="button" className={mobile ? 'is-on' : ''} onClick={() => setMobile(true)}>Phone</button>
      </div>
    }>
      {err && <div className="ad-error">{err}</div>}
      {out && <div className="ad-ce-subject"><small className="ad-muted">Subject</small> {out.subject}</div>}
      <div className={'ad-nl-frame' + (mobile ? ' is-mobile' : '')}>
        {out ? <iframe title="Email preview" srcDoc={out.html} sandbox="" /> : <Loading />}
      </div>
      <small className="ad-muted">Sample details: Riya (class 4), parent Meera. {!t.enabled && 'This email is switched off, so it won’t be sent.'}</small>
    </Card>
  );
}

interface LogRow { id: string; template: string; to: string; audience: Audience | null; status: 'queued' | 'sent' | 'failed'; attempts: number; error: string | null; createdAt: string; sentAt: string | null }
const LOG_NAME: Record<string, string> = {
  comp_registration: 'Registration confirmed', comp_submission: 'Entry received', comp_submission_edited: 'Entry changed', comp_submission_withdrawn: 'Entry withdrawn',
};

/** What was sent for this competition, failures first, with a retry button. */
function SendLog({ id }: { id: string }) {
  const { data, error, reload } = useAdmin<{ totals: Partial<Record<LogRow['status'], number>>; items: LogRow[] }>(`/competitions/${id}/emails/log`);
  const toast = useToast();
  const { busy, run } = useAction();
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return null;
  const failed = data.totals.failed ?? 0;
  return (
    <Card title="Sent emails" flush actions={failed > 0 && (
      <Btn size="sm" busy={busy === 'retry'} onClick={() => run('retry', () => adminApi<{ tried: number; stillFailing: number }>(`/competitions/${id}/emails/retry`, { method: 'POST' }))
        .then((r) => { if (r) { reload(); toast(r.stillFailing ? `${r.stillFailing} still failing` : 'All sent', r.stillFailing ? 'error' : undefined); } })}>Try failed ones again</Btn>
    )}>
      <p className="ad-nl-note ad-muted">
        {data.totals.sent ?? 0} sent{failed > 0 && `, ${failed} failed`}{data.totals.queued ? `, ${data.totals.queued} waiting` : ''}.
        {' '}Failed emails are tried again automatically every 15 minutes for 3 days. A failed email never undoes a registration or an entry.
      </p>
      {data.items.length > 0 && (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead><tr><th>Email</th><th>To</th><th>Status</th><th>When</th></tr></thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>{LOG_NAME[r.template] ?? r.template}{r.audience && <small className="ad-muted"> · {r.audience}</small>}</td>
                  <td>{r.to}</td>
                  <td>
                    <Badge tone={r.status === 'sent' ? 'green' : r.status === 'failed' ? 'red' : 'amber'}>{r.status === 'sent' ? (r.error?.startsWith('skipped') ? 'Skipped' : 'Sent') : r.status === 'failed' ? 'Failed' : 'Waiting'}</Badge>
                    {r.status === 'failed' && r.error && <div><small className="ad-muted">{r.error} ({r.attempts} tries)</small></div>}
                  </td>
                  <td>{fmtDate(r.sentAt ?? r.createdAt, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
