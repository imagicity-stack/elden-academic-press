import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useMotionValue, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react';
import { catalogueHref } from '../catalogue';
import { config } from '../config';
import { inr } from '../store/api';
import { useCatalog, useResources, useStoreConfig } from '../store/catalog';
import { useSite } from '../site';
import type { Product } from '../store/types';
import { BookCard } from '../components/BookCard';
import { BookCover } from '../components/BookCover';
import { ElmasterMark } from '../components/Brand';
import { ResourceRow } from '../components/ResourceRow';
import { Arrow, CountUp, EASE, Highlight, Marquee, Reveal, Stagger, StaggerItem } from '../components/motion';

const QUICK: [string, string][] = [
  ['Class 10 sample papers', catalogueHref({ type: ['practice-papers'], level: ['S'] })],
  ['NEET', catalogueHref({}, 'NEET')],
  ['JEE Main', catalogueHref({}, 'JEE')],
  ['CUET', catalogueHref({}, 'CUET')],
  ['Class 1–5', catalogueHref({ level: ['P'] })],
];

const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'Hindi', 'Social Science', 'Accountancy', 'JEE', 'NEET', 'CUET', 'UPSC'];

const ELM_FEATURES = [
  { t: 'Video lessons', d: 'Chapter by chapter, by Elden authors' },
  { t: 'Mock tests', d: 'Timed tests with instant analysis' },
  { t: 'Book companion', d: 'Scan the QR in any Elden title' },
  { t: 'For teachers', d: 'Assign work and track progress' },
];

export function Home() {
  const { products } = useCatalog();
  const featured = products.filter((p) => p.featured);
  const hero = (featured.length >= 3 ? featured : products).slice(0, 3);
  const fresh = products.filter((p) => p.isNew && p.category?.slug !== 'journals');

  return (
    <div className="home">
      <Hero books={hero} />
      <div className="strip" aria-hidden="true">
        <Marquee speed={36}>
          {SUBJECTS.map((s) => <span key={s} className="strip__item">{s}<i>✦</i></span>)}
        </Marquee>
      </div>
      <Paths />
      {fresh.length > 0 && <Shelf books={fresh} />}
      <Contents />
      <HubBand />
      <Elmaster />
      <Audiences />
    </div>
  );
}

/* ---------------- Hero ---------------- */

const FAN = [
  { x: -150, r: -14, y: 40, z: 1 },
  { x: 0, r: 0, y: 0, z: 3 },
  { x: 150, r: 14, y: 40, z: 2 },
];

