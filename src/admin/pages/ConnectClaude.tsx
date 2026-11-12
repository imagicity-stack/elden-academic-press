// /admin/connect: Claude (or another MCP app) asks to connect to the store. The team member is
// already signed in (with two-step verification) by the admin; here they approve or decline.
// The server checks the request again and gives the address to go back to.
import { useEffect, useState } from 'react';
import { errorMessage } from '../../store/api';
import { adminApi, ApiError } from '../api';
import { signOut } from '../auth';
import type { Me } from '../AdminApp';
import { Btn, Loading } from '../ui';

const CAN: Record<Me['role'], string[]> = {
  owner: [
    'See everything in the admin: sales, orders and refunds, customers, stock, WhatsApp, calls, abandoned checkouts, newsletter, audience, popups, competitions, settings and the activity log',
    'Add and edit books, publish them, change prices and stock, and create discount codes',
    'Reply on WhatsApp, send new-book WhatsApp messages and newsletter campaigns (it asks you first)',
    'Start, skip or follow up voice-agent calls',
    'Mark orders packed, shipped or delivered, and add notes',
  ],
  manager: [
    'See sales, orders and refunds, customers, stock, WhatsApp, calls, abandoned checkouts, newsletter, audience, popups and settings',
    'Add and edit books, publish them, change prices and stock, and create discount codes',
    'Reply on WhatsApp, send new-book WhatsApp messages and newsletter campaigns (it asks you first)',
    'Start, skip or follow up voice-agent calls',
    'Mark orders packed, shipped or delivered, and add notes',
  ],
  staff: [
    'See sales, orders, customers, enquiries, stock, newsletter and audience',
    'Change stock, mark orders packed, shipped or delivered, and add notes',
  ],
};
const CANT = 'It can’t refund or cancel orders, approve or reject competition teams, change store settings or staff, or delete anything: those stay with you in the admin.';

export default function ConnectClaude({ me }: { me: Me }) {
  const params = Object.fromEntries(new URLSearchParams(window.location.search));
  const [info, setInfo] = useState<{ app: string; email: string; role: Me['role'] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);

  useEffect(() => {
    document.title = 'Connect Claude — Elden Academic Press';
    adminApi<{ app: string; email: string; role: Me['role'] }>(`/mcp/request${window.location.search}`)
      .then(setInfo)
      .catch((e) => {
        // Something the app got wrong (no PKCE…): the error goes back to the app, as OAuth expects.
        if (e instanceof ApiError && e.code === 'oauth_redirect') window.location.assign((e.details as { redirect: string }).redirect);
        else setErr(errorMessage(e));
      });
  }, []);

  const decide = async (choice: 'allow' | 'deny') => {
    setBusy(choice);
    try {
      const r = await adminApi<{ redirect: string }>(choice === 'allow' ? '/mcp/approve' : '/mcp/deny', { body: params });
      window.location.assign(r.redirect);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(null);
    }
  };

  const app = info?.app && info.app !== 'Unnamed app' ? info.app : 'An app';
  return (
    <div className="ad-gate">
      <div className="ad-gate__card ad-connect">
        <img src="/assets/elden-mark.png" alt="" className="ad-gate__mark" />
        <div className="ad-gate__brand">Elden Academic Press · Admin</div>
        {err ? (
          <>
            <h1>Can’t connect</h1>
            <p>{err}</p>
            <a className="ad-btn ad-btn--secondary" href="/admin">Go to the admin</a>
          </>
        ) : !info ? <Loading /> : (
          <>
            <h1>Connect {app}?</h1>
            <p><b>{app}</b> wants to work in the store as you, <b>{me.email}</b> ({info.role}). It will be able to:</p>
            <ul className="ad-connect__list">{CAN[info.role].map((x) => <li key={x}>{x}</li>)}</ul>
            <p className="ad-muted">{CANT} Every change it makes appears in the activity log as “via {app === 'An app' ? 'the app' : app}”. You can disconnect it any time in Settings → Claude.</p>
            <Btn kind="primary" busy={busy === 'allow'} disabled={Boolean(busy)} onClick={() => decide('allow')}>Allow</Btn>
            <Btn busy={busy === 'deny'} disabled={Boolean(busy)} onClick={() => decide('deny')}>Cancel</Btn>
            <button type="button" className="ad-link" onClick={() => signOut().then(() => window.location.reload())}>Not {me.email}? Sign out</button>
          </>
        )}
      </div>
    </div>
  );
}
