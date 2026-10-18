import { useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { catalogueHref } from '../catalogue';
import { config } from '../config';
import { BOOKS, RES, TYPES, findBook } from '../data';
import { useSite } from '../site';
import { BookCard } from '../components/BookCard';
import { BookCover } from '../components/BookCover';
import { ElmasterMark } from '../components/Brand';
import { ResourceRow } from '../components/ResourceRow';

const HERO = [
  { id: 'm8', x: '4%', y: '14%', r: '-7deg', z: 1 },
  { id: 'neet', x: '30%', y: '4%', r: '0deg', z: 3 },
  { id: 'phy11', x: '56%', y: '16%', r: '7deg', z: 2 },
];

const QUICK: [string, string][] = [
  ['Class 10 sample papers', catalogueHref({ type: ['Practice Papers'], level: ['S'] })],
  ['NEET', catalogueHref({}, 'NEET')],
  ['JEE Main', catalogueHref({}, 'JEE')],
  ['CUET', catalogueHref({}, 'CUET')],
  ['Class 1–5', catalogueHref({ level: ['P'] })],
];

const TYPE_LINKS = [
  ...TYPES.map((t) => ({
    label: t === 'Study Guide' ? 'Study guides' : t === 'Practice Papers' ? 'Practice papers' : t + 's',
    count: BOOKS.filter((b) => b.ty === t).length,
    to: catalogueHref({ type: [t] }),
  })),
  { label: 'E-books', count: BOOKS.filter((b) => b.eb).length, to: catalogueHref({ format: ['E-book'] }) },
];

const ELM_FEATURES = [
  { t: 'Video lessons', d: 'Chapter-by-chapter, by Elden authors' },
  { t: 'Mock tests', d: 'Timed tests with instant analysis' },
  { t: 'Book companion', d: 'Scan the QR in any Elden title' },
  { t: 'For teachers', d: 'Assign work and track progress' },
];

export function Home() {
  const { openModal } = useSite();
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const paths = [
    { n: '01', t: 'School, Class 1–12', d: 'Textbooks, workbooks and revision guides for CBSE, ICSE and State Boards.', cta: 'Browse school books', go: () => navigate(catalogueHref({ level: ['P', 'M', 'S', 'SS'] })) },
    { n: '02', t: 'Competitive exams', d: 'Reference books and practice papers for JEE, NEET, CUET and UPSC.', cta: 'Browse exam prep', go: () => navigate(catalogueHref({ level: ['C'] })) },
    { n: '03', t: 'Teachers & schools', d: 'Inspection copies, teacher’s manuals and bulk orders for your school.', cta: 'Request a sample', go: () => openModal('sample') },
    { n: '04', t: 'Researchers & authors', d: 'Peer-reviewed journals, scholarly titles and proposals for new books.', cta: 'Publish with us', go: () => navigate('/about') },
  ];

  return (
    <div>
      <section className="hero">
        <div className="wrap hero__inner">
          <div className="hero__text">
            <div className="eyebrow eyebrow--hero">CBSE · ICSE · State Boards · Competitive exams</div>
            <h1 className="hero__title">Books that teach. Material that prepares.</h1>
            <p className="hero__lede">Textbooks, reference books, practice papers and journals for classrooms across India — written by teachers, reviewed by subject experts.</p>
            <form className="hero__search" role="search" onSubmit={(e) => { e.preventDefault(); navigate(catalogueHref({}, q)); }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, subject, class or exam" aria-label="Search the catalogue" />
              <button type="submit">Search</button>
            </form>
            <div className="hero__quick">
              <span className="hero__quick-label">Popular:</span>
              {QUICK.map(([label, to]) => <Link key={label} to={to} className="chip-link">{label}</Link>)}
            </div>
          </div>
          <div className="hero__books">
            <div className="hero__books-bg" />
            {HERO.map((h) => {
              const bk = findBook(h.id)!;
              return (
                <Link key={h.id} to={'/books/' + h.id} className="hero__book" aria-label={bk.t}
                  style={{ left: h.x, top: h.y, transform: `rotate(${h.r})`, zIndex: h.z } as CSSProperties}>
                  <BookCover book={bk} size="hero" />
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="wrap section section--no-bottom">
        <div className="section-head section-head--32">
          <h2 className="h2">Find what you need</h2>
          <p className="section-head__note">Start from where you are — a class, an exam, a classroom or a research desk.</p>
        </div>
        <div className="paths">
          {paths.map((p) => (
            <button key={p.n} type="button" className="path" onClick={p.go}>
              <span className="path__n">{p.n}</span>
              <span className="path__t">{p.t}</span>
              <span className="path__d">{p.d}</span>
              <span className="path__cta">{p.cta} →</span>
            </button>
          ))}
        </div>
        <div className="type-links">
          <span className="eyebrow eyebrow--11 eyebrow--tight">Browse by type</span>
          {TYPE_LINKS.map((tl) => (
            <Link key={tl.label} to={tl.to} className="type-link">{tl.label}<span>{tl.count}</span></Link>
          ))}
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head section-head--36">
          <div className="stack-12">
            <div className="eyebrow eyebrow--11">New this session</div>
            <h2 className="h2">Fresh off the press</h2>
          </div>
          <Link to="/catalogue" className="underline-link">View full catalogue →</Link>
        </div>
        <div className="grid-books grid-books--home">
          {BOOKS.filter((b) => b.nw && b.ty !== 'Journal').slice(0, 5).map((b) => <BookCard key={b.id} book={b} />)}
        </div>
      </section>

      <section className="band">
        <div className="wrap section hub-promo">
          <div className="hub-promo__text">
            <div className="eyebrow eyebrow--11">Study Hub · Free</div>
            <h2 className="h2 balance">Sample papers, notes and answer keys — free to download.</h2>
            <p className="body body--15 measure-440">Updated every session for students revising at home and teachers setting class tests.</p>
            <div><Link to="/study-hub" className="btn btn--navy">Open the Study Hub</Link></div>
          </div>
          <div className="hub-promo__list">
            {RES.slice(0, 5).map((r) => <ResourceRow key={r.id} r={r} compact />)}
          </div>
        </div>
      </section>

      <section className="elm">
        <div className="wrap elm__inner">
          <div className="elm__text">
            <div className="elm__eyebrow"><span className="dot dot--teal-light" />Our learning platform</div>
            <ElmasterMark className="elm__mark" />
            <p className="elm__lede">Every Elden book has a digital companion. Scan the QR code inside to continue on elmaster — video lessons, practice tests and progress tracking.</p>
            <div className="elm__features">
              {ELM_FEATURES.map((f) => (
                <div key={f.t} className="elm__feature"><span className="elm__feature-t">{f.t}</span><span className="elm__feature-d">{f.d}</span></div>
              ))}
            </div>
            <div className="elm__ctas">
              <a href={config.elmasterUrl} target="_blank" rel="noopener" className="elm__btn">Go to elmaster ↗</a>
              <a href={config.elmasterUrl} target="_blank" rel="noopener" className="elm__btn-ghost">elmaster for schools</a>
            </div>
          </div>
          {/* TODO: replace with a real elmaster screenshot */}
          <div className="elm__shot"><span>elmaster screenshot — app or dashboard</span></div>
        </div>
      </section>

      <section className="wrap section audience">
        <div className="audience__card audience__card--dark">
          <div className="eyebrow eyebrow--11 eyebrow--gold">For schools &amp; teachers</div>
          <h3 className="h3 h3--light">Evaluating books for next session?</h3>
          <p className="audience__p audience__p--light">Request inspection copies, teacher's manuals and bulk pricing for your school or coaching centre.</p>
          <div className="audience__ctas">
            <button type="button" className="btn btn--tan btn--md" onClick={() => openModal('sample')}>Request a sample</button>
            <Link to="/contact" className="btn btn--ghost-light btn--md">Find a distributor</Link>
          </div>
        </div>
        <div className="audience__card">
          <div className="eyebrow eyebrow--11">For authors &amp; researchers</div>
          <h3 className="h3">Write with Elden. Publish in our journals.</h3>
          <p className="audience__p">We work with teachers, subject experts and researchers on textbooks, reference works and peer-reviewed articles.</p>
          <div className="audience__ctas">
            <Link to="/about" className="btn btn--navy btn--md">Submit a proposal</Link>
            <Link to={catalogueHref({ type: ['Journal'] })} className="btn btn--outline btn--md">Browse journals</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
