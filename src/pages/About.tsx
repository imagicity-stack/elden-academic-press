import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll } from 'motion/react';
import { formData, submitForm } from '../api';
import { useSubmit } from '../store/useSubmit';
import { inr } from '../store/api';
import { fromPrice, useCatalog } from '../store/catalog';
import { BookCover } from '../components/BookCover';
import { Field, SelectField, TextField } from '../components/Field';
import { Arrow, Highlight, Reveal, Stagger, StaggerItem } from '../components/motion';

const PILLARS = [
  { t: 'School', d: 'Textbooks and workbooks for Classes 1–12 across CBSE, ICSE and State Boards.' },
  { t: 'Competitive', d: 'Reference and practice for JEE, NEET, CUET, UPSC and more.' },
  { t: 'Scholarly', d: 'Research methods, education studies and professional titles.' },
  { t: 'Journals', d: 'Peer-reviewed journals in education and science pedagogy.' },
];

const STEPS = [
  { n: '01', t: 'Send a proposal', d: 'A synopsis, table of contents and a sample chapter if you have one.' },
  { n: '02', t: 'Editorial review', d: 'Our subject editors assess fit, audience and syllabus alignment.' },
  { n: '03', t: 'Development', d: 'We work with you on structure, review, design and illustration.' },
  { n: '04', t: 'Publication', d: 'Print, e-book and elmaster companion, distributed across India.' },
];


export function About() {
  const { products } = useCatalog();
  const journals = products.filter((p) => p.category?.slug === 'journals');
  const { busy, error, sent, setSent, submit } = useSubmit((form) => submitForm('proposal', formData(form)));
  useEffect(() => { document.title = 'About & publishing — Elden Academic Press'; }, []);

  return (
    <div className="about">
      <section className="wrap about__hero">
        <div className="t-label">About Elden</div>
        <h1 className="t-display about__title">A press built around the <Highlight delay={0.9}>classroom.</Highlight></h1>
        <Reveal delay={0.3} className="about__intro">
          <p className="t-lead">Elden Academic Press publishes for students from Class 1 to the research desk. Our books are written with practising teachers, checked against the current syllabus, and paired with digital practice on elmaster.</p>
        </Reveal>
      </section>

      <section className="about__pillars">
        <Stagger className="wrap pillars">
          {PILLARS.map((p, i) => (
            <StaggerItem key={p.t} className="pillar">
              <span className="pillar__n">{String(i + 1).padStart(2, '0')}</span>
              <span className="pillar__t">{p.t}</span>
              <span className="pillar__d">{p.d}</span>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section className="wrap section authors">
        <div className="authors__text">
          <Reveal><div className="t-label">For authors</div></Reveal>
          <Reveal delay={0.05}><h2 className="t-h2">Publish <span className="serif-i">with Elden.</span></h2></Reveal>
          <Reveal delay={0.1}><p className="body">We commission textbooks, reference works and study material, and welcome proposals from teachers and subject experts.</p></Reveal>
          <Steps />
        </div>
        <Reveal className="form-card authors__form" delay={0.1}>
          {sent ? (
            <div className="form-done">
              <div className="h-card">Proposal received.</div>
              <div className="body">Our editorial team will review it and write back to you by email.</div>
              <button type="button" className="text-link" onClick={() => setSent(false)}>Submit another</button>
            </div>
          ) : (
            <form className="stack-18" onSubmit={submit}>
              <div className="h-card">Send a proposal</div>
              <div className="form-grid">
                <Field label="Full name" name="name" required />
                <Field label="Email" name="email" type="email" required />
                <Field label="School / institution" name="institution" />
                <SelectField label="Proposal type" name="type">
                  <option>Textbook</option><option>Reference book</option><option>Study guide / practice papers</option><option>Journal article</option>
                </SelectField>
                <Field label="Subject" name="subject" />
                <Field label="Class / level" name="level" />
              </div>
              <TextField label="Synopsis" name="synopsis" placeholder="What is the book about, who is it for, and how is it different?" />
              <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hp" aria-hidden="true" />
              {error && <div className="form-error" role="alert">{error}</div>}
              <div className="form-submit-row">
                <button type="submit" className="btn btn--ink btn--lg" disabled={busy}>{busy ? 'Sending…' : <>Submit proposal <Arrow /></>}</button>
                <span className="form-note">Sample chapters can follow by email.</span>
              </div>
            </form>
          )}
        </Reveal>
      </section>

      {journals.length > 0 && (
        <section className="about__journals">
          <div className="wrap section">
            <div className="section-head">
              <Reveal>
                <div className="t-label">Journals</div>
                <h2 className="t-h2">Peer-reviewed, <span className="serif-i">open to submissions.</span></h2>
              </Reveal>
            </div>
            <Stagger className="journals">
              {journals.map((j) => {
                const price = fromPrice(j);
                return (
                  <StaggerItem key={j.id} className="journal">
                    <Link to={'/books/' + j.slug} className="journal__cover" aria-label={j.title}><BookCover book={j} /></Link>
                    <div className="journal__body">
                      <div className="journal__t">{j.title}</div>
                      <div className="journal__meta">{[j.classLabel, price !== null && 'From ' + inr(price)].filter(Boolean).join(' · ')}</div>
                      <p className="journal__bl">{j.blurb}</p>
                      <div className="journal__links">
                        <Link to={'/books/' + j.slug} className="btn btn--ink btn--md">Buy this issue</Link>
                        <Link to="/contact" className="text-link">Submit a manuscript</Link>
                      </div>
                    </div>
                  </StaggerItem>
                );
              })}
            </Stagger>
          </div>
        </section>
      )}
    </div>
  );
}

/** The four publishing steps, with a rule that draws down as you scroll. */
function Steps() {
  const ref = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 80%', 'end 50%'] });
  return (
    <ol className="steps" ref={ref}>
      <motion.span className="steps__rule" style={{ scaleY: scrollYProgress }} aria-hidden="true" />
      {STEPS.map((st) => (
        <li key={st.n}>
          <span className="steps__n">{st.n}</span>
          <span className="steps__body"><span className="steps__t">{st.t}</span><span className="steps__d">{st.d}</span></span>
        </li>
      ))}
    </ol>
  );
}
