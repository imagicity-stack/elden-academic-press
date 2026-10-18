import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formData, submitForm } from '../api';
import { DIST } from '../data';
import { useSite } from '../site';
import { Field, Pill, TextField } from '../components/Field';

const ROLES = ['Student', 'Parent', 'Teacher', 'School', 'Distributor', 'Author'];
const STATES = Object.keys(DIST);

// Placeholder contact details.
const CONTACT_LINES = [
  { k: 'Head office', v: 'New Delhi, India' },
  { k: 'Email', v: 'enquiries@eldenpress.in' },
  { k: 'Hours', v: 'Monday – Saturday, 10:00 – 18:00 IST' },
];

export function Contact() {
  const { openModal } = useSite();
  const [sp] = useSearchParams();
  const roleParam = sp.get('role');
  const [role, setRole] = useState(roleParam && ROLES.includes(roleParam) ? roleParam : 'Teacher');
  const [state, setState] = useState(STATES[0]);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await submitForm('contact', { role, ...formData(e.currentTarget) });
    setSent(true);
  };

  const enquire = () => {
    setRole('Distributor');
    setSent(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div>
      <section className="wrap contact">
        <div className="contact__text">
          <div className="eyebrow eyebrow--11">Contact</div>
          <h1 className="h1-display h1-display--72">Talk to us.</h1>
          <p className="contact__p">Questions about a title, school orders, sample copies or publishing — send a note and the right team will reply.</p>
          <div className="contact__lines">
            {CONTACT_LINES.map((l) => (
              <div key={l.k} className="contact__line"><span className="spec__k">{l.k}</span><span className="contact__v">{l.v}</span></div>
            ))}
          </div>
        </div>
        <div className="form-card form-card--contact">
          {sent ? (
            <div className="form-done">
              <div className="h-card h-card--32">Thanks — message sent.</div>
              <div className="body body--15">We'll get back to you by phone or email.</div>
              <button type="button" className="text-link text-link--lg" onClick={() => setSent(false)}>Send another message</button>
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
              <div><button type="submit" className="btn btn--navy btn--wide">Send message</button></div>
            </form>
          )}
        </div>
      </section>

      <section className="band band--top">
        <div className="wrap section dist">
          <div className="section-head">
            <div className="stack-12">
              <div className="eyebrow eyebrow--11">Distributors</div>
              <h2 className="h2-50">Find Elden books near you</h2>
            </div>
            <button type="button" className="underline-link" onClick={() => openModal('dist')}>Become a distributor →</button>
          </div>
          <div className="pills">
            {STATES.map((s) => <Pill key={s} on={state === s} onClick={() => setState(s)}>{s}</Pill>)}
          </div>
          <div className="dist__grid">
            {DIST[state].map((d) => (
              <div key={d.n} className="dist__card">
                <div className="eyebrow-sm eyebrow-sm--105">{d.k}</div>
                <div className="dist__name">{d.n}</div>
                <div className="dist__city">{d.c}</div>
                <div className="dist__actions"><button type="button" className="journal__link" onClick={enquire}>Enquire</button></div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
