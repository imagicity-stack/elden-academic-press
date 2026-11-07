// Admin → Competitions: each competition built on request appears here by itself, with
// everyone who registered (one person or a group) and a CSV export.
import { Link, useNavigate, useParams } from 'react-router-dom';
import { downloadFile, fmtDate, useAdmin } from '../api';
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Page, type Tone, useAction } from '../ui';
import { findCompetition, istDateTime, PHASE_LABEL, type Phase } from '../../shared/competitions';
import { TeamApplication, TeamCompetition } from './TeamCompetition';

interface Row {
  slug: string; title: string; tagline: string; opensAt: string; closesAt: string; phase: Phase; unlisted: boolean; modes: string[]; registrations: number; groups: number; people: number;
  team: boolean; applications: number; pending: number; approved: number;
}
const TONE: Record<Phase, Tone> = { open: 'green', upcoming: 'amber', closed: 'grey' };

export default function Competitions() {
  const { slug, id } = useParams();
  if (!slug) return <List />;
  if (findCompetition(slug)?.team) return id ? <TeamApplication slug={slug} id={id} /> : <TeamCompetition slug={slug} />;
  return <Registrations slug={slug} />;
}

function List() {
  const { data, error, reload } = useAdmin<{ items: Row[] }>('/competitions');
  const navigate = useNavigate();
  return (
    <Page title="Competitions" subtitle="Every competition on the website, with the people who registered. New competitions are added on request and appear here by themselves.">
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? (
        <Card><Empty title="No competitions yet.">When a competition is added to the website, it shows up here with its registrations.</Empty></Card>
      ) : (
        <Card flush>
          <div className="ad-table-wrap">
            <table className="ad-table ad-table--click">
              <thead><tr><th>Competition</th><th>Status</th><th>Registration</th><th className="ad-num">Registrations</th><th className="ad-num">People</th></tr></thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.slug} onClick={() => navigate(`/admin/competitions/${c.slug}`)}>
                    <td><Link to={`/admin/competitions/${c.slug}`} className="ad-strong" onClick={(e) => e.stopPropagation()}>{c.title}</Link><div className="ad-muted">{c.tagline}{c.unlisted && ' · not listed on the website'}</div></td>
                    <td><Badge tone={TONE[c.phase]}>{PHASE_LABEL[c.phase]}</Badge></td>
                    <td className="ad-muted">{istDateTime(c.opensAt)}<br />to {istDateTime(c.closesAt)}</td>
                    {c.team ? (
                      <>
                        <td className="ad-num">{c.applications} teams{c.pending > 0 && <div><Badge tone="amber">{c.pending} to check</Badge></div>}</td>
                        <td className="ad-num ad-strong">{c.approved} approved</td>
                      </>
                    ) : (
                      <>
                        <td className="ad-num">{c.registrations}{c.groups > 0 && <div className="ad-muted">{c.groups} groups</div>}</td>
                        <td className="ad-num ad-strong">{c.people}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Page>
  );
}

interface Detail {
  competition: { slug: string; title: string; opensAt: string; closesAt: string; phase: Phase; unlisted: boolean };
  questions: { key: string; label: string }[];
  personFields: { key: string; label: string }[];
  items: {
    id: string; ref: string; createdAt: string; mode: 'individual' | 'group'; groupName: string; answers: Record<string, string>;
    participants: Record<string, string>[]; names: string[];
    by: { name: string; email: string; phone: string; city: string; state: string; type: string };
  }[];
}

function Registrations({ slug }: { slug: string }) {
  const { data, error, reload } = useAdmin<Detail>(`/competitions/${slug}`);
  const { busy, run } = useAction();
  const c = data?.competition;
  return (
    <Page title={c?.title ?? 'Competition'} back={{ to: '/admin/competitions', label: 'Competitions' }}
      subtitle={c ? <><Badge tone={TONE[c.phase]}>{PHASE_LABEL[c.phase]}</Badge> {istDateTime(c.opensAt)} to {istDateTime(c.closesAt)} · <a href={`/competitions/${c.slug}`} target="_blank" rel="noreferrer">View on the website ↗</a></> : undefined}
      actions={data && data.items.length > 0 && <Btn busy={busy === 'csv'} onClick={() => run('csv', () => downloadFile(`/competitions/${slug}/export.csv`, `${slug}-registrations.csv`))}>Export CSV</Btn>}>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? (
        <Card><Empty title="No registrations yet." /></Card>
      ) : (
        <Card flush title={`${data.items.length} registration${data.items.length === 1 ? '' : 's'} · ${data.items.reduce((n, x) => n + x.participants.length, 0)} people`}>
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead>
                <tr><th>Registered</th><th>Taking part</th>{data.questions.map((q) => <th key={q.key}>{q.label}</th>)}<th>Registered by</th></tr>
              </thead>
              <tbody>
                {data.items.map((x) => (
                  <tr key={x.id}>
                    <td className="ad-muted">{fmtDate(x.createdAt, true)}<div>{x.ref}</div></td>
                    <td>
                      {x.mode === 'group' && <div className="ad-strong">Group: {x.groupName}</div>}
                      <ul className="ad-comp-people">
                        {x.participants.map((p, i) => (
                          <li key={i}>{data.personFields.map((f) => p[f.key]).filter(Boolean).join(' · ')}</li>
                        ))}
                      </ul>
                    </td>
                    {data.questions.map((q) => <td key={q.key}>{x.answers[q.key] ?? ''}</td>)}
                    <td>
                      <div className="ad-strong">{x.by.name}</div>
                      <div className="ad-muted">{[x.by.type, x.by.city, x.by.state].filter(Boolean).join(' · ')}</div>
                      <div><a href={`mailto:${x.by.email}`}>{x.by.email}</a></div>
                      {x.by.phone && <div><a href={`https://wa.me/91${x.by.phone}`} target="_blank" rel="noreferrer">WhatsApp {x.by.phone}</a></div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Page>
  );
}
