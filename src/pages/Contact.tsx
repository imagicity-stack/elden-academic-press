import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useSearchParams } from 'react-router-dom';
import { formData, submitForm } from '../api';
import { useSubmit } from '../store/useSubmit';
import { config } from '../config';
import { DIST } from '../data';
import { useSite } from '../site';
import { Field, Pill, TextField } from '../components/Field';
import { Arrow, EASE, Reveal, SplitWords, Stagger, StaggerItem } from '../components/motion';

const ROLES = ['Student', 'Parent', 'Teacher', 'School', 'Distributor', 'Author'];
const STATES = Object.keys(DIST);

const CONTACT_LINES = [
  { k: 'Head office', v: config.headOffice },
  { k: 'Email', v: config.contactEmail },
  { k: 'Hours', v: 'Monday – Saturday, 10:00 – 18:00 IST' },
  { k: 'Registered office', v: `${config.company.legalName}, ${config.company.address}` },
];

export function Contact() {
  const { openModal } = useSite();
  const [sp] = useSearchParams();
  const roleParam = sp.get('role');
  const [role, setRole] = useState(roleParam && ROLES.includes(roleParam) ? roleParam : 'Teacher');
  const [state, setState] = useState(STATES[0]);
  const { busy, error, sent, setSent, submit } = useSubmit((form) => submitForm('contact', { role, ...formData(form) }));

  useEffect(() => { document.title = 'Contact — Elden Academic Press'; }, []);

  const enquire = () => {
    setRole('Distributor');
    setSent(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="contact">
      <section className="wrap contact__top">
        <div className="contact__text">
          <div className="t-label">Contact</div>
          <h1 className="t-display contact__title"><SplitWords text="Talk to" /> <span className="serif-i">us.</span></h1>
          <Reveal delay={0.3}><p className="t-lead">Questions about a title, school orders, sample copies or publishing: send a note and the right team will reply.</p></Reveal>
          <Stagger className="contact__lines">
            {CONTACT_LINES.map((l) => (
              <StaggerItem key={l.k} className="contact__line"><span className="t-label">{l.k}</span><span className="contact__v">{l.k === 'Email' ? <a href={`mailto:${l.v}`}>{l.v}</a> : l.v}</span></StaggerItem>
            ))}
          </Stagger>
        </div>
        <Reveal className="form-card contact__form" delay={0.15}>
          {sent ? (
            <div className="form-done">
              <div className="h-card">Thanks, message sent.</div>
              <div className="body">We’ll get back to you by phone or email.</div>
              <button type="button" className="text-link" onClick={() => setSent(false)}>Send another message</button>
            </div>
          ) : (
            <form className="stack-18" onSubmit={submit}>
              <div className="stack-10">
                <span className="field-label">I am a</span>
                <div className="pills">
                  {ROLES.map((r) => <Pill key={r} sm on={role === r} onClick={() => setRole(r)}>{r}</Pill>)}
                </div>
              </div>
              <div className="form-grid">
                <Field label="Name" name="name" required />
                <Field label="Phone" name="phone" type="tel" placeholder="+91" />
                <Field label="Email" name="email" type="email" required />
                <Field label="City" name="city" />
              </div>
              <TextField label="Message" name="message" />
              <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hp" aria-hidden="true" />
              {error && <div className="form-error" role="alert">{error}</div>}
              <div><button type="submit" className="btn btn--ink btn--lg" disabled={busy}>{busy ? 'Sending…' : <>Send message <Arrow /></>}</button></div>
            </form>
          )}
        </Reveal>
      </section>

      <section className="dist">
        <div className="wrap section">
          <div className="section-head">
            <Reveal>
              <div className="t-label">Distributors</div>
              <h2 className="t-h2">Find Elden books <span className="serif-i">near you.</span></h2>
            </Reveal>
            <button type="button" className="underline-link" onClick={() => openModal('dist')}>Become a distributor <Arrow /></button>
          </div>
          <div className="pills dist__states">
            {STATES.map((st) => <Pill key={st} on={state === st} onClick={() => setState(st)}>{st}</Pill>)}
          </div>
          <div className="dist__grid">
            <AnimatePresence mode="popLayout" initial={false}>
              {DIST[state].map((d, i) => (
                <motion.div key={state + d.n} layout className="dist__card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.4, ease: EASE } }} exit={{ opacity: 0, scale: 0.95 }}>
                  <div className="t-label">{d.k}</div>
                  <div className="dist__name">{d.n}</div>
                  <div className="dist__city">{d.c}</div>
                  <button type="button" className="text-link" onClick={enquire}>Enquire</button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </section>
    </div>
  );
}
