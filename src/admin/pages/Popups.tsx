// Admin → Popups: every popup with its last 30 days, a template gallery to start from, and the
// builder: content, design, when it opens, who sees it and when it runs, with a live preview
// (desktop or phone, the same component the website uses) and its numbers.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { inr } from '../../store/api';
import { adminApi, fmtDate, uploadFile, useAdmin } from '../api';
import { Badge, Btn, Card, Check, Empty, ErrorBox, Loading, Modal, Page, SelectField, TextArea, TextField, type Tone, useAction, useToast } from '../ui';
import { PopupView } from '../../components/popups/PopupView';
import { CHANNELS, type Channel } from '../../shared/attribution';
import {
  frequencyText, GOAL_LABEL, LAYOUT_LABEL, PREVIEW_KEY, TEMPLATES, triggerText,
  type PopupAudience, type PopupContent, type PopupDesign, type PopupFields, type PopupFrequency, type PopupStatus, type PopupTrigger,
} from '../../shared/popups';
import '../../fonts';

interface Stats { views: number; clicks: number; closes: number; conversions: number }
interface PopupRow extends PopupFields { id: string; name: string; status: PopupStatus; priority: number; createdAt: string; updatedAt: string; createdBy: string; stats?: Stats }
interface Detail { popup: PopupRow; days: (Stats & { day: string })[]; totals: Stats; couponOrders: { code: string; orders: number; revenue: number } | null; warnings: string[] }

const STATUS: Record<PopupStatus, [string, Tone]> = { draft: ['Draft', 'grey'], live: ['Live', 'green'], paused: ['Paused', 'amber'] };
const goalCount = (p: Pick<PopupFields, 'content'>, s: Stats) => (p.content.goal === 'subscribe' ? s.conversions : s.clicks);
const goalWord = (p: Pick<PopupFields, 'content'>) => (p.content.goal === 'subscribe' ? 'sign-ups' : 'clicks');
const rate = (n: number, of: number) => (of ? `${((n / of) * 100).toFixed(n / of < 0.1 ? 1 : 0)}%` : '—');

export default function Popups() {
  const { id } = useParams();
  return id ? <Editor id={id} /> : <List />;
}

/* ---------------- The list ---------------- */

