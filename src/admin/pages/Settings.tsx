import { useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { inr } from '../../store/api';
import { adminApi, ApiError, fmtDate, rupees, toPaise, useAdmin } from '../api';
import { useMe } from '../AdminApp';
import { Badge, Btn, Card, Check, ErrorBox, Loading, Modal, MoneyField, Page, SelectField, TextArea, TextField, useAction } from '../ui';

const STATES: [string, string][] = [['35', 'Andaman and Nicobar Islands'], ['37', 'Andhra Pradesh'], ['12', 'Arunachal Pradesh'], ['18', 'Assam'], ['10', 'Bihar'], ['04', 'Chandigarh'], ['22', 'Chhattisgarh'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['07', 'Delhi'], ['30', 'Goa'], ['24', 'Gujarat'], ['06', 'Haryana'], ['02', 'Himachal Pradesh'], ['01', 'Jammu and Kashmir'], ['20', 'Jharkhand'], ['29', 'Karnataka'], ['32', 'Kerala'], ['38', 'Ladakh'], ['31', 'Lakshadweep'], ['23', 'Madhya Pradesh'], ['27', 'Maharashtra'], ['14', 'Manipur'], ['17', 'Meghalaya'], ['15', 'Mizoram'], ['13', 'Nagaland'], ['21', 'Odisha'], ['34', 'Puducherry'], ['03', 'Punjab'], ['08', 'Rajasthan'], ['11', 'Sikkim'], ['33', 'Tamil Nadu'], ['36', 'Telangana'], ['16', 'Tripura'], ['09', 'Uttar Pradesh'], ['05', 'Uttarakhand'], ['19', 'West Bengal']];

export default function Settings() {
  const { tab = 'store' } = useParams();
  const { me } = useMe();
  const tabs = [['store', 'Store'], ['categories', 'Categories'], ...(me.role === 'owner' ? [['staff', 'Staff'], ['activity', 'Activity log']] : [])];
  return (
    <Page title="Settings">
      <div className="ad-tabs">{tabs.map(([k, l]) => <NavLink key={k} to={`/admin/settings${k === 'store' ? '' : '/' + k}`} end className={({ isActive }) => 'ad-tab' + (isActive || (k === 'store' && tab === 'store') ? ' is-on' : '')}>{l}</NavLink>)}</div>
      {tab === 'store' && <StoreSettings />}
      {tab === 'categories' && <Categories />}
      {tab === 'staff' && me.role === 'owner' && <Staff />}
      {tab === 'activity' && me.role === 'owner' && <Activity />}
    </Page>
  );
}

interface S {
  storeName: string; legalName: string; gstin: string; address: string; stateCode: string; supportEmail: string; supportPhone: string;
  shippingFlat: number; freeShippingAbove: number; orderExpiryMinutes: number; invoicePrefix: string; notifyEmails: string[]; requireMfa: boolean;
  lowStockThreshold: number; maxDownloads: number; downloadExpiryDays: number; updatedAt: string;
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
        <TextField label="Send new-order and enquiry alerts to" placeholder="orders@eldenap.in, owner@…" hint="Comma-separated. Empty = the support email." value={s('notifyEmails')} onChange={(e) => set('notifyEmails', e.target.value)} error={fe('notifyEmails')} />
      </Card>
      <Card title="Shipping">
        <div className="ad-form-grid">
          <MoneyField label="Flat shipping charge per order" value={s('shippingFlat')} onChange={(e) => set('shippingFlat', e.target.value)} />
          <MoneyField label="Free shipping on orders from" hint="0 = never free" value={s('freeShippingAbove')} onChange={(e) => set('freeShippingAbove', e.target.value)} />
        </div>
        <p className="ad-muted">Customers pay {inr(toPaise(s('shippingFlat')) || 0)} on orders with printed books{toPaise(s('freeShippingAbove')) > 0 && `, free from ${inr(toPaise(s('freeShippingAbove')))}`}. E-book-only orders never pay shipping.</p>
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
