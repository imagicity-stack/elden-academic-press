import { Link } from 'react-router-dom';
import { formData, submitForm } from '../api';
import { useSubmit } from '../store/useSubmit';
import { PAL } from '../data';
import { inr } from '../store/api';
import { fromPrice, useCatalog } from '../store/catalog';
import { Field, SelectField, TextField } from '../components/Field';

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

  return (
    <div>
      <section className="wrap about-hero">
        <div className="about-hero__text">
          <div className="eyebrow eyebrow--11">About Elden</div>
          <h1 className="h1-display h1-display--76">A press built around the classroom.</h1>
        </div>
        <p className="about-hero__p">Elden Academic Press publishes for students from Class 1 to the research desk. Our books are written with practising teachers, checked against the current syllabus, and paired with digital practice on elmaster.</p>
      </section>

      <section className="pillars-band">
        <div className="pillars">
          {PILLARS.map((p) => (
            <div key={p.t} className="pillar"><div className="pillar__t">{p.t}</div><div className="pillar__d">{p.d}</div></div>
          ))}
        </div>
      </section>

      <section className="wrap section authors">
        <div className="authors__text">
          <div className="eyebrow eyebrow--11">For authors</div>
          <h2 className="h2-50">Publish with Elden</h2>
          <p className="body body--15 body--relaxed">We commission textbooks, reference works and study material, and welcome unsolicited proposals from teachers and subject experts.</p>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.n}>
                <span className="steps__n">{s.n}</span>
                <span className="steps__body"><span className="steps__t">{s.t}</span><span className="steps__d">{s.d}</span></span>
              </li>
            ))}
          </ol>
        </div>
        <div className="form-card form-card--authors">
          {sent ? (
            <div className="form-done">
              <div className="h-card h-card--32">Proposal received.</div>
              <div className="body body--15">Our editorial team will review it and write back to you by email.</div>
              <button type="button" className="text-link text-link--lg" onClick={() => setSent(false)}>Submit another</button>
            </div>
          ) : (
            <form className="stack-18" onSubmit={submit}>
              <div className="h-card h-card--28">Send a proposal</div>
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
                <button type="submit" className="btn btn--navy btn--wide" disabled={busy}>{busy ? 'Sending…' : 'Submit proposal'}</button>
                <span className="form-note">Sample chapters can follow by email.</span>
              </div>
            </form>
          )}
        </div>
      </section>

      <section className="band band--top">
        <div className="wrap section">
          <div className="section-head section-head--32">
            <div className="stack-12">
              <div className="eyebrow eyebrow--11">Journals</div>
              <h2 className="h2-50">Peer-reviewed, open to submissions</h2>
            </div>
          </div>
          <div className="journals">
            {journals.map((j) => {
              const c = PAL[j.palette] ?? PAL[0];
              const price = fromPrice(j);
              return (
              <div key={j.id} className="journal">
                <Link to={'/books/' + j.slug} className="journal__cover" aria-label={j.title} style={j.coverUrl ? { backgroundImage: `url(${j.coverUrl})`, backgroundSize: 'cover' } : { background: c.bg, color: c.fg }}>
                  <span className="journal__spine" />
                  {!j.coverUrl && <span className="journal__kicker" style={{ color: c.ac }}>Journal</span>}
                  {!j.coverUrl && <span className="journal__ctitle">{j.title}</span>}
                </Link>
                <div className="journal__body">
                  <div className="journal__t">{j.title}</div>
                  <div className="journal__meta">{[j.classLabel, price !== null && 'From ' + inr(price)].filter(Boolean).join(' · ')}</div>
                  <div className="journal__bl">{j.blurb}</div>
                  <div className="journal__links">
                    <Link to={'/books/' + j.slug} className="journal__link">Buy this issue</Link>
                    <Link to="/contact" className="journal__link journal__link--bronze">Submit a manuscript</Link>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
