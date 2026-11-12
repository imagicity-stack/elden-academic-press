import { useEffect, useState } from 'react';
import { codAdvanceFor, type CodAdvanceType, type CodRule } from '../../shared/cod';
import { NavLink, useParams } from 'react-router-dom';
import { inr } from '../../store/api';
import { adminApi, ApiError, fmtDate, rupees, toPaise, useAdmin } from '../api';
import { useMe } from '../AdminApp';
import { Badge, Btn, Card, Check, ErrorBox, Loading, Modal, MoneyField, Page, SelectField, TextArea, TextField, useAction } from '../ui';

const STATES: [string, string][] = [['35', 'Andaman and Nicobar Islands'], ['37', 'Andhra Pradesh'], ['12', 'Arunachal Pradesh'], ['18', 'Assam'], ['10', 'Bihar'], ['04', 'Chandigarh'], ['22', 'Chhattisgarh'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['07', 'Delhi'], ['30', 'Goa'], ['24', 'Gujarat'], ['06', 'Haryana'], ['02', 'Himachal Pradesh'], ['01', 'Jammu and Kashmir'], ['20', 'Jharkhand'], ['29', 'Karnataka'], ['32', 'Kerala'], ['38', 'Ladakh'], ['31', 'Lakshadweep'], ['23', 'Madhya Pradesh'], ['27', 'Maharashtra'], ['14', 'Manipur'], ['17', 'Meghalaya'], ['15', 'Mizoram'], ['13', 'Nagaland'], ['21', 'Odisha'], ['34', 'Puducherry'], ['03', 'Punjab'], ['08', 'Rajasthan'], ['11', 'Sikkim'], ['33', 'Tamil Nadu'], ['36', 'Telangana'], ['16', 'Tripura'], ['09', 'Uttar Pradesh'], ['05', 'Uttarakhand'], ['19', 'West Bengal']];

export default function Settings() {
  const { tab = 'store' } = useParams();
  const { me } = useMe();
  const tabs = [['store', 'Store'], ['categories', 'Categories'], ['claude', 'Claude'], ...(me.role === 'owner' ? [['staff', 'Staff'], ['activity', 'Activity log']] : [])];
  return (
    <Page title="Settings">
      <div className="ad-tabs">{tabs.map(([k, l]) => <NavLink key={k} to={`/admin/settings${k === 'store' ? '' : '/' + k}`} end className={({ isActive }) => 'ad-tab' + (isActive || (k === 'store' && tab === 'store') ? ' is-on' : '')}>{l}</NavLink>)}</div>
      {tab === 'store' && <StoreSettings />}
      {tab === 'categories' && <Categories />}
      {tab === 'staff' && me.role === 'owner' && <Staff />}
      {tab === 'activity' && me.role === 'owner' && <Activity />}
      {tab === 'claude' && <ClaudeConnections />}
    </Page>
  );
}

interface S {
  storeName: string; legalName: string; gstin: string; address: string; stateCode: string; supportEmail: string; supportPhone: string;
  shippingFlat: number; freeShippingAbove: number; orderExpiryMinutes: number; invoicePrefix: string; notifyEmails: string[]; requireMfa: boolean;
  lowStockThreshold: number; maxDownloads: number; downloadExpiryDays: number; newsletterDailyLimit: number; codEnabled: boolean; codAdvance: number; codAdvanceType: CodAdvanceType; codAdvanceBps: number; codAdvanceMin: number; updatedAt: string;
}

function StoreSettings() {
  const { me } = useMe();
  const owner = me.role === 'owner';
  const { data, error, reload } = useAdmin<S>('/settings');
  const [f, setF] = useState<Record<string, string | boolean> | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const { busy, run } = useAction();
  useEffect(() => {
    if (data) setF({
      ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v])) as Record<string, string | boolean>,
      shippingFlat: rupees(data.shippingFlat), freeShippingAbove: rupees(data.freeShippingAbove), notifyEmails: data.notifyEmails.join(', '),
      codAdvance: rupees(data.codAdvance), codAdvancePercent: String(data.codAdvanceBps / 100), codAdvanceMin: rupees(data.codAdvanceMin),
    });
  }, [data]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || !f) return <Loading />;
  const s = (k: string) => String(f[k] ?? '');
  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x!, [k]: v }));
  const fe = (k: string) => (err?.details as Record<string, string[]> | undefined)?.[k]?.[0];
  const save = async () => {
    setErr(null);
    await run('save', async () => {
      try {
        return await adminApi('/settings', {
          method: 'PUT', body: {
            storeName: s('storeName'), legalName: s('legalName'), gstin: s('gstin').trim().toUpperCase(), address: s('address'), stateCode: s('stateCode'),
            supportEmail: s('supportEmail'), supportPhone: s('supportPhone'), shippingFlat: toPaise(s('shippingFlat')), freeShippingAbove: toPaise(s('freeShippingAbove') || '0'),
            orderExpiryMinutes: Number(s('orderExpiryMinutes')), invoicePrefix: s('invoicePrefix').toUpperCase(),
            notifyEmails: s('notifyEmails').split(/[,\s]+/).filter(Boolean), requireMfa: Boolean(f.requireMfa),
            lowStockThreshold: Number(s('lowStockThreshold')), maxDownloads: Number(s('maxDownloads')), downloadExpiryDays: Number(s('downloadExpiryDays')),
            newsletterDailyLimit: Number(s('newsletterDailyLimit')),
            codEnabled: Boolean(f.codEnabled), codAdvance: toPaise(s('codAdvance') || '0'),
            codAdvanceType: s('codAdvanceType') === 'percent' ? 'percent' : 'flat',
            codAdvanceBps: Math.round(Number(s('codAdvancePercent') || '0') * 100), codAdvanceMin: toPaise(s('codAdvanceMin') || '0'),
          },
        });
      } catch (e) { if (e instanceof ApiError) setErr(e); throw e; }
    }, 'Settings saved');
    reload();
  };

  return (
    <fieldset className="ad-settings" disabled={!owner}>
      {!owner && <div className="ad-alert ad-alert--amber"><div>Only the store owner can change these settings.</div></div>}
      <Card title="Business details" actions={<span className="ad-muted">Shown on invoices and emails</span>}>
        <div className="ad-form-grid">
          <TextField label="Store name" value={s('storeName')} onChange={(e) => set('storeName', e.target.value)} error={fe('storeName')} />
          <TextField label="Legal name" value={s('legalName')} onChange={(e) => set('legalName', e.target.value)} error={fe('legalName')} />
          <TextField label="GSTIN" placeholder="Leave blank if not registered" value={s('gstin')} onChange={(e) => set('gstin', e.target.value.toUpperCase())} error={fe('gstin')}
            hint={s('gstin') ? 'GST is shown on invoices (e-books at their GST rate; printed books exempt).' : 'Without a GSTIN, invoices show no GST.'} />
          <SelectField label="Business state" value={s('stateCode')} onChange={(e) => set('stateCode', e.target.value)} hint="Decides CGST+SGST vs IGST">{STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</SelectField>
        </div>
        <TextArea label="Address" rows={2} value={s('address')} onChange={(e) => set('address', e.target.value)} />
      </Card>
      <Card title="Contact & notifications">
        <div className="ad-form-grid">
          <TextField label="Support email" type="email" value={s('supportEmail')} onChange={(e) => set('supportEmail', e.target.value)} error={fe('supportEmail')} />
          <TextField label="Support phone" value={s('supportPhone')} onChange={(e) => set('supportPhone', e.target.value)} />
        </div>
        <TextField label="Send new-order, enquiry and team registration alerts to" placeholder="orders@eldenap.in, owner@…" hint="Comma-separated. Empty = the support email." value={s('notifyEmails')} onChange={(e) => set('notifyEmails', e.target.value)} error={fe('notifyEmails')} />
      </Card>
      <Card title="Shipping">
        <div className="ad-form-grid">
          <MoneyField label="Flat shipping charge per order" value={s('shippingFlat')} onChange={(e) => set('shippingFlat', e.target.value)} />
          <MoneyField label="Free shipping on orders from" hint="0 = never free" value={s('freeShippingAbove')} onChange={(e) => set('freeShippingAbove', e.target.value)} />
        </div>
        <p className="ad-muted">Customers pay {inr(toPaise(s('shippingFlat')) || 0)} on orders with printed books{toPaise(s('freeShippingAbove')) > 0 && `, free from ${inr(toPaise(s('freeShippingAbove')))}`}. E-book-only orders never pay shipping.</p>
      </Card>
      <Card title="Cash on delivery">
        <Check label="Offer cash on delivery for printed books" hint="Buyers pay an advance online and the rest in cash when the books arrive. Not offered when the cart has an e-book. The free e-book with a printed copy unlocks once you mark the order Delivered."
          checked={Boolean(f.codEnabled)} onChange={(v) => set('codEnabled', v)} />
        {Boolean(f.codEnabled) && (() => {
          const rule: CodRule = {
            type: s('codAdvanceType') === 'percent' ? 'percent' : 'flat', advance: toPaise(s('codAdvance') || '0'),
            bps: Math.round(Number(s('codAdvancePercent') || '0') * 100), min: toPaise(s('codAdvanceMin') || '0'),
          };
          return (
            <>
              <div className="ad-field ad-mt">
                <span className="ad-label">Advance paid online</span>
                <div className="au-seg" role="radiogroup" aria-label="How the advance is worked out">
                  {([['flat', 'Flat amount'], ['percent', 'Percentage of the order']] as const).map(([k, l]) => (
                    <button key={k} type="button" role="radio" aria-checked={rule.type === k} className={rule.type === k ? 'is-on' : ''} onClick={() => set('codAdvanceType', k)}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="ad-form-grid">
                {rule.type === 'flat' ? (
                  <MoneyField label="Advance per order" value={s('codAdvance')} onChange={(e) => set('codAdvance', e.target.value)} error={fe('codAdvance')} hint="The same amount on every cash-on-delivery order. Covers shipping if the parcel is refused." />
                ) : (
                  <>
                    <TextField label="Percentage of the order total" type="number" min={1} max={100} step={0.5} value={s('codAdvancePercent')} onChange={(e) => set('codAdvancePercent', e.target.value)} error={fe('codAdvanceBps')} hint="Rounded up to a whole rupee." />
                    <MoneyField label="But at least (optional)" value={s('codAdvanceMin')} onChange={(e) => set('codAdvanceMin', e.target.value)} error={fe('codAdvanceMin')} hint="So small orders still cover shipping if the parcel is refused. 0 = no minimum." />
                  </>
                )}
              </div>
              <p className="ad-muted">
                {[30000, 80000, 200000].map((total) => {
                  const adv = codAdvanceFor(total, rule);
                  return adv >= total ? `${inr(total)} order: paid online in full` : `${inr(total)} order: ${inr(adv)} now, ${inr(total - adv)} in cash`;
                }).join(' · ')}
              </p>
            </>
          );
        })()}
      </Card>
      <Card title="Checkout & e-books">
        <div className="ad-form-grid">
          <TextField label="Hold stock for unpaid checkouts (minutes)" type="number" min={10} value={s('orderExpiryMinutes')} onChange={(e) => set('orderExpiryMinutes', e.target.value)} />
          <TextField label="Invoice prefix" value={s('invoicePrefix')} onChange={(e) => set('invoicePrefix', e.target.value.toUpperCase())} hint={`e.g. ${s('invoicePrefix') || 'EAP'}/27-28/00001`} error={fe('invoicePrefix')} />
          <TextField label="Downloads allowed per e-book" type="number" min={1} value={s('maxDownloads')} onChange={(e) => set('maxDownloads', e.target.value)} />
          <TextField label="Download link lasts (days)" type="number" min={0} hint="0 = forever" value={s('downloadExpiryDays')} onChange={(e) => set('downloadExpiryDays', e.target.value)} />
          <TextField label="Low-stock warning at" type="number" min={0} value={s('lowStockThreshold')} onChange={(e) => set('lowStockThreshold', e.target.value)} />
        </div>
      </Card>
      <Card title="Newsletter">
        <div className="ad-form-grid">
          <TextField label="Newsletter emails per day, at most" type="number" min={1} max={10000} value={s('newsletterDailyLimit')} onChange={(e) => set('newsletterDailyLimit', e.target.value)} error={fe('newsletterDailyLimit')}
            hint="Google Workspace allows about 2,000 emails a day per mailbox, order emails included. Larger lists send over several days." />
        </div>
      </Card>
      <Card title="Security">
        <Check label="Require two-step verification for all staff" hint="Strongly recommended. Staff sign in with a password and a code from an authenticator app." checked={Boolean(f.requireMfa)} onChange={(v) => set('requireMfa', v)} />
      </Card>
      {owner && <div className="ad-savebar"><Btn kind="primary" busy={busy === 'save'} onClick={save}>Save settings</Btn><span className="ad-muted">Last saved {fmtDate(data.updatedAt, true)}</span></div>}
    </fieldset>
  );
}

function Categories() {
  const { data, error, reload } = useAdmin<{ items: { id: number; name: string; slug: string; description: string; sort: number; products: number }[] }>('/categories');
  const [edit, setEdit] = useState<{ id?: number; name: string; description: string; sort: string } | null>(null);
  const { busy, run } = useAction();
  const save = () => run('save', () => adminApi(edit!.id ? `/categories/${edit!.id}` : '/categories', { method: edit!.id ? 'PUT' : 'POST', body: { name: edit!.name, description: edit!.description, sort: Number(edit!.sort) || 0 } }), 'Saved')
    .then((r) => { if (r) { setEdit(null); reload(); } });
  return (
    <Card title="Categories" actions={<Btn size="sm" kind="primary" onClick={() => setEdit({ name: '', description: '', sort: '0' })}>Add category</Btn>} flush>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : (
        <table className="ad-table ad-table--click">
          <thead><tr><th>Name</th><th>Web address</th><th className="ad-num">Products</th><th className="ad-num">Order</th></tr></thead>
          <tbody>{data.items.map((c) => (
            <tr key={c.id} onClick={() => setEdit({ id: c.id, name: c.name, description: c.description, sort: String(c.sort) })}>
              <td className="ad-strong">{c.name}</td><td className="ad-muted">/catalogue?type={c.slug}</td><td className="ad-num">{c.products}</td><td className="ad-num">{c.sort}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit category' : 'New category'} onClose={() => setEdit(null)} footer={<>
          {edit.id && <Btn kind="danger" busy={busy === 'del'} onClick={() => confirm('Delete this category? Its products stay, uncategorised.') && run('del', () => adminApi(`/categories/${edit.id}`, { method: 'DELETE' }), 'Deleted').then((r) => { if (r) { setEdit(null); reload(); } })}>Delete</Btn>}
          <span className="ad-grow" /><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn kind="primary" busy={busy === 'save'} disabled={edit.name.trim().length < 2} onClick={save}>Save</Btn>
        </>}>
          <div className="ad-form">
            <TextField label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
            <TextArea label="Description" rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            <TextField label="Order" type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: e.target.value })} hint="Lower numbers come first in filters" />
          </div>
        </Modal>
      )}
    </Card>
  );
}

interface StaffRow { userId: string; email: string; name: string; role: 'owner' | 'manager' | 'staff'; active: boolean; lastSeenAt: string | null; createdAt: string }
const ROLE_HELP = { owner: 'Everything, including settings and staff', manager: 'Products, prices, discounts, refunds and orders', staff: 'Orders, packing and shipping, enquiries, stock' };

function Staff() {
  const { me } = useMe();
  const { data, error, reload } = useAdmin<{ items: StaffRow[] }>('/staff');
  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'manager' | 'staff'>('staff');
  const { busy, run } = useAction();
  const update = (u: StaffRow, patch: Partial<StaffRow>) =>
    run('u' + u.userId, () => adminApi(`/staff/${u.userId}`, { method: 'PUT', body: { role: patch.role ?? u.role, active: patch.active ?? u.active } }), 'Updated').then(() => reload());
  return (
    <Card title="Staff" actions={<Btn size="sm" kind="primary" onClick={() => setInvite(true)}>Invite</Btn>} flush>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : (
        <table className="ad-table">
          <thead><tr><th>Person</th><th>Role</th><th>Last active</th><th /></tr></thead>
          <tbody>{data.items.map((u) => (
            <tr key={u.userId}>
              <td><b>{u.name || u.email}</b><div className="ad-muted">{u.email}</div></td>
              <td>{u.userId === me.userId ? <Badge tone="navy">{u.role[0].toUpperCase() + u.role.slice(1)} (you)</Badge> : (
                <select value={u.role} onChange={(e) => update(u, { role: e.target.value as StaffRow['role'] })} aria-label={`Role for ${u.email}`}>
                  <option value="owner">Owner</option><option value="manager">Manager</option><option value="staff">Staff</option>
                </select>
              )}</td>
              <td className="ad-muted">{u.lastSeenAt ? fmtDate(u.lastSeenAt, true) : 'Not signed in yet'}</td>
              <td>{u.userId !== me.userId && <Btn size="sm" kind={u.active ? 'danger' : 'secondary'} busy={busy === 'u' + u.userId} onClick={() => update(u, { active: !u.active })}>{u.active ? 'Remove access' : 'Restore access'}</Btn>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <dl className="ad-kv ad-pad">{Object.entries(ROLE_HELP).map(([r, h]) => <div key={r}><dt>{r}</dt><dd>{h}</dd></div>)}</dl>
      {invite && (
        <Modal title="Invite a team member" onClose={() => setInvite(false)} footer={<><Btn onClick={() => setInvite(false)}>Cancel</Btn>
          <Btn kind="primary" busy={busy === 'inv'} disabled={!email.includes('@')} onClick={() => run('inv', () => adminApi('/staff', { body: { email, name, role } }), `Invitation sent to ${email}`).then((r) => { if (r) { setInvite(false); setEmail(''); setName(''); reload(); } })}>Send invite</Btn></>}>
          <div className="ad-form">
            <p className="ad-muted">They’ll get an email to set a password, then set up two-step verification on first sign-in.</p>
            <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as 'manager' | 'staff')} hint={ROLE_HELP[role]}>
              <option value="staff">Staff</option><option value="manager">Manager</option>
            </SelectField>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function Activity() {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useAdmin<{ items: { id: number; actor: string; action: string; entity: string; entityId: string | null; details: unknown; ip: string | null; createdAt: string }[]; total: number }>(`/audit?page=${page}`);
  return (
    <Card title="Activity log" actions={<span className="ad-muted">Every change made in the admin</span>} flush>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : (
        <table className="ad-table">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
          <tbody>{data.items.map((a) => (
            <tr key={a.id}>
              <td className="ad-muted">{fmtDate(a.createdAt, true)}</td>
              <td>{a.actor}</td>
              <td><span className="ad-code">{a.action}</span> {a.entityId && <span className="ad-muted">{a.entity} {a.entityId.length > 20 ? a.entityId.slice(0, 8) + '…' : a.entityId}</span>}</td>
              <td className="ad-muted ad-mono ad-clip">{a.details ? JSON.stringify(a.details) : ''}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {data && data.total > 100 && <div className="ad-pager"><Btn size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Newer</Btn><Btn size="sm" disabled={page * 100 >= data.total} onClick={() => setPage(page + 1)}>Older →</Btn></div>}
    </Card>
  );
}

/* ---------------- Claude connector ---------------- */

interface Connection { id: string; app: string; email: string; role: string; createdAt: string; lastUsedAt: string | null }

function ClaudeConnections() {
  const { me } = useMe();
  const { data, error, reload } = useAdmin<{ items: Connection[] }>('/mcp/connections');
  const { busy, run } = useAction();
  const url = `${window.location.origin}/api/mcp`;
  return (
    <>
      <Card title="Connect Claude to the store">
        <div className="ad-form">
          <p>Claude can read the whole admin (sales, orders, customers, WhatsApp, calls, newsletter, audience, competitions and more), compare sales with your Meta ads, add or edit books, stock and discount codes, and, with your OK each time, reply on WhatsApp, send campaigns and start calls. It acts as the person who connects it, with their role, and every change shows in the activity log as “via Claude”. It can’t refund or cancel orders, decide on competition teams, delete anything, or change settings or staff.</p>
          <ol className="ad-steps">
            <li>In Claude, open <b>Settings → Connectors</b> and choose <b>Add custom connector</b>.</li>
            <li>Name it <b>Elden Academic Press</b> and paste this address: <code className="ad-code">{url}</code> <Btn size="sm" onClick={() => navigator.clipboard?.writeText(url)}>Copy</Btn></li>
            <li>Click <b>Connect</b>. This admin opens: sign in (with your authenticator app) and choose <b>Allow</b>.</li>
          </ol>
        </div>
      </Card>
      <Card title={me.role === 'owner' ? 'Connected apps (everyone’s)' : 'Your connected apps'} flush>
        {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : !data.items.length ? <p className="ad-muted ad-pad">Nothing connected yet.</p> : (
          <table className="ad-table">
            <thead><tr><th>App</th><th>Acts as</th><th>Connected</th><th>Last used</th><th /></tr></thead>
            <tbody>{data.items.map((x) => (
              <tr key={x.id}>
                <td><b>{x.app}</b></td>
                <td>{x.email}<div className="ad-muted">{x.role}</div></td>
                <td className="ad-muted">{fmtDate(x.createdAt, true)}</td>
                <td className="ad-muted">{x.lastUsedAt ? fmtDate(x.lastUsedAt, true) : 'Not yet'}</td>
                <td><Btn size="sm" kind="danger" busy={busy === x.id} onClick={() => run(x.id, () => adminApi(`/mcp/connections/${x.id}`, { method: 'DELETE' }), 'Disconnected').then(() => reload())}>Disconnect</Btn></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
