// /competitions — Open, Upcoming and Past, filter by class, "Eligible for Riya" badges.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../store/api';
import { hasAccountSession } from '../store/account';
import { noteAccountType, profileApi, type ProfileStudent } from '../store/profile';
import { arrival, classesLabel, type CompetitionCard } from '../store/competitions';
import { CLASSES, groupForClass, listTab, regionAllows, STATUS_LABEL, TYPE_LABEL } from '../shared/competition';
import { Countdown, nextMoment } from '../components/Countdown';

type Tab = 'open' | 'upcoming' | 'past';

export function CompetitionList() {
  const [items, setItems] = useState<CompetitionCard[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kids, setKids] = useState<ProfileStudent[]>([]);
  const [tab, setTab] = useState<Tab>('open');
  const [cls, setCls] = useState('');
  useEffect(() => {
    document.title = 'Competitions — Elden Academic Press';
    arrival();
    api<{ items: CompetitionCard[] }>('/competitions').then((r) => setItems(r.items), (e) => setErr((e as Error).message));
    if (hasAccountSession()) profileApi('').then((p) => { noteAccountType(p.account.type); setKids(p.students); }).catch(() => {});
  }, []);
  const counts = useMemo(() => {
    const c = { open: 0, upcoming: 0, past: 0 };
    for (const i of items ?? []) { const t = listTab(i.status); if (t) c[t]++; }
    return c;
  }, [items]);
  useEffect(() => { if (items && counts.open === 0 && counts.upcoming > 0) setTab('upcoming'); }, [items, counts]);
  const shown = (items ?? []).filter((i) => listTab(i.status) === tab && (!cls || groupForClass(i.groups, Number(cls))));

  return (
    <div className="wrap cp-page cp-list-page">
      <header className="cp-list-head">
        <div className="t-label">For students, Classes 3–12</div>
        <h1 className="t-h2">Competitions</h1>
        <p className="t-lead">Draw, write and create. Register once with a parent’s approval, then join any competition in a few taps.</p>
      </header>
      <div className="cp-list-bar">
        <div className="tabs" role="tablist">
          {(['open', 'upcoming', 'past'] as Tab[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={'tab' + (tab === k ? ' is-on' : '')} onClick={() => setTab(k)}>
              {k === 'open' ? 'Open' : k === 'upcoming' ? 'Upcoming' : 'Past'} · {counts[k]}
            </button>
          ))}
        </div>
        <label className="cp-filter">Class
          <select className="input" value={cls} onChange={(e) => setCls(e.target.value)}>
            <option value="">All</option>{CLASSES.map((n) => <option key={n} value={n}>Class {n}</option>)}
          </select>
        </label>
      </div>
      {err && <div className="form-error">{err}</div>}
      {!items && !err && <div className="cp-cards" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton skeleton--cover" />)}</div>}
      {items && shown.length === 0 && (
        <div className="cp-card cp-empty">
          <h2 className="cp-h3">{tab === 'open' ? 'Nothing open right now.' : tab === 'upcoming' ? 'Nothing announced yet.' : 'No past competitions yet.'}</h2>
          <p className="cp-muted">New competitions are announced in our newsletter and on WhatsApp.</p>
        </div>
      )}
      <ul className="cp-cards">
        {shown.map((c) => {
          const eligible = kids.filter((k) => k.approvalStatus !== 'declined' && groupForClass(c.groups, k.classGrade) && regionAllows(c, k.state));
          const next = nextMoment(c.status, c.dates);
          const img = c.squareUrl ?? c.bannerUrl ?? c.thumbnailUrl;
          return (
            <li key={c.id}>
              <Link to={`/competitions/${c.slug}`} className="cp-ccard">
                <div className="cp-ccard__img">{img ? <img src={img} alt="" loading="lazy" /> : <span aria-hidden="true">{TYPE_LABEL[c.type as keyof typeof TYPE_LABEL] ?? ''}</span>}
                  <span className={'cp-badge cp-ccard__status' + (listTab(c.status) === 'open' ? ' cp-badge--live' : '')}>{STATUS_LABEL[c.status]}</span>
                </div>
                <div className="cp-ccard__body">
                  <h2 className="cp-h3">{c.title}</h2>
                  {c.tagline && <p className="cp-muted">{c.tagline}</p>}
                  <div className="cp-ccard__meta">{classesLabel(c.groups)}{c.regionScope === 'states' ? ' · selected states' : ''}</div>
                  {next.to && <Countdown to={next.to} label={next.label} />}
                  {eligible.length > 0 && <div className="cp-ccard__elig">{eligible.map((k) => <span key={k.id} className="cp-badge cp-badge--ok">Eligible{k.relation === 'parent' ? ` for ${k.firstName}` : ''}</span>)}</div>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
