// DoomsDay Diaries: the competition's own comic-book page inside the site (same header,
// footer, sign-in and account). Content comes from content.ts (the official rules); the
// banner, artwork, sponsors, official PDFs, notices and results come from the admin.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../store/api';
import { authApi, useAccount } from '../../store/account';
import { findCompetition, istDateTime, type Competition } from '../../shared/competitions';
import { dayLabel, type TeamConfig } from '../../shared/teams';
import { RichText } from '../../components/RichText';
import { Countdown } from '../../components/Countdown';
import { NotFound } from '../NotFound';
import { TeamArea, type TeamData } from './TeamArea';
import * as T from './content';

type TeamComp = Competition & { team: TeamConfig };
interface Info {
  registration: { open: boolean; reason: string };
  dates: { opensAt: string; closesAt: string; submissionDeadline: string; resultsOn: string };
  bannerUrl: string | null; artUrl: string | null; sponsorUrls: (string | null)[]; rulesDocUrl: string | null; topicDocUrl: string | null;
  notices: { id: string; title: string; body: string; createdAt: string }[];
  resultsPublished: boolean; results: { team: string; category: string; result: string; credit: string }[];
}
const RESULT_ORDER = ['first', 'second', 'third', 'peoples_choice'];
const RESULT_LABEL: Record<string, string> = { first: '1st', second: '2nd', third: '3rd', peoples_choice: 'People’s Choice' };

export function useCompetitionInfo(slug: string) {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => { api<Info>(`/competition-info/${slug}`).then(setInfo, () => setInfo(null)); }, [slug]);
  return info;
}