function List() {
  const { data, error, reload } = useAdmin<{ items: PopupRow[] }>('/popups');
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  return (
    <Page title="Popups" subtitle="Sign-up offers, discount codes, announcements and launches: who sees them, when, and how often. Numbers are for the last 30 days."
      actions={<Btn kind="primary" onClick={() => setPicking(true)}>New popup</Btn>}>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? (
        <Card><Empty title="No popups yet.">Start from a template: a welcome offer, an exit-intent coupon, an announcement bar or a competition promo.<div className="ad-mt"><Btn kind="primary" onClick={() => setPicking(true)}>Choose a template</Btn></div></Empty></Card>
      ) : (
        <Card flush>
          <div className="ad-table-wrap">
            <table className="ad-table ad-table--click">
              <thead><tr><th>Popup</th><th>Status</th><th>Opens</th><th className="ad-num">Shown</th><th className="ad-num">Result</th><th className="ad-num">Rate</th><th>Updated</th></tr></thead>
              <tbody>
                {data.items.map((p) => {
                  const s = p.stats ?? { views: 0, clicks: 0, closes: 0, conversions: 0 };
                  return (
                    <tr key={p.id} onClick={() => navigate(`/admin/popups/${p.id}`)}>
                      <td><Link to={`/admin/popups/${p.id}`} className="ad-strong" onClick={(e) => e.stopPropagation()}>{p.name}</Link><div className="ad-muted">{GOAL_LABEL[p.content.goal]} · {LAYOUT_LABEL[p.design.layout]}</div></td>
                      <td><Badge tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge>{p.endsAt && new Date(p.endsAt) < new Date() && <div className="ad-muted">Ended</div>}</td>
                      <td className="ad-muted">{triggerText(p.trigger)}</td>
                      <td className="ad-num">{s.views}</td>
                      <td className="ad-num">{goalCount(p, s)} <span className="ad-muted">{goalWord(p)}</span></td>
                      <td className="ad-num ad-strong">{rate(goalCount(p, s), s.views)}</td>
                      <td className="ad-muted ad-nowrap">{fmtDate(p.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {picking && <TemplatePicker onClose={() => setPicking(false)} />}
    </Page>
  );
}

function TemplatePicker({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [key, setKey] = useState(TEMPLATES[0].key);
  const [name, setName] = useState(TEMPLATES[0].name);
  const { busy, run } = useAction();
  const create = () => run('create', async () => {
    const p = await adminApi<PopupRow>('/popups', { body: { name: name.trim() || 'Popup', template: key } });
    navigate(`/admin/popups/${p.id}`);
  });
  return (
    <Modal title="Start a popup" onClose={onClose} wide footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" busy={busy === 'create'} onClick={create}>Create and edit</Btn></>}>
      <div className="ad-pp-templates" role="radiogroup" aria-label="Templates">
        {TEMPLATES.map((t) => (
          <div key={t.key} role="radio" tabIndex={0} aria-checked={t.key === key} className={'ad-pp-template' + (t.key === key ? ' is-on' : '')}
            onClick={() => { setKey(t.key); setName(t.name); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setKey(t.key); setName(t.name); } }}>
            <div className="ad-pp-template__preview" aria-hidden="true" inert>
              <div className="ad-pp-template__scale"><Mock device="desktop"><PopupView content={t.popup.content} design={t.popup.design} preview="desktop" onClose={() => {}} onPrimary={() => {}} onSubscribe={async () => {}} /></Mock></div>
            </div>
            <b>{t.name}</b>
            <span>{t.description}</span>
          </div>
        ))}
      </div>
      <TextField label="Name (only staff see it)" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
    </Modal>
  );
}

/** A pretend page behind the preview; the popup is drawn at a real screen's width and scaled to fit. */
function Mock({ device, children }: { device: 'desktop' | 'mobile'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(device === 'desktop' ? 0.5 : 0.7);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / (device === 'desktop' ? 1100 : 390));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [device]);
  return (
    <div ref={ref} className={`ad-pp-mock ad-pp-mock--${device}`} style={{ '--s': String(scale) } as CSSProperties}>
      <div className="ad-pp-mock__page" aria-hidden="true">
        <div className="ad-pp-mock__nav"><i /><i /><i /><i /></div>
        <div className="ad-pp-mock__hero"><i /><i /><i /></div>
        <div className="ad-pp-mock__grid"><i /><i /><i /><i /></div>
      </div>
      {children}
    </div>
  );
}

/* ---------------- The builder ---------------- */

type Draft = PopupFields & { name: string; priority: number };
const TABS = [['content', 'Content'], ['design', 'Design'], ['when', 'When it opens'], ['who', 'Who sees it'], ['schedule', 'Schedule']] as const;
type Tab = (typeof TABS)[number][0];
const PALETTES: [string, PopupDesign['colors']][] = [
  ['Ink', { background: '#FFFFFF', text: '#0B1220', accent: '#0B1220', accentText: '#FFFFFF' }],
  ['Paper', { background: '#FFF8E6', text: '#0B1220', accent: '#E8572A', accentText: '#FFFFFF' }],
  ['Night', { background: '#0B1220', text: '#FFFFFF', accent: '#FFD84D', accentText: '#0B1220' }],
  ['Navy', { background: '#0E1F33', text: '#FFFFFF', accent: '#CC955F', accentText: '#0E1F33' }],
  ['Comic', { background: '#10301F', text: '#FFFFFF', accent: '#FF3B1F', accentText: '#FFFFFF' }],
  ['Mint', { background: '#E9F7EF', text: '#0B3B24', accent: '#1B7A3D', accentText: '#FFFFFF' }],
];
/** "2026-11-08T10:00" in India for an <input type="datetime-local">, and back. */
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? `${v}:00+05:30` : null);

function Editor({ id }: { id: string }) {
  const { data, error, reload } = useAdmin<Detail>(`/popups/${id}`);
  const navigate = useNavigate();
  const toast = useToast();
  const { busy, run } = useAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('content');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [stage, setStage] = useState<'main' | 'success'>('main');
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    if (!data) return;
    const p = data.popup;
    const d: Draft = { name: p.name, priority: p.priority, content: p.content, design: p.design, trigger: p.trigger, audience: p.audience, frequency: p.frequency, startsAt: p.startsAt, endsAt: p.endsAt };
    setDraft(d); setSaved(JSON.stringify(d)); setWarnings(data.warnings);
  }, [data]);

  const dirty = draft !== null && JSON.stringify(draft) !== saved;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (error) return <Page title="Popup" back={{ to: '/admin/popups', label: 'Popups' }}><ErrorBox error={error} retry={reload} /></Page>;
  if (!data || !draft) return <Page title="Popup" back={{ to: '/admin/popups', label: 'Popups' }}><Loading /></Page>;
  const p = data.popup;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const setC = (patch: Partial<PopupContent>) => set('content', { ...draft.content, ...patch });
  const setD = (patch: Partial<PopupDesign>) => set('design', { ...draft.design, ...patch });
  const setT = (patch: Partial<PopupTrigger>) => set('trigger', { ...draft.trigger, ...patch });
  const setA = (patch: Partial<PopupAudience>) => set('audience', { ...draft.audience, ...patch });
  const setF = (patch: Partial<PopupFrequency>) => set('frequency', { ...draft.frequency, ...patch });

  const save = async () => {
    const r = await adminApi<{ popup: PopupRow; warnings: string[] }>(`/popups/${id}`, { method: 'PUT', body: draft });
    setSaved(JSON.stringify(draft)); setWarnings(r.warnings);
    return r;
  };
  const setStatus = (status: PopupStatus) => run(status, async () => {
    if (dirty) await save();
    await adminApi(`/popups/${id}/status`, { body: { status } });
    toast(status === 'live' ? 'Published: it reaches the website within a minute' : status === 'paused' ? 'Paused' : 'Back to draft');
    reload();
  });
  const previewOnSite = () => {
    try { localStorage.setItem(PREVIEW_KEY, JSON.stringify({ id, ...draft })); } catch { /* ignore */ }
    const page = draft.audience.pages.mode === 'only' && draft.audience.pages.patterns[0] ? draft.audience.pages.patterns[0].replace(/\*$/, '').replace(/\/$/, '') || '/' : '/';
    window.open(`${page.includes('/books/') && page.endsWith('/books') ? '/store' : page}?popup-preview=1`, '_blank', 'noopener');
  };

  const c = draft.content, d = draft.design;
  return (
    <Page title={draft.name || 'Popup'} back={{ to: '/admin/popups', label: 'Popups' }}
      subtitle={<><Badge tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge> {GOAL_LABEL[c.goal]} · {LAYOUT_LABEL[d.layout]} · {triggerText(draft.trigger)}{dirty && <> · <b>Unsaved changes</b></>}</>}
      actions={
        <div className="ad-row">
          <Btn busy={busy === 'save'} disabled={!dirty} onClick={() => run('save', async () => { await save(); toast(p.status === 'live' ? 'Saved: the website shows it within a minute' : 'Saved'); })}>Save</Btn>
          {p.status === 'live'
            ? <Btn busy={busy === 'paused'} onClick={() => setStatus('paused')}>Pause</Btn>
            : <Btn kind="primary" busy={busy === 'live'} onClick={() => setStatus('live')}>{p.status === 'paused' ? 'Resume' : 'Publish'}</Btn>}
        </div>
      }>
      {warnings.map((w) => <div key={w} className="ad-warn">{w} <Link to="/admin/discounts">Discounts →</Link></div>)}
      <div className="ad-pp-builder">
        <div className="ad-stack">
          <Card flush>
            <nav className="ad-tabs ad-pp-tabs">{TABS.map(([k, l]) => <button key={k} type="button" className={'ad-tab' + (tab === k ? ' is-on' : '')} onClick={() => setTab(k)}>{l}</button>)}</nav>
            <div className="ad-pp-form">
              {tab === 'content' && (
                <>
                  <Segmented label="Goal" value={c.goal} onChange={(goal) => { setC({ goal }); setStage('main'); }}
                    options={[['subscribe', 'Email sign-up'], ['coupon', 'Discount code'], ['link', 'Link'], ['announce', 'Announcement']]} />
                  <TextField label="Small heading (optional)" value={c.eyebrow} onChange={(e) => setC({ eyebrow: e.target.value })} maxLength={60} />
                  <TextField label="Heading" value={c.heading} onChange={(e) => setC({ heading: e.target.value })} maxLength={140} />
                  <TextArea label="Text" rows={3} value={c.body} onChange={(e) => setC({ body: e.target.value })} maxLength={1200} hint="**bold**, *italic*, [a link](/store)" />
                  <ImageField value={c.image} alt={c.imageAlt} onChange={(image, imageAlt) => setC({ image, imageAlt })} />
                  {c.goal !== 'subscribe' && (
                    <div className="ad-grid-2">
                      <TextField label="Button text" value={c.button.label} onChange={(e) => setC({ button: { ...c.button, label: e.target.value } })} maxLength={40} />
                      <TextField label="Button link" value={c.button.url} onChange={(e) => setC({ button: { ...c.button, url: e.target.value } })} placeholder="/store or https://…" maxLength={500} />
                    </div>
                  )}
                  {(c.goal === 'coupon' || c.goal === 'subscribe') && (
                    <TextField label={c.goal === 'coupon' ? 'Discount code' : 'Discount code shown after signing up (optional)'} value={c.coupon} onChange={(e) => setC({ coupon: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} maxLength={30}
                      hint={<>Create it first in <Link to="/admin/discounts">Discounts</Link>. Visitors can copy it or apply it to their cart.</>} />
                  )}
                  {c.goal === 'subscribe' && (
                    <>
                      <div className="ad-grid-2">
                        <TextField label="Sign-up button" value={c.submitLabel} onChange={(e) => setC({ submitLabel: e.target.value })} maxLength={30} />
                        <div className="ad-pp-check"><Check label="Ask for their name too" checked={c.askName} onChange={(askName) => setC({ askName })} /></div>
                      </div>
                      <p className="ad-muted ad-pp-note">Email and mobile number are always asked, with the newsletter consent box (as on the rest of the site). Sign-ups join the newsletter and get the welcome email.</p>
                      <TextField label="After signing up: heading" value={c.success.heading} onChange={(e) => setC({ success: { ...c.success, heading: e.target.value } })} maxLength={120} onFocus={() => setStage('success')} />
                      <TextArea label="After signing up: text" rows={2} value={c.success.body} onChange={(e) => setC({ success: { ...c.success, body: e.target.value } })} maxLength={600} onFocus={() => setStage('success')} />
                    </>
                  )}
                  <div className="ad-grid-2">
                    <TextField label="“No thanks” link (optional)" value={c.dismissLabel} onChange={(e) => setC({ dismissLabel: e.target.value })} maxLength={40} hint="Leave empty to close with × only." />
                    <TextField label="Countdown to (optional)" type="datetime-local" value={toLocal(c.countdownTo)} onChange={(e) => setC({ countdownTo: fromLocal(e.target.value) })} hint="Shows “Ends in 2 days 4 hr”. India time." />
                  </div>
                </>
              )}
              {tab === 'design' && (
                <>
                  <Segmented label="Type" value={d.layout} onChange={(layout) => setD({ layout, position: layout === 'bar' ? (d.position === 'bottom' ? 'bottom' : 'top') : layout === 'slide' ? (d.position === 'bottom-left' ? 'bottom-left' : 'bottom-right') : d.position })}
                    options={[['modal', 'Centred'], ['slide', 'Slide-in'], ['bar', 'Bar'], ['fullscreen', 'Full screen']]} />
                  <p className="ad-muted ad-pp-note">{{
                    modal: 'In the middle of the page, over a dimmed background. On phones it rises from the bottom as a sheet.',
                    slide: 'A small card in a corner; visitors can keep reading. Least intrusive.',
                    bar: 'A slim strip across the top (pushing the page down) or fixed at the bottom.',
                    fullscreen: 'Covers the whole window on computers; a bottom sheet on phones (Google lowers the ranking of pages with full-screen popups on phones).',
                  }[d.layout]}</p>
                  {d.layout === 'slide' && <Segmented label="Corner" value={d.position} onChange={(position) => setD({ position })} options={[['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left']]} />}
                  {d.layout === 'bar' && <Segmented label="Position" value={d.position} onChange={(position) => setD({ position })} options={[['top', 'Top'], ['bottom', 'Bottom']]} />}
                  {d.layout !== 'bar' && (
                    <>
                      <Segmented label="Size" value={d.size} onChange={(size) => setD({ size })} options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]} />
                      {c.image && <Segmented label="Picture" value={d.imagePosition} onChange={(imagePosition) => setD({ imagePosition })} options={[['top', 'On top'], ['side', 'Beside'], ['background', 'Behind the text']]} />}
                    </>
                  )}
                  <Segmented label="Text" value={d.align} onChange={(align) => setD({ align })} options={[['center', 'Centred'], ['left', 'Left']]} />
                  <Segmented label="Heading style" value={d.font} onChange={(font) => setD({ font })} options={[['sans', 'Clean'], ['serif', 'Bookish'], ['display', 'Bold']]} />
                  <div className="ad-field"><span>Colours</span>
                    <div className="ad-pp-palettes">{PALETTES.map(([n, pal]) => (
                      <button key={n} type="button" className="ad-pp-palette" onClick={() => setD({ colors: pal })} title={n} aria-label={`${n} colours`}>
                        <i style={{ background: pal.background }} /><i style={{ background: pal.accent }} /><span>{n}</span>
                      </button>
                    ))}</div>
                    <div className="ad-pp-colors">
                      {([['background', 'Background'], ['text', 'Text'], ['accent', 'Button'], ['accentText', 'Button text']] as const).map(([k, l]) => (
                        <label key={k} className="ad-pp-color"><input type="color" value={d.colors[k]} onChange={(e) => setD({ colors: { ...d.colors, [k]: e.target.value.toUpperCase() } })} aria-label={l} /><span>{l}</span><code>{d.colors[k]}</code></label>
                      ))}
                    </div>
                  </div>
                  <div className="ad-grid-2">
                    <Range label="Corner rounding" value={d.radius} min={0} max={32} unit="px" onChange={(radius) => setD({ radius })} />
                    {(d.layout === 'modal' || d.layout === 'fullscreen') && <Range label="Dim the page" value={d.overlay} min={0} max={90} unit="%" onChange={(overlay) => setD({ overlay })} />}
                  </div>
                  <Segmented label="Entrance" value={d.animation} onChange={(animation) => { setD({ animation }); setReplay((n) => n + 1); }} options={[['fade', 'Fade'], ['zoom', 'Pop'], ['slide', 'Slide up']]} />
                </>
              )}
              {tab === 'when' && (
                <>
                  <Segmented label="Opens" value={draft.trigger.type} onChange={(type) => setT({ type })}
                    options={[['delay', 'After a few seconds'], ['scroll', 'On scroll'], ['exit', 'When leaving'], ['pageviews', 'After some pages'], ['link', 'From a link']]} />
                  {draft.trigger.type === 'delay' && <Range label="Seconds on the page" value={draft.trigger.seconds} min={0} max={60} unit=" s" onChange={(seconds) => setT({ seconds })} />}
                  {draft.trigger.type === 'scroll' && <Range label="How far down the page" value={draft.trigger.percent} min={10} max={100} step={5} unit="%" onChange={(percent) => setT({ percent })} />}
                  {draft.trigger.type === 'exit' && (
                    <>
                      <p className="ad-muted ad-pp-note">Opens when the mouse heads for the address bar or the tab’s close button. Phones have no mouse: there it opens after the seconds below.</p>
                      <Range label="On phones, after" value={draft.trigger.seconds} min={5} max={120} step={5} unit=" s" onChange={(seconds) => setT({ seconds })} />
                    </>
                  )}
                  {draft.trigger.type === 'pageviews' && <Range label="On page number" value={draft.trigger.pageviews} min={1} max={10} unit="" onChange={(pageviews) => setT({ pageviews })} />}
                  {draft.trigger.type === 'link' && (
                    <div className="ad-field"><span>Link that opens it</span>
                      <code className="ad-pp-code">#popup-{id}</code>
                      <small>Add it to the end of any link on the site or in a message, e.g. <code>https://eldenap.in/store#popup-{id}</code>, or use <code>#popup-{id}</code> as a link in a popup or page text.</small>
                    </div>
                  )}
                  <SelectField label="How often" value={draft.frequency.show} onChange={(e) => setF({ show: e.target.value as PopupFrequency['show'] })}>
                    <option value="every">Every time the conditions are met (for testing)</option>
                    <option value="session">Once per visit</option>
                    <option value="days">At most once every few days</option>
                    <option value="once">Only once per visitor</option>
                  </SelectField>
                  {draft.frequency.show === 'days' && <Range label="Days between showings" value={draft.frequency.days} min={1} max={60} unit=" days" onChange={(days) => setF({ days })} />}
                  <Check label={`Stop showing it to someone who ${c.goal === 'subscribe' ? 'signed up' : 'clicked its button'}`} checked={draft.frequency.stopAfterConvert} onChange={(stopAfterConvert) => setF({ stopAfterConvert })} />
                  <p className="ad-muted ad-pp-note">Built in for every popup: never at checkout or on order pages, never over the cookie choice or another window, at most one popup per page, and two minutes between different popups.</p>
                </>
              )}
              {tab === 'who' && (
                <>
                  <Segmented label="Pages" value={draft.audience.pages.mode} onChange={(mode) => setA({ pages: { ...draft.audience.pages, mode } })} options={[['all', 'All pages'], ['only', 'Only these'], ['except', 'All except these']]} />
                  {draft.audience.pages.mode !== 'all' && (
                    <TextArea label="Pages, one per line" rows={3} value={draft.audience.pages.patterns.join('\n')}
                      onChange={(e) => setA({ pages: { ...draft.audience.pages, patterns: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20) } })}
                      hint={<>e.g. <code>/</code> (home), <code>/store</code>, <code>/books/*</code> (every book page), <code>/competitions/*</code></>} />
                  )}
                  <div className="ad-grid-2">
                    <Segmented label="Devices" value={draft.audience.device} onChange={(device) => setA({ device })} options={[['all', 'All'], ['desktop', 'Computers'], ['mobile', 'Phones']]} />
                    <Segmented label="Visitors" value={draft.audience.visitor} onChange={(visitor) => setA({ visitor })} options={[['all', 'All'], ['new', 'First visit'], ['returning', 'Returning']]} />
                  </div>
                  <div className="ad-grid-2">
                    <Segmented label="Signed in" value={draft.audience.signedIn} onChange={(signedIn) => setA({ signedIn })} options={[['all', 'Anyone'], ['out', 'Signed out'], ['in', 'Signed in']]} />
                    <Segmented label="Cart" value={draft.audience.cart} onChange={(cart) => setA({ cart })} options={[['any', 'Any'], ['empty', 'Empty'], ['has_items', 'Has books']]} />
                  </div>
                  <div className="ad-field"><span>Came from (none ticked: anywhere)</span>
                    <div className="ad-pp-channels">{CHANNELS.filter((x) => x.key !== 'unknown').map((ch) => (
                      <Check key={ch.key} label={ch.label} checked={draft.audience.channels.includes(ch.key)}
                        onChange={(on) => setA({ channels: on ? [...draft.audience.channels, ch.key] : draft.audience.channels.filter((x: Channel) => x !== ch.key) })} />
                    ))}</div>
                    <small>From the link they arrived by (see Orders → Where orders came from), e.g. a matching offer for people from your Instagram ads.</small>
                  </div>
                  <TextField label="Campaign contains (optional)" value={draft.audience.campaign} onChange={(e) => setA({ campaign: e.target.value })} maxLength={60} hint="Matches the link’s utm_campaign, e.g. diwali." />
                  <Check label="Also show to signed-in student accounts" hint={c.goal === 'subscribe' ? 'Never for email sign-ups: students’ emails aren’t collected this way.' : 'Off by default; useful for a competition promo.'}
                    checked={draft.audience.students && c.goal !== 'subscribe'} disabled={c.goal === 'subscribe'} onChange={(students) => setA({ students })} />
                </>
              )}
              {tab === 'schedule' && (
                <>
                  <div className="ad-grid-2">
                    <TextField label="Starts (optional)" type="datetime-local" value={toLocal(draft.startsAt)} onChange={(e) => set('startsAt', fromLocal(e.target.value))} hint="India time. Empty: as soon as it’s published." />
                    <TextField label="Ends (optional)" type="datetime-local" value={toLocal(draft.endsAt)} onChange={(e) => set('endsAt', fromLocal(e.target.value))} hint="It stops showing by itself." />
                  </div>
                  <TextField label="Name (only staff see it)" value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
                  <TextField label="Priority" type="number" min={-100} max={100} value={draft.priority} onChange={(e) => set('priority', Math.max(-100, Math.min(100, Number(e.target.value) || 0)))}
                    hint="When two popups could open on the same page, the higher number goes first." />
                  <div className="ad-row ad-mt">
                    <Btn size="sm" busy={busy === 'dup'} onClick={() => run('dup', async () => { const x = await adminApi<PopupRow>(`/popups/${id}/duplicate`, { method: 'POST' }); navigate(`/admin/popups/${x.id}`); toast('Copied as a draft'); })}>Duplicate</Btn>
                    {p.status !== 'draft' && <Btn size="sm" busy={busy === 'draft'} onClick={() => setStatus('draft')}>Back to draft</Btn>}
                    <Btn size="sm" kind="danger" busy={busy === 'del'} onClick={() => { if (window.confirm(`Delete “${p.name}” and its numbers?`)) run('del', async () => { await adminApi(`/popups/${id}`, { method: 'DELETE' }); navigate('/admin/popups'); }); }}>Delete</Btn>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="ad-stack ad-pp-side">
          <Card flush title="Preview" actions={
            <div className="ad-row">
              <div className="ad-seg" role="group" aria-label="Device">
                <button type="button" className={device === 'desktop' ? 'is-on' : ''} onClick={() => setDevice('desktop')}>Computer</button>
                <button type="button" className={device === 'mobile' ? 'is-on' : ''} onClick={() => setDevice('mobile')}>Phone</button>
              </div>
              <Btn size="sm" kind="ghost" onClick={() => setReplay((n) => n + 1)} aria-label="Play the entrance again">↻</Btn>
            </div>
          }>
            {c.goal === 'subscribe' && (
              <div className="ad-seg ad-pp-stage" role="group" aria-label="Step">
                <button type="button" className={stage === 'main' ? 'is-on' : ''} onClick={() => setStage('main')}>Sign-up form</button>
                <button type="button" className={stage === 'success' ? 'is-on' : ''} onClick={() => setStage('success')}>After signing up</button>
              </div>
            )}
            <Mock device={device}>
              <PopupView key={`${replay}-${d.layout}-${d.animation}-${device}`} content={c} design={d} preview={device} initialStage={stage}
                onClose={() => setReplay((n) => n + 1)} onPrimary={() => {}} onSubscribe={async () => {}} onApplyCoupon={() => {}} />
            </Mock>
            <div className="ad-pp-preview-foot">
              <span className="ad-muted">{frequencyText(draft.frequency)}</span>
              <Btn size="sm" onClick={previewOnSite}>Preview on the site ↗</Btn>
            </div>
          </Card>
          <StatsCard d={data} />
        </div>
      </div>
    </Page>
  );
}

function StatsCard({ d }: { d: Detail }) {
  const p = d.popup, t = d.totals;
  const max = Math.max(1, ...d.days.map((x) => x.views));
  return (
    <Card title="Results (since it was created)">
      <div className="ad-pp-stats">
        <div><b>{t.views}</b><span>Shown</span></div>
        <div><b>{p.content.goal === 'subscribe' ? t.conversions : t.clicks}</b><span>{p.content.goal === 'subscribe' ? 'Signed up' : 'Clicked'}</span></div>
        <div><b>{rate(goalCount(p, t), t.views)}</b><span>Rate</span></div>
        <div><b>{t.closes}</b><span>Closed</span></div>
      </div>
      {d.couponOrders && <p className="ad-mt"><b>{d.couponOrders.orders}</b> paid order{d.couponOrders.orders === 1 ? '' : 's'} used <code>{d.couponOrders.code}</code> since this popup was made · <b>{inr(d.couponOrders.revenue)}</b></p>}
      {d.days.length > 0 ? (
        <ul className="ad-pp-days" aria-label="Shown per day, last 30 days">
          {d.days.map((x) => <li key={x.day} title={`${x.day}: shown ${x.views}, ${goalWord(p)} ${goalCount(p, x)}`}><i style={{ height: `${(x.views / max) * 100}%` }} /><em style={{ height: `${(goalCount(p, x) / max) * 100}%` }} /></li>)}
        </ul>
      ) : <p className="ad-muted ad-mt">No numbers yet. They appear once it’s live and shown.</p>}
      <p className="ad-muted ad-pp-note">Visits by people signed in to this admin aren’t counted.</p>
    </Card>
  );
}

/* ---------------- Small form pieces ---------------- */

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange(v: T): void }) {
  return (
    <div className="ad-field"><span>{label}</span>
      <div className="ad-seg ad-seg--wrap" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'is-on' : ''} onClick={() => onChange(v)}>{l}</button>)}
      </div>
    </div>
  );
}

function Range({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange(v: number): void }) {
  return (
    <label className="ad-field ad-pp-range"><span>{label} <b>{value}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </label>
  );
}

function ImageField({ value, alt, onChange }: { value: string; alt: string; onChange(url: string, alt: string): void }) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast('Use a JPG, PNG or WebP picture'); return; }
    run('img', async () => {
      const r = await uploadFile('covers', f);
      if (!r.publicUrl) throw new Error('The picture was uploaded but has no public address.');
      onChange(r.publicUrl, alt || f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
    });
  };
  const preset = useMemo(() => ['/assets/competitions/doomsday-diaries-800.webp'], []);
  return (
    <div className="ad-field"><span>Picture (optional)</span>
      <div className="ad-pp-image">
        {value ? <img src={value} alt="" /> : <div className="ad-pp-image__empty">No picture</div>}
        <div className="ad-stack-sm">
          <div className="ad-row">
            <Btn size="sm" busy={busy === 'img'} onClick={() => input.current?.click()}>{value ? 'Replace' : 'Upload'}</Btn>
            {value && <Btn size="sm" kind="ghost" onClick={() => onChange('', '')}>Remove</Btn>}
            {!value && preset.map((u) => <Btn key={u} size="sm" kind="ghost" onClick={() => onChange(u, 'DoomsDay Diaries: comic book writing competition')}>Use the DoomsDay banner</Btn>)}
          </div>
          {value && <input className="ad-pp-alt" value={alt} onChange={(e) => onChange(value, e.target.value)} placeholder="Describe the picture (for screen readers)" aria-label="Picture description" maxLength={160} />}
          <small className="ad-muted">JPG, PNG or WebP. Wide pictures work best on top; tall ones beside the text.</small>
        </div>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
