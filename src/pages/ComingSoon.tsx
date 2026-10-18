import { useEffect, type CSSProperties } from 'react';
import { config } from '../config';
import { findBook } from '../data';
import { BookCover } from '../components/BookCover';
import { ElmasterMark, Logo } from '../components/Brand';
import './coming-soon.css';

const STACK = [
  { id: 'sci6', x: '2%', y: '16%', r: '-9deg', z: 1 },
  { id: 'm8', x: '27%', y: '3%', r: '-1deg', z: 3 },
  { id: 'cuet', x: '53%', y: '14%', r: '8deg', z: 2 },
];

const COMING = [
  { n: '01', t: 'The full catalogue', d: 'Textbooks, reference books, study guides, practice papers, workbooks, journals and e-books — searchable by class, subject, board and exam.', tag: 'CBSE · ICSE · State Boards' },
  { n: '02', t: 'Study Hub', d: 'Free sample papers, revision notes, answer keys and worksheets, updated every session. No sign-up needed.', tag: 'Free downloads' },
  { n: '03', t: 'Sample copies for schools', d: 'Request inspection copies, teacher’s manuals and bulk pricing for your school or coaching centre in a few clicks.', tag: 'For teachers & schools' },
  { n: '04', t: 'elmaster companion', d: 'Every Elden book linked to elmaster — video lessons, timed mock tests and progress tracking from the QR inside.', tag: 'Digital learning' },
  { n: '05', t: 'Publish with Elden', d: 'Send book proposals and journal manuscripts to our editorial team, and follow our peer-reviewed journals.', tag: 'Authors & researchers' },
  { n: '06', t: 'Distributors near you', d: 'Find Elden stockists and school suppliers across India, state by state — or apply to become one.', tag: 'Across India' },
];

const AUDIENCE = [
  { t: 'Students', d: 'Class 1 to 12' },
  { t: 'Aspirants', d: 'JEE · NEET · CUET · UPSC' },
  { t: 'Teachers & schools', d: 'Adoption, samples, bulk orders' },
  { t: 'Researchers', d: 'Journals & scholarly titles' },
];

export function ComingSoon() {
  useEffect(() => { document.title = 'Elden Academic Press — Coming soon'; }, []);
  const mail = 'mailto:' + config.contactEmail;

  return (
    <div className="cs">
      <section className="cs-hero">
        <div className="cs-hero__rule" aria-hidden="true" />
        <div className="wrap cs-hero__top">
          <Logo light />
          <span className="cs-badge"><span className="cs-badge__pulse" />Launching for Session 2026–27</span>
        </div>
        <div className="wrap cs-hero__main">
          <div className="cs-hero__text">
            <div className="eyebrow eyebrow--11 eyebrow--gold">Our new website is in the press</div>
            <h1 className="cs-hero__title">Books that teach. <em>A website to match</em> — coming soon.</h1>
            <p className="cs-hero__lede">
              We’re building a new home for Elden Academic Press: our complete catalogue, free study material, sample copies for schools
              and a direct line to elmaster — all in one place.
            </p>
            <div className="cs-hero__ctas">
              <a href={mail} className="cs-btn cs-btn--tan">Write to us</a>
              <a href={config.elmasterUrl} target="_blank" rel="noopener" className="cs-btn cs-btn--ghost">
                <span className="dot dot--teal-light" />Visit elmaster ↗
              </a>
            </div>
          </div>
          <div className="cs-hero__books" aria-hidden="true">
            <div className="cs-hero__panel" />
            {STACK.map((s) => (
              <div key={s.id} className="cs-hero__book" style={{ left: s.x, top: s.y, transform: `rotate(${s.r})`, zIndex: s.z } as CSSProperties}>
                <BookCover book={findBook(s.id)!} size="hero" />
              </div>
            ))}
          </div>
        </div>
        <div className="wrap">
          <div className="cs-audience">
            {AUDIENCE.map((a) => (
              <div key={a.t} className="cs-audience__item"><span className="cs-audience__t">{a.t}</span><span className="cs-audience__d">{a.d}</span></div>
            ))}
          </div>
        </div>
      </section>

      <section className="wrap cs-coming">
        <div className="cs-coming__head">
          <div className="stack-12">
            <div className="eyebrow eyebrow--11">What’s coming</div>
            <h2 className="h2-50">Everything Elden, under one roof.</h2>
          </div>
          <p className="section-head__note">Here’s what you’ll find when we open the doors.</p>
        </div>
        <div className="cs-grid">
          {COMING.map((c) => (
            <article key={c.n} className="cs-card">
              <div className="cs-card__top"><span className="cs-card__n">{c.n}</span><span className="cs-card__tag">{c.tag}</span></div>
              <h3 className="cs-card__t">{c.t}</h3>
              <p className="cs-card__d">{c.d}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="cs-elm">
        <div className="wrap cs-elm__inner">
          <ElmasterMark className="cs-elm__mark" />
          <p className="cs-elm__text">Can’t wait? elmaster, our learning platform, is already live — video lessons, practice tests and progress tracking for Elden readers.</p>
          <a href={config.elmasterUrl} target="_blank" rel="noopener" className="elm__btn">Go to elmaster ↗</a>
        </div>
      </section>

      <section className="wrap cs-contact">
        <div className="cs-contact__text">
          <div className="eyebrow eyebrow--11">Need books before launch?</div>
          <h2 className="h2">Our team is taking orders and sample requests as usual.</h2>
        </div>
        <div className="cs-contact__lines">
          <a href={mail} className="cs-contact__line"><span className="spec__k">Email</span><span className="contact__v">{config.contactEmail}</span></a>
          <div className="cs-contact__line"><span className="spec__k">Head office</span><span className="contact__v">New Delhi, India</span></div>
          <div className="cs-contact__line"><span className="spec__k">Hours</span><span className="contact__v">Monday – Saturday, 10:00 – 18:00 IST</span></div>
        </div>
      </section>

      <footer className="cs-footer">
        <div className="wrap cs-footer__inner">
          <span>© 2026 Elden Academic Press</span>
          <span>Textbooks, reference, practice and research publishing for Indian classrooms.</span>
        </div>
      </footer>
    </div>
  );
}