function Hero({ books }: { books: Product[] }) {
  const navigate = useNavigate();
  const { products } = useCatalog();
  const { items: resources } = useResources();
  const cfg = useStoreConfig();
  const [q, setQ] = useState('');
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const spread = useTransform(scrollYProgress, [0, 1], [1, 1.5]);
  const lift = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 16 });
  const sy = useSpring(py, { stiffness: 60, damping: 16 });

  return (
    <section ref={ref} className="hero" onPointerMove={(e) => {
      const r = e.currentTarget.getBoundingClientRect();
      px.set((e.clientX - r.left) / r.width - 0.5);
      py.set((e.clientY - r.top) / r.height - 0.5);
    }}>
      <div className="wrap hero__inner">
        <div className="hero__text">
          <motion.div className="t-label hero__kicker" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.1 }}>
            CBSE · ICSE · State Boards · Competitive exams
          </motion.div>
          <h1 className="t-display hero__title">
            <span className="split__mask"><motion.span className="split__word" initial={{ y: '105%' }} animate={{ y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.15 }}>Books that <Highlight delay={1}>teach.</Highlight></motion.span></span>
            <span className="split__mask"><motion.span className="split__word" initial={{ y: '105%' }} animate={{ y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.28 }}>Practice that</motion.span></span>
            <span className="split__mask"><motion.span className="split__word serif-i hero__serif" initial={{ y: '105%' }} animate={{ y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.41 }}>prepares.</motion.span></span>
          </h1>
          <motion.div className="hero__below" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE, delay: 0.6 }}>
            <p className="t-lead">Textbooks, reference books, practice papers and journals for classrooms across India, written by teachers and checked by subject experts.</p>
            <form className="hero__search" role="search" onSubmit={(e) => { e.preventDefault(); navigate(catalogueHref({}, q)); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15ZM21 21l-5.2-5.2" /></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a title, subject, class or exam" aria-label="Search the store" />
              <button type="submit" className="btn btn--accent">Search <Arrow /></button>
            </form>
            <div className="hero__quick">
              <span className="hero__quick-label">Popular</span>
              {QUICK.map(([label, to]) => <Link key={label} to={to} className="hero__chip">{label}</Link>)}
            </div>
          </motion.div>
        </div>

        <div className="hero__stage" aria-hidden={books.length === 0}>
          <motion.div className="hero__fan" style={{ y: lift }}>
            {books.map((bk, i) => <FanBook key={bk.id} book={bk} i={i} spread={spread} sx={sx} sy={sy} />)}
          </motion.div>
          <motion.div className="hero__stamp" initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 160, damping: 14, delay: 1.1 }}>
            <svg viewBox="0 0 120 120" className="hero__stamp-ring"><defs><path id="hero-ring" d="M60 60m-46 0a46 46 0 1 1 92 0a46 46 0 1 1-92 0" /></defs>
              <text><textPath href="#hero-ring" textLength="285">SESSION 2027–28 ✦ NEW TITLES ✦ </textPath></text></svg>
            <span>27<br />28</span>
          </motion.div>
        </div>
      </div>

      <div className="wrap">
        <Stagger className="hero__stats">
          <StaggerItem className="hero__stat"><b>1–12</b><span>Every class, every board</span></StaggerItem>
          <StaggerItem className="hero__stat"><b><CountUp to={products.length} /></b><span>Titles in the store</span></StaggerItem>
          <StaggerItem className="hero__stat"><b><CountUp to={resources.length} /></b><span>Free downloads</span></StaggerItem>
          <StaggerItem className="hero__stat">{cfg && cfg.shipping.freeAbove > 0
            ? <><b>{inr(cfg.shipping.freeAbove)}+</b><span>Free delivery across India</span></>
            : <><b>India</b><span>Delivery everywhere</span></>}</StaggerItem>
        </Stagger>
      </div>
    </section>
  );
}

function FanBook({ book, i, spread, sx, sy }: { book: Product; i: number; spread: MotionValue<number>; sx: MotionValue<number>; sy: MotionValue<number> }) {
  const f = FAN[i];
  const depth = [18, 30, 22][i];
  const x = useTransform([spread, sx] as MotionValue<number>[], ([s, m]: number[]) => f.x * s + m * depth);
  const y = useTransform(sy, (m) => f.y + m * depth);
  const rotate = useTransform(spread, (s) => f.r * s);
  return (
    <motion.div className="hero__book" style={{ x, y, rotate, zIndex: f.z }}
      initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.9, ease: EASE, delay: 0.35 + i * 0.12 }}>
      <Link to={'/books/' + book.slug} aria-label={book.title} tabIndex={-1}>
        <motion.div whileHover={{ y: -14, rotate: f.r > 0 ? 3 : -3 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
          <BookCover book={book} size="hero" />
        </motion.div>
      </Link>
    </motion.div>
  );
}

/* ---------------- Paths ---------------- */

