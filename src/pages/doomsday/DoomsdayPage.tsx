// DoomsDay Diaries: the competition's own comic-book page inside the site (same header,
// footer, sign-in and account). Kept short on purpose: the banner, the key facts, how it
// works, age groups, prizes and the team area. The rules show once you're signed in, and the
// story brief (the comic's title) only to approved teams, from the server. Banner, artwork,
// sponsors, notices and results come from the admin.
import { useEffect, useState, type ReactNode } from 'react';
import { trackStep } from '../../competitionTrack';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../store/api';
import { authApi, useAccount } from '../../store/account';
import { findCompetition, imageSrcSet, istDateTime, type Competition } from '../../shared/competitions';
import { dayLabel, type TeamConfig } from '../../shared/teams';
import { RichText } from '../../components/RichText';
import { Countdown } from '../../components/Countdown';
import { GoogleSignIn } from '../../components/GoogleSignIn';
import { NotFound } from '../NotFound';
import { StoryBriefPanel, TeamArea, type TeamData } from './TeamArea';
import * as T from './content';

type TeamComp = Competition & { team: TeamConfig };
interface Info {
  registration: { open: boolean; reason: string };
  dates: { opensAt: string; closesAt: string; submissionDeadline: string; resultsOn: string };
  bannerUrl: string | null; artUrl: string | null; sponsorUrls: (string | null)[];
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

/** The signed-in person's teams for this competition (with the brief and PDFs once a team is approved). */
function useTeamData(slug: string) {
  const { state, reload } = useAccount();
  const [data, setData] = useState<TeamData | null>(null);
  useEffect(() => { if (state.status === 'ready') authApi<TeamData>(`/competitions/${slug}/team`).then(setData, () => setData(null)); }, [state.status, slug]);
  return { state, reload, data };
}

/** The banner the admin uploaded, else the one in the code. */
function Banner({ c, info, className }: { c: TeamComp; info: Info | null; className: string }) {
  const alt = `${c.title}: comic book writing competition`;
  if (info?.bannerUrl) return <img src={info.bannerUrl} alt={alt} className={className} />;
  if (!c.image) return null;
  return (
    <img src={c.image} srcSet={imageSrcSet(c)} sizes="(min-width: 960px) 46vw, calc(100vw - 2rem)"
      width={1400} height={1050} alt={alt} className={className} fetchPriority="high" />
  );
}

export function DoomsdayPage({ c }: { c: TeamComp }) {
  const info = useCompetitionInfo(c.slug);
  const account = useAccount();
  const signedIn = account.state.status === 'ready';
  useEffect(() => { document.title = `${c.title}: Comic Creating Challenge — Elden Academic Press`; }, [c.title]);
  useEffect(() => { trackStep(c.slug, 'view'); }, [c.slug]);
  const deadline = info?.dates.submissionDeadline ?? c.team.submissionDeadline;
  const results = info?.dates.resultsOn ?? c.team.resultsOn;
  const sponsors = (info?.sponsorUrls ?? []).filter((x): x is string => Boolean(x));
  const ages = `${c.team.minAge} to ${c.team.maxAge}`;
  return (
    <div className="dd">
      <section className="dd-hero">
        <div className="wrap dd-hero__grid">
          <div className="dd-hero__text">
            <div className="dd-caption">Elden Academic Press presents</div>
            <h1 className="dd-title"><span>DoomsDay</span> <span>Diaries</span></h1>
            <div className="dd-sub">Comic Creating Challenge</div>
            <p className="dd-hook">{T.HOOK}</p>
            <div className="dd-hero__cta">
              <a href="#team" className="btn dd-btn dd-btn--big">{signedIn || (info && !info.registration.open) ? 'Your team' : 'Register your team'}</a>
            </div>
            <Countdown to={deadline} label="Submissions close in" />
          </div>
          <div className="dd-hero__art"><Banner c={c} info={info} className="dd-banner" /></div>
        </div>
      </section>

      <section className="wrap dd-facts" aria-label="At a glance">
        {[['Ages', ages], ['Teams', `${c.team.minMembers} to ${c.team.maxMembers} members`], ['Entry', 'Free'], ['Where', 'Across India'],
          ['Deadline', `${dayLabel(deadline.slice(0, 10))}, 11:59 PM IST`], ['Results', dayLabel(results)]].map(([k, v]) => (
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

      <section className="wrap dd-section" aria-labelledby="dd-how">
        <h2 id="dd-how" className="dd-h2"><span>How it works</span></h2>
        <ol className="dd-how">
          {T.STEPS.map(([k, v], i) => <li key={k} className="dd-panel"><em aria-hidden="true">{i + 1}</em><h3 className="dd-h3">{k}</h3><p className="dd-lead">{v}</p></li>)}
        </ol>
      </section>

      <section className="wrap dd-section dd-twin">
        <div aria-labelledby="dd-groups">
          <h2 id="dd-groups" className="dd-h2"><span>Age groups</span></h2>
          <div className="dd-groups">
            {c.team.groups.map((g, i) => <div key={g.key} className={`dd-groupcard dd-groupcard--${i}`}><b>{g.label}</b><span>Ages {g.min} to {g.max}</span></div>)}
          </div>
          <p className="dd-small">Your team’s group is set by its oldest member’s age on {dayLabel(c.team.ageOn)}.</p>
        </div>
        <div aria-labelledby="dd-prizes">
          <h2 id="dd-prizes" className="dd-h2"><span>Prizes</span></h2>
          <div className="dd-panel">
            <dl className="dd-prizes">{T.PRIZES.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </div>
          <p className="dd-small">In every age group.</p>
        </div>
      </section>

      <div className="wrap"><TeamArea c={c} account={account} /></div>

      {signedIn && (
        <section className="wrap dd-section" aria-labelledby="dd-rules">
          <h2 id="dd-rules" className="dd-h2"><span>The rules</span></h2>
          <div className="dd-twin dd-twin--rules">
            <div className="dd-panel"><RichText text={T.RULES_SHORT} className="dd-rich dd-rules" /></div>
            <div>
              <ol className="dd-timeline">{T.KEY_DATES.map(([k, v]) => <li key={k}><b>{v}</b><span>{k}</span></li>)}</ol>
              <p className="dd-small">All times are Indian Standard Time. Late entries are not accepted.</p>
            </div>
          </div>
          <p className="dd-lead dd-rules__more">Every team member agrees to these rules and to the <Link to={`/competitions/${c.slug}/rules`}>full rules and terms</Link> (page format, judging, originality and AI rules, privacy).</p>
        </section>
      )}

      {(info?.artUrl || sponsors.length > 0) && (
        <section className="wrap dd-section">
          {info?.artUrl && <img src={info.artUrl} alt={`${c.title} artwork`} className="dd-art" loading="lazy" />}
          {sponsors.length > 0 && (
            <div className="dd-sponsors"><span>With thanks to</span>{sponsors.map((u) => <img key={u} src={u} alt="Sponsor" loading="lazy" />)}</div>
          )}
        </section>
      )}

      <footer className="wrap dd-section dd-foot">
        <a href={`https://www.instagram.com/${c.instagram}/`} target="_blank" rel="noreferrer" className="dd-doc">@{c.instagram}<small>Official Instagram</small></a>
        <p className="dd-small">Questions: hello@eldenap.in. Doctor Doom is a character and trademark of Marvel. This competition is not affiliated with, sponsored or endorsed by Marvel Studios, Marvel Entertainment or The Walt Disney Company, nor by Instagram or Meta.</p>
      </footer>
    </div>
  );
}

/** Full rules and terms on their own page (printable), for signed-in people. Approved teams
 *  also see their story brief here, and the official PDF. */
export function CompetitionRules() {
  const { slug = '' } = useParams();
  const c = findCompetition(slug);
  const { state, reload, data } = useTeamData(slug);
  useEffect(() => { if (c) document.title = `Rules and terms: ${c.title} — Elden Academic Press`; }, [c]);
  if (!c?.team) return <NotFound />;
  const S = ({ title, children }: { title: string; children: ReactNode }) => <section className="dd-rulesec"><h2 className="dd-h3">{title}</h2>{children}</section>;
  const head = (
    <>
      <Link to={`/competitions/${c.slug}`} className="dd-back">← {c.title}</Link>
      <h1 className="dd-title dd-title--page"><span>Rules and terms</span></h1>
      <p className="dd-lead">Terms and Conditions and Official Rules · {c.title}: Comic Creating Challenge</p>
    </>
  );
  if (state.status === 'loading') return <div className="dd dd-doc-page wrap">{head}<div className="skeleton dd-skel" aria-busy="true" /></div>;
  if (state.status !== 'ready') {
    return (
      <div className="dd dd-doc-page wrap">
        {head}
        <div className="dd-panel dd-signin">
          <p className="dd-lead">Sign in with Google to read the full rules and register your team.</p>
          <GoogleSignIn onDone={reload} />
        </div>
      </div>
    );
  }
  return (
    <div className="dd dd-doc-page wrap">
      {head}
      <div className="dd-doc-actions">
        <button type="button" className="btn btn--outline btn--sm" onClick={() => window.print()}>Print or save as PDF</button>
        {data?.rulesDocUrl && <a href={data.rulesDocUrl} target="_blank" rel="noreferrer" className="btn btn--outline btn--sm">Official PDF</a>}
      </div>
      <S title="The rules in short"><RichText text={T.RULES_SHORT} className="dd-rich" /><p>By registering, every team member agrees to these rules and to the Terms and Conditions below.</p></S>
      <S title="Key dates"><table className="dd-table"><thead><tr><th>Stage</th><th>Date and time (IST)</th></tr></thead><tbody>{T.KEY_DATES.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
        <p>Late entries are not accepted. The Organiser may extend a date by notice on eldenap.in and the official Instagram page.</p></S>
      <S title="Who can enter"><p>{T.WHO_CAN_ENTER}</p><h3 className="dd-h4">Age groups</h3><p>A team’s group is set by the age of its oldest member on {dayLabel(c.team.ageOn)}.</p>
        <table className="dd-table"><thead><tr><th>Group</th><th>Age</th></tr></thead><tbody>{c.team.groups.map((g) => <tr key={g.key}><td>{g.label}</td><td>{g.min} to {g.max}</td></tr>)}</tbody></table></S>
      <S title="Teams and roles"><RichText text={T.TEAMS_AND_ROLES} className="dd-rich" /></S>
      <S title="Profiles and checks"><RichText text={T.PROFILES_AND_CHECKS} className="dd-rich" /></S>
      <S title="The story brief">{data?.brief ? <StoryBriefPanel brief={data.brief} /> : <p>The story brief is given to each team when its registration is approved, on the team’s page and by email.</p>}</S>
      <S title="Comic format and submission"><p>Every comic must have at least 40 story pages and must be uploaded by {istDateTime(data?.dates.submissionDeadline ?? c.team.submissionDeadline)}.</p>
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
  const { state, data } = useTeamData(slug);
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
            <p className="dd-sub">Comic Creating Challenge{data.brief ? ` · ${data.brief.title}` : ''}</p>
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