export function DoomsdayPage({ c }: { c: TeamComp }) {
  const info = useCompetitionInfo(c.slug);
  useEffect(() => { document.title = `${c.title}: Comic Creating Challenge — Elden Academic Press`; }, [c.title]);
  const deadline = info?.dates.submissionDeadline ?? c.team.submissionDeadline;
  const results = info?.dates.resultsOn ?? c.team.resultsOn;
  const sponsors = (info?.sponsorUrls ?? []).filter((x): x is string => Boolean(x));
  return (
    <div className="dd">
      <section className="dd-hero">
        <div className="wrap dd-hero__grid">
          <div className="dd-hero__text">
            <div className="dd-caption">Elden Academic Press presents</div>
            <h1 className="dd-title"><span>DoomsDay</span> <span>Diaries</span></h1>
            <div className="dd-sub">Comic Creating Challenge · <b>{T.TOPIC}</b></div>
            <p className="dd-hook">{T.HOOK}</p>
            <div className="dd-hero__cta">
              <a href="#team" className="btn dd-btn dd-btn--big">{info && !info.registration.open ? 'Your team' : 'Register your team'}</a>
              <Link to={`/competitions/${c.slug}/rules`} className="dd-link-light">Read the rules</Link>
            </div>
            <Countdown to={deadline} label="Submissions close in" />
          </div>
          <div className="dd-hero__art">
            {info?.bannerUrl ? <img src={info.bannerUrl} alt={`${c.title}: ${T.TOPIC}`} className="dd-banner" /> : <HeroArt />}
            <div className="dd-bubble dd-bubble--hero">“24 HOURS. THEN YOUR TOWN IS MINE.”</div>
          </div>
        </div>
      </section>

      <section className="wrap dd-facts" aria-label="At a glance">
        {[['Ages', '8 to 24'], ['Where', 'Across India'], ['Entry', 'Free'], ['Teams', '2 to 4 members'], ['Deadline', `${dayLabel(deadline.slice(0, 10))}, 11:59 PM IST`], ['Results', dayLabel(results)]].map(([k, v]) => (
          <div key={k} className="dd-fact"><span>{k}</span><b>{v}</b></div>
        ))}
      </section>

      {info && info.notices.length > 0 && (
        <section className="wrap dd-section" aria-labelledby="dd-news">
          <h2 id="dd-news" className="dd-h2"><span>Announcements</span></h2>
          <div className="dd-announce">
            {info.notices.map((n) => <article key={n.id} className="dd-panel"><div className="dd-card__kicker">{istDateTime(n.createdAt)}</div><h3 className="dd-h3">{n.title}</h3><p className="dd-pre">{n.body}</p></article>)}
          </div>
        </section>
      )}

      {info?.resultsPublished && info.results.length > 0 && (
        <section className="wrap dd-section" aria-labelledby="dd-results">
          <h2 id="dd-results" className="dd-h2"><span>Results</span></h2>
          <div className="dd-groups">
            {c.team.groups.map((g) => {
              const won = info.results.filter((r) => r.category === g.key).sort((a, b) => RESULT_ORDER.indexOf(a.result) - RESULT_ORDER.indexOf(b.result));
              return won.length ? (
                <div key={g.key} className="dd-panel dd-winners">
                  <h3 className="dd-h3">{g.label}</h3>
                  <ol>{won.map((r) => <li key={r.team}><span className="dd-medal">{RESULT_LABEL[r.result]}</span><b>{r.team}</b><small>{r.credit}</small></li>)}</ol>
                </div>
              ) : null;
            })}
          </div>
        </section>
      )}

      <section className="wrap dd-section dd-brief" aria-labelledby="dd-brief">
        <h2 id="dd-brief" className="dd-h2"><span>The brief</span></h2>
        <div className="dd-brief__grid">
          <div className="dd-panel dd-panel--dark">
            <p className="dd-brief__lead">{T.BRIEF_LEAD}</p>
            <p>{T.BRIEF}</p>
          </div>
          <div className="dd-panel">
            <h3 className="dd-h3">Your comic must include</h3>
            <RichText text={T.BRIEF_MUST} className="dd-rich" />
          </div>
        </div>
      </section>

      <section className="wrap dd-section" aria-labelledby="dd-groups">
        <h2 id="dd-groups" className="dd-h2"><span>Four age groups</span></h2>
        <p className="dd-lead">A team’s group is set by the age of its oldest member on {dayLabel(c.team.ageOn)}. Members under 18 and members aged 18 or above can’t be on the same team.</p>
        <div className="dd-groups">
          {c.team.groups.map((g, i) => (
            <div key={g.key} className={`dd-groupcard dd-groupcard--${i}`}><b>{g.label}</b><span>Ages {g.min} to {g.max}</span></div>
          ))}
        </div>
      </section>

      <section className="wrap dd-section" aria-labelledby="dd-rules">
        <h2 id="dd-rules" className="dd-h2"><span>The rules in short</span></h2>
        <div className="dd-panel"><RichText text={T.RULES_SHORT} className="dd-rich dd-rules" /></div>
        <p className="dd-lead">By registering, every team member agrees to these rules and to the <Link to={`/competitions/${c.slug}/rules`}>full rules and terms</Link>.</p>
      </section>

      <section className="wrap dd-section" aria-labelledby="dd-dates">
        <h2 id="dd-dates" className="dd-h2"><span>Key dates</span></h2>
        <ol className="dd-timeline">{T.KEY_DATES.map(([k, v]) => <li key={k}><b>{v}</b><span>{k}</span></li>)}</ol>
        <p className="dd-small">All times are Indian Standard Time. Late entries are not accepted. The Organiser may extend a date by notice on eldenap.in and the official Instagram page.</p>
      </section>

      <div className="wrap"><TeamArea c={c} /></div>

      <section className="wrap dd-section" aria-labelledby="dd-format">
        <h2 id="dd-format" className="dd-h2"><span>Comic format</span></h2>
        <div className="dd-brief__grid">
          <div className="dd-panel"><h3 className="dd-h3">Pages</h3><RichText text={T.PAGES} className="dd-rich" /></div>
          <div className="dd-panel"><h3 className="dd-h3">Files</h3><RichText text={T.FILES} className="dd-rich" /></div>
        </div>
      </section>

      <section className="wrap dd-section" aria-labelledby="dd-judging">
        <h2 id="dd-judging" className="dd-h2"><span>Judging and prizes</span></h2>
        <div className="dd-brief__grid">
          <div className="dd-panel">
            <h3 className="dd-h3">Marks out of 100</h3>
            <ul className="dd-bars">{T.CRITERIA.map(([k, n]) => <li key={k}><span>{k}</span><b>{n}</b><i style={{ width: `${(n / 30) * 100}%` }} /></li>)}</ul>
            <p className="dd-small">Judged within each age group; story carries more marks than drawing. Top 10 teams per group are shortlisted on 10 December.</p>
          </div>
          <div className="dd-panel">
            <h3 className="dd-h3">Prizes, in every age group</h3>
            <dl className="dd-prizes">{T.PRIZES.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </div>
        </div>
      </section>

      {(info?.artUrl || sponsors.length > 0) && (
        <section className="wrap dd-section">
          {info?.artUrl && <img src={info.artUrl} alt={`${c.title} artwork`} className="dd-art" loading="lazy" />}
          {sponsors.length > 0 && (
            <div className="dd-sponsors"><span>With thanks to</span>{sponsors.map((u) => <img key={u} src={u} alt="Sponsor" loading="lazy" />)}</div>
          )}
        </section>
      )}

      <section className="wrap dd-section dd-docs" aria-labelledby="dd-docs">
        <h2 id="dd-docs" className="dd-h2"><span>Official documents</span></h2>
        <div className="dd-doclinks">
          <Link to={`/competitions/${c.slug}/rules`} className="dd-doc">Rules and terms<small>Full text on this site</small></Link>
          {info?.rulesDocUrl && <a href={info.rulesDocUrl} target="_blank" rel="noreferrer" className="dd-doc">Official rules (PDF)<small>Download</small></a>}
          {info?.topicDocUrl && <a href={info.topicDocUrl} target="_blank" rel="noreferrer" className="dd-doc">The topic (document)<small>Download</small></a>}
          <a href={`https://www.instagram.com/${c.instagram}/`} target="_blank" rel="noreferrer" className="dd-doc">@{c.instagram}<small>Official Instagram · {T.HASHTAG}</small></a>
        </div>
        <p className="dd-small">Doctor Doom is a character and trademark of Marvel. This competition is not affiliated with, sponsored or endorsed by Marvel Studios, Marvel Entertainment or The Walt Disney Company, nor by Instagram or Meta. Questions: hello@eldenap.in.</p>
      </section>
    </div>
  );
}

/** Full rules and terms on their own page (printable). */
export function CompetitionRules() {
  const { slug = '' } = useParams();
  const c = findCompetition(slug);
  const info = useCompetitionInfo(slug);
  useEffect(() => { if (c) document.title = `Rules and terms: ${c.title} — Elden Academic Press`; }, [c]);
  if (!c?.team) return <NotFound />;
  const S = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="dd-rulesec"><h2 className="dd-h3">{title}</h2>{children}</section>;
  return (
    <div className="dd dd-doc-page wrap">
      <Link to={`/competitions/${c.slug}`} className="dd-back">← {c.title}</Link>
      <h1 className="dd-title dd-title--page"><span>{T.TOPIC}</span></h1>
      <p className="dd-lead">Terms and Conditions and Official Rules · {c.title}: Comic Creating Challenge</p>
      <div className="dd-doc-actions">
        <button type="button" className="btn btn--outline btn--sm" onClick={() => window.print()}>Print or save as PDF</button>
        {info?.rulesDocUrl && <a href={info.rulesDocUrl} target="_blank" rel="noreferrer" className="btn btn--outline btn--sm">Official PDF</a>}
      </div>
      <S title="The rules in short"><p>{T.HOOK}</p><RichText text={T.RULES_SHORT} className="dd-rich" /><p>By registering, every team member agrees to these rules and to the Terms and Conditions below.</p></S>
      <S title="Key dates"><table className="dd-table"><thead><tr><th>Stage</th><th>Date and time (IST)</th></tr></thead><tbody>{T.KEY_DATES.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
        <p>Late entries are not accepted. The Organiser may extend a date by notice on eldenap.in and the official Instagram page.</p></S>
      <S title="Who can enter"><p>{T.WHO_CAN_ENTER}</p><h3 className="dd-h4">Age groups</h3><p>A team’s group is set by the age of its oldest member on 6 November 2026.</p>
        <table className="dd-table"><thead><tr><th>Group</th><th>Age</th></tr></thead><tbody>{c.team.groups.map((g) => <tr key={g.key}><td>{g.label}</td><td>{g.min} to {g.max}</td></tr>)}</tbody></table></S>
      <S title="Teams and roles"><RichText text={T.TEAMS_AND_ROLES} className="dd-rich" /></S>
      <S title="Profiles and checks"><RichText text={T.PROFILES_AND_CHECKS} className="dd-rich" /></S>
      <S title="The brief"><p><b>{T.BRIEF_LEAD}</b></p><p>{T.BRIEF}</p><p>Your comic must include:</p><RichText text={T.BRIEF_MUST} className="dd-rich" /></S>
      <S title="Comic format and submission"><p>Every comic must have at least 40 story pages and must be uploaded by 5 December 2026, 11:59 PM IST.</p>
        <h3 className="dd-h4">Pages</h3><RichText text={T.PAGES} className="dd-rich" /><h3 className="dd-h4">Files</h3><RichText text={T.FILES} className="dd-rich" /></S>
      <S title="Follow us on Instagram"><RichText text={T.INSTAGRAM_RULES} className="dd-rich" /></S>
      <S title="Originality, AI and content rules"><p>Doctor Doom is the only existing character allowed; everything else in the comic must be the team’s own work.</p>
        <h3 className="dd-h4">Original work</h3><RichText text={T.ORIGINAL} className="dd-rich" /><h3 className="dd-h4">No AI</h3><RichText text={T.NO_AI} className="dd-rich" />
        <h3 className="dd-h4">Clean content</h3><RichText text={T.CLEAN} className="dd-rich" /></S>
      <S title="Judging, shortlist and People’s Choice"><p>Entries are judged out of 100 within their own age group, and story carries more marks than drawing.</p>
        <table className="dd-table"><thead><tr><th>Criterion</th><th>Marks</th></tr></thead><tbody>{T.CRITERIA.map(([k, n]) => <tr key={k}><td>{k}</td><td>{n}</td></tr>)}<tr><td><b>Total</b></td><td><b>100</b></td></tr></tbody></table>
        <RichText text={T.JUDGING} className="dd-rich" /></S>
      <S title="Prizes"><p>Each of the 4 age groups has 3 winning teams and 1 People’s Choice team, and every member of a valid entry gets an e-certificate.</p>
        <table className="dd-table"><thead><tr><th>Award (per age group)</th><th>Prize</th></tr></thead><tbody>{T.PRIZES.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
        <RichText text={T.PRIZE_RULES} className="dd-rich" /></S>
      <S title="Terms and Conditions"><p>By registering, every team member agrees to these Terms and to the rules above.</p>
        {T.TERMS.map(([h, body]) => <div key={h}><h3 className="dd-h4">{h}</h3><RichText text={body} className="dd-rich" /></div>)}</S>
    </div>
  );
}

/** A printable registration confirmation for an approved team. */
export function TeamConfirmation() {
  const { slug = '', id = '' } = useParams();
  const c = findCompetition(slug);
  const { state } = useAccount();
  const [data, setData] = useState<TeamData | null>(null);
  useEffect(() => { if (state.status === 'ready' && c?.team) authApi<TeamData>(`/competitions/${slug}/team`).then(setData, () => setData(null)); }, [state.status, slug, c]);
  if (!c?.team) return <NotFound />;
  const app = data?.applications.find((a) => a.id === id);
  const role = (k: string) => c.team!.roles.find((r) => r.key === k)?.label ?? k;
  return (
    <div className="dd wrap dd-doc-page">
      <Link to={`/competitions/${c.slug}#team`} className="dd-back">← Your team</Link>
      {state.status !== 'ready' ? <p className="dd-lead">Sign in to see your team’s confirmation.</p>
        : !data ? <div className="skeleton dd-skel" />
        : !app || app.status !== 'approved' ? <p className="dd-lead">The confirmation is available once the team is approved.</p> : (
          <article className="dd-cert">
            <div className="dd-caption">Registration confirmed</div>
            <h1 className="dd-title dd-title--page"><span>{c.title}</span></h1>
            <p className="dd-sub">Comic Creating Challenge · {T.TOPIC}</p>
            <dl className="dd-review">
              <div><dt>Team</dt><dd>{app.teamName}</dd></div>
              <div><dt>Application ID</dt><dd>{app.code}</dd></div>
              <div><dt>Age group</dt><dd>{app.categoryLabel}</dd></div>
              <div><dt>From</dt><dd>{app.institutionName || 'Other institutions'} · {app.city}, {app.stateName}</dd></div>
              {app.members.map((m, i) => <div key={i}><dt>{m.captain ? 'Captain' : `Member ${i + 1}`}</dt><dd>{m.fullName} · {m.roles.map(role).join(', ')}</dd></div>)}
              <div><dt>Approved</dt><dd>{app.reviewedAt ? istDateTime(app.reviewedAt) : ''}</dd></div>
              <div><dt>Submission deadline</dt><dd>{istDateTime(data.dates.submissionDeadline)}</dd></div>
            </dl>
            <p className="dd-small">Elden Academic Press, the publishing imprint of The Elden Heights School, Silwar, Hazaribagh, Jharkhand · eldenap.in · hello@eldenap.in</p>
            <button type="button" className="btn dd-btn dd-noprint" onClick={() => window.print()}>Print or save as PDF</button>
          </article>
        )}
    </div>
  );
}

/** Original art: a town at midnight under a cracked sky, a clock at 24:00, one hero on a rooftop. */
function HeroArt() {
  return (
    <svg className="dd-art-svg" viewBox="0 0 600 440" role="img" aria-label="A town at midnight under a cracked green sky, a clock showing 24:00, and a caped hero on a rooftop">
      <defs>
        <linearGradient id="dd-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#06140d" /><stop offset=".7" stopColor="#163a28" /><stop offset="1" stopColor="#2a5a3d" /></linearGradient>
        <radialGradient id="dd-glow" cx=".55" cy=".22" r=".55"><stop offset="0" stopColor="#d9ff4d" stopOpacity=".75" /><stop offset="1" stopColor="#d9ff4d" stopOpacity="0" /></radialGradient>
        <pattern id="dd-dots" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1.5" fill="#d9ff4d" opacity=".22" /></pattern>
      </defs>
      <rect width="600" height="440" fill="url(#dd-sky)" />
      <rect width="600" height="440" fill="url(#dd-glow)" />
      <rect width="600" height="300" fill="url(#dd-dots)" />
      <g stroke="#eaff6b" strokeWidth="6" fill="none" strokeLinejoin="bevel" strokeLinecap="square">
        <path d="M150 0 L205 48 L182 78 L250 108 L226 142 L306 168 L286 196 L352 214" />
        <path d="M250 108 L300 96 L330 116" strokeWidth="4" />
        <path d="M226 142 L188 170" strokeWidth="3" />
        <path d="M306 168 L366 150 L410 168" strokeWidth="4" />
      </g>
      <g stroke="#ffffff" strokeWidth="2" fill="none" opacity=".75">
        <path d="M150 0 L205 48 L182 78 L250 108 L226 142 L306 168 L286 196 L352 214" />
      </g>
      {/* The town */}
      <g fill="#0B1220">
        <rect x="0" y="330" width="600" height="110" />
        <rect x="18" y="268" width="70" height="72" />
        <rect x="96" y="240" width="54" height="100" />
        <path d="M168 340 V262 h60 v78 z" />
        {/* water tank */}
        <rect x="246" y="236" width="56" height="34" rx="6" />
        <rect x="252" y="270" width="6" height="70" /><rect x="290" y="270" width="6" height="70" /><rect x="268" y="270" width="6" height="70" />
        {/* clock tower */}
        <rect x="320" y="196" width="58" height="144" />
        <path d="M314 196 L349 160 L384 196 z" />
        {/* temple shikhara */}
        <path d="M402 340 V284 Q420 266 430 232 Q440 266 458 284 V340 z" />
        <rect x="427" y="218" width="6" height="16" />
        <rect x="470" y="256" width="62" height="84" />
        <rect x="540" y="286" width="60" height="54" />
      </g>
      {/* lit windows */}
      <g fill="#FFD84D" opacity=".9">
        {[[30, 284], [58, 284], [30, 308], [108, 258], [126, 282], [108, 306], [184, 280], [206, 304], [484, 272], [510, 296], [484, 318], [556, 300]].map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="10" height="12" />)}
      </g>
      {/* the clock: 24:00 */}
      <rect x="328" y="210" width="42" height="22" fill="#d9ff4d" />
      <text x="349" y="226" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="14" fontWeight="700" fill="#0B1220">24:00</text>
      {/* the hero, cape in the wind, on the tower top */}
      <g fill="#FF3B1F" stroke="#0B1220" strokeWidth="3" strokeLinejoin="round">
        <path d="M110 238 C88 222 70 230 56 214 C76 216 86 206 100 210 Z" />
      </g>
      <g fill="#0B1220">
        <circle cx="122" cy="200" r="9" />
        <path d="M114 210 h16 l4 30 h-8 l-2 -14 l-4 14 h-8 z" />
        <path d="M128 212 l18 -22 l5 4 l-17 24 z" />
      </g>
      <text x="470" y="80" fontFamily="Arial Black, Impact, sans-serif" fontSize="44" fill="#FFD84D" stroke="#0B1220" strokeWidth="3" transform="rotate(-8 470 80)" textAnchor="middle">KRAK!</text>
    </svg>
  );
}