function Paths() {
  const { openModal } = useSite();
  const navigate = useNavigate();
  const paths = [
    { n: '01', t: 'School, Class 1–12', d: 'Textbooks, workbooks and revision guides for CBSE, ICSE and State Boards.', cta: 'Browse school books', tone: 'ink', go: () => navigate(catalogueHref({ level: ['P', 'M', 'S', 'SS'] })) },
    { n: '02', t: 'Competitive exams', d: 'Reference books and practice papers for JEE, NEET, CUET and UPSC.', cta: 'Browse exam prep', tone: 'orange', go: () => navigate(catalogueHref({ level: ['C'] })) },
    { n: '03', t: 'Teachers & schools', d: 'Inspection copies, teacher’s manuals and bulk orders for your school.', cta: 'Request a sample', tone: 'yellow', go: () => openModal('sample') },
    { n: '04', t: 'Researchers & authors', d: 'Peer-reviewed journals, scholarly titles and proposals for new books.', cta: 'Publish with us', tone: 'paper', go: () => navigate('/about') },
  ];
  return (
    <section className="wrap section paths-sec">
      <div className="section-head">
        <Reveal><h2 className="t-h2">Start where <span className="serif-i">you</span> are.</h2></Reveal>
        <Reveal delay={0.1}><p className="section-head__note">A class, an exam, a staff room or a research desk: every path leads to the right shelf.</p></Reveal>
      </div>
      <Stagger className="paths">
        {paths.map((p) => (
          <StaggerItem key={p.n} className={'path path--' + p.tone}>
            <button type="button" className="path__btn" onClick={p.go}>
              <span className="path__n">{p.n}</span>
              <span className="path__t">{p.t}</span>
              <span className="path__d">{p.d}</span>
              <span className="path__cta">{p.cta} <Arrow /></span>
            </button>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}

/* ---------------- New titles shelf ---------------- */

function Shelf({ books }: { books: Product[] }) {
  const track = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <section className="shelf-sec">
      <div className="wrap section-head">
        <Reveal>
          <div className="t-label">New this session</div>
          <h2 className="t-h2">Fresh off <span className="serif-i">the press.</span></h2>
        </Reveal>
        <div className="shelf__ctrls">
          <button type="button" className="icon-round" aria-label="Previous" onClick={() => scroll(-1)}><Arrow className="icon-round__arrow flip" /></button>
          <button type="button" className="icon-round" aria-label="Next" onClick={() => scroll(1)}><Arrow className="icon-round__arrow" /></button>
          <Link to="/catalogue" className="underline-link">All titles <Arrow /></Link>
        </div>
      </div>
      <div className="shelf" ref={track}>
        {books.map((b, i) => (
          <Reveal key={b.id} className="shelf__item" delay={Math.min(i, 5) * 0.06}><BookCard book={b} /></Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------- Contents (categories) ---------------- */

function Contents() {
  const { products, categories } = useCatalog();
  const [hover, setHover] = useState<string | null>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 300, damping: 30 });
  const y = useSpring(my, { stiffness: 300, damping: 30 });
  const rows = [
    ...categories.map((c) => ({ key: c.slug, label: c.name, books: products.filter((p) => p.category?.id === c.id), to: catalogueHref({ type: [c.slug] }) })),
    { key: 'ebook', label: 'E-books', books: products.filter((p) => p.formats.digital), to: catalogueHref({ format: ['ebook'] }) },
  ].filter((r) => r.books.length);
  const preview = rows.find((r) => r.key === hover)?.books[0];
  if (!rows.length) return null;

  return (
    <section className="wrap section contents-sec" onPointerMove={(e) => { mx.set(e.clientX); my.set(e.clientY); }}>
      <div className="section-head">
        <Reveal>
          <div className="t-label">Contents</div>
          <h2 className="t-h2">Browse by <span className="serif-i">kind of book.</span></h2>
        </Reveal>
      </div>
      <ol className="contents" onPointerLeave={() => setHover(null)}>
        {rows.map((r, i) => (
          <Reveal key={r.key} as="li" delay={i * 0.05}>
            <Link to={r.to} className="contents__row" onPointerEnter={() => setHover(r.key)} onFocus={() => setHover(r.key)} onBlur={() => setHover(null)}>
              <span className="contents__n">{String(i + 1).padStart(2, '0')}</span>
              <span className="contents__t">{r.label}</span>
              <span className="contents__dots" aria-hidden="true" />
              <span className="contents__c">{r.books.length} {r.books.length === 1 ? 'title' : 'titles'}</span>
              <Arrow className="contents__arrow" />
            </Link>
          </Reveal>
        ))}
      </ol>
      {preview && (
        <motion.div className="contents__peek" style={{ x, y }} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} key={preview.id} transition={{ duration: 0.25 }}>
          <BookCover book={preview} size="hero" />
        </motion.div>
      )}
    </section>
  );
}

/* ---------------- Study Hub band ---------------- */

function HubBand() {
  const { items } = useResources();
  return (
    <section className="hubband">
      <div className="wrap section hubband__inner">
        <div className="hubband__text">
          <Reveal><div className="t-label hubband__label">Study Hub · free</div></Reveal>
          <Reveal delay={0.05}><h2 className="t-h2">Sample papers, notes and answer keys. <span className="serif-i">Free.</span></h2></Reveal>
          <Reveal delay={0.1}><p className="body">Updated every session for students revising at home and teachers setting class tests. No sign-up.</p></Reveal>
          <Reveal delay={0.15}><Link to="/study-hub" className="btn btn--ink btn--lg">Open the Study Hub <Arrow /></Link></Reveal>
        </div>
        <Stagger className="hubband__list">
          {items.slice(0, 5).map((r) => <StaggerItem key={r.id}><ResourceRow r={r} compact /></StaggerItem>)}
        </Stagger>
      </div>
    </section>
  );
}

/* ---------------- elmaster ---------------- */

function Elmaster() {
  return (
    <section className="elm">
      <div className="wrap section elm__inner">
        <div className="elm__text">
          <Reveal><div className="t-label elm__label">Our learning platform</div></Reveal>
          <Reveal delay={0.05}><ElmasterMark className="elm__mark" /></Reveal>
          <Reveal delay={0.1}><p className="elm__lede">Every Elden book has a digital companion. Scan the QR code inside to continue on elmaster with video lessons, practice tests and progress tracking.</p></Reveal>
          <Stagger className="elm__features">
            {ELM_FEATURES.map((f) => (
              <StaggerItem key={f.t} className="elm__feature"><b>{f.t}</b><span>{f.d}</span></StaggerItem>
            ))}
          </Stagger>
          {config.elmasterUrl && (
            <div className="elm__ctas">
              <a href={config.elmasterUrl} target="_blank" rel="noopener" className="btn btn--white btn--lg">Go to elmaster <Arrow /></a>
            </div>
          )}
        </div>
        <Reveal className="elm__art" delay={0.1}>
          <div className="elm__card elm__card--a">
            <span className="t-label">Chapter 4</span>
            <b>Quadratic equations</b>
            <div className="elm__bar"><motion.i initial={{ width: '8%' }} whileInView={{ width: '72%' }} viewport={{ once: true }} transition={{ duration: 1.6, ease: EASE, delay: 0.3 }} /></div>
            <small>Video 6 of 8</small>
          </div>
          <div className="elm__card elm__card--b">
            <span className="t-label">Chapter test</span>
            <div className="elm__ring"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" /><motion.circle cx="22" cy="22" r="18" initial={{ pathLength: 0 }} whileInView={{ pathLength: 0.84 }} viewport={{ once: true }} transition={{ duration: 1.8, ease: EASE, delay: 0.5 }} /></svg><b>84%</b></div>
          </div>
          <div className="elm__card elm__card--c"><span className="elm__qr" aria-hidden="true" /><span>Scan the QR<br />inside the book</span></div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- Audiences ---------------- */

function Audiences() {
  const { openModal } = useSite();
  return (
    <section className="wrap section aud">
      <Reveal className="aud__card aud__card--orange">
        <div className="t-label">For schools &amp; teachers</div>
        <h3 className="aud__title">Evaluating books for next session?</h3>
        <p>Inspection copies, teacher’s manuals and bulk pricing for your school or coaching centre.</p>
        <div className="aud__ctas">
          <button type="button" className="btn btn--ink btn--lg" onClick={() => openModal('sample')}>Request a sample <Arrow /></button>
          <Link to="/contact" className="btn btn--outline btn--lg">Find a distributor</Link>
        </div>
      </Reveal>
      <Reveal className="aud__card aud__card--paper" delay={0.1}>
        <div className="t-label">For authors &amp; researchers</div>
        <h3 className="aud__title">Write with Elden. Publish in our journals.</h3>
        <p>We work with teachers, subject experts and researchers on textbooks, reference works and peer-reviewed articles.</p>
        <div className="aud__ctas">
          <Link to="/about" className="btn btn--ink btn--lg">Send a proposal <Arrow /></Link>
          <Link to={catalogueHref({ type: ['journals'] })} className="btn btn--outline btn--lg">Browse journals</Link>
        </div>
      </Reveal>
    </section>
  );
}
