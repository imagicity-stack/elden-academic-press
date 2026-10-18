import { useEffect, type ReactNode } from 'react';
import { config } from '../config';
import './coming-soon.css';

// The pre-launch page is styled as a printer's proof of the website's own
// front matter: title page, dedication, contents and colophon — complete with
// crop marks, a colour bar and a proofreader's red pencil.

const CONTENTS: { t: string; pg: number; d: ReactNode }[] = [
  { t: 'The Catalogue', pg: 1, d: 'Every Elden title in one place — textbooks, reference books, study guides, practice papers, workbooks, journals and e-books. Search by class, board, subject or exam.' },
  { t: 'The Study Hub', pg: 9, d: <><Insert word="free" />sample papers, revision notes, answer keys and worksheets, updated every session. No sign-up needed.</> },
  { t: 'For Schools & Teachers', pg: 17, d: 'Inspection copies, teacher’s manuals and bulk pricing for your school or coaching centre — requested in a few clicks.' },
  { t: 'elmaster, the Digital Companion', pg: 25, d: 'Scan the QR inside any Elden book for video lessons, timed mock tests and progress tracking.' },
  { t: 'Authors & Journals', pg: 33, d: 'Send us a book proposal, submit to our peer-reviewed journals, or read the current issue.' },
  { t: 'Find a Distributor', pg: 41, d: 'Stockists and school suppliers across India, state by state.' },
];

const SWATCHES = ['#0E1F33', '#1E3A57', '#45607C', '#8A9BB0', '#6B3A0A', '#9C6A2F', '#CC955F', '#E2B68A', '#E8DAC3', 'oklch(0.80 0.12 185)', '#171A1F', '#5A5650', '#A8A296', '#D6CCBB'];

export function ComingSoon() {
  useEffect(() => { document.title = 'Elden Academic Press — Now in press'; }, []);
  const mail = 'mailto:' + config.contactEmail;

  return (
    <div className="cs-desk">
      <div className="cs-sheet">
        <SheetMarks />

        <div className="cs-trim">
          <section className="cs-page cs-title">
            <img src="/assets/elden-mark.png" alt="" className="cs-title__mark" />
            <div className="cs-smallcaps cs-title__press">Elden Academic Press</div>
            <h1 className="cs-title__h1">
              <span className="cs-title__now">Now</span>{' '}
              <span className="cs-title__line2"><span className="cs-circled">in press<HandCircle /></span>.</span>
              <span className="cs-note" aria-hidden="true">live for<br />Session 2027–28!<HandArrow /></span>
            </h1>
            <div className="cs-bars" aria-hidden="true"><i /><i /><i /></div>
            <p className="cs-title__sub">
              A new website for the Press — every Elden title, free study material, sample copies for schools
              and a direct line to elmaster.
            </p>
            <div className="cs-imprint cs-smallcaps"><span>Hazaribagh</span><i /><span>Session 2027–28</span></div>
            <Stamp />
            <Folio n="i" />
          </section>

          <section className="cs-page cs-dedication">
            <p>
              <span>For every student revising late,</span>
              <span>every teacher setting tomorrow’s test,</span>
              <span>and every reader who wants the next chapter.</span>
            </p>
            <Folio n="ii" />
          </section>

          <section className="cs-page cs-contents" aria-labelledby="cs-contents-h">
            <h2 id="cs-contents-h" className="cs-h2 cs-smallcaps">Contents</h2>
            <p className="cs-contents__lede">What you’ll find in the first edition of the new site.</p>
            <ol className="cs-toc">
              {CONTENTS.map((c, i) => (
                <li key={c.t}>
                  <div className="cs-toc__row">
                    <span className="cs-toc__n">{i + 1}</span>
                    <span className="cs-toc__t">{c.t}</span>
                    <span className="cs-toc__leader" aria-hidden="true" />
                    <span className="cs-toc__pg" aria-hidden="true">{c.pg}</span>
                  </div>
                  <p className="cs-toc__d">{c.d}</p>
                </li>
              ))}
            </ol>

            <aside className="cs-erratum" aria-label="Erratum">
              <span className="cs-tape cs-tape--l" /><span className="cs-tape cs-tape--r" />
              <div className="cs-erratum__head cs-smallcaps">Erratum</div>
              <p className="cs-erratum__fix">Page 25, <em>for</em> “coming soon” <em>read</em> “open now”.</p>
              <div className="cs-erratum__body">
                <span className="cs-elm"><span>el</span>master</span>
                <p>Our learning platform is already live — video lessons, mock tests and progress tracking for Elden readers.</p>
              </div>
            </aside>
            <Folio n="iii" />
          </section>

          <section className="cs-page cs-colophon" aria-labelledby="cs-colophon-h">
            <h2 id="cs-colophon-h" className="cs-h2 cs-smallcaps">Colophon</h2>
            <p className="cs-colophon__p">
              This website is being set in Cormorant Garamond and Montserrat, proofed in Hazaribagh,
              and will be published for Session 2027–28.
            </p>
            <p className="cs-colophon__until">Until then, our team is taking orders and sample requests as usual.</p>
            <a href={mail} className="cs-colophon__mail">{config.contactEmail}</a>
            <dl className="cs-colophon__facts">
              <div><dt>Head office</dt><dd>{config.headOffice}</dd></div>
              <div><dt>Hours</dt><dd>Monday – Saturday, 10:00 – 18:00 IST</dd></div>
            </dl>
            <div className="cs-colophon__legal">
              <p>© 2026 Elden Academic Press. All rights reserved.</p>
              <p className="cs-printline" aria-hidden="true">10 9 8 7 6 5 4 3 2 1</p>
            </div>
            <Folio n="iv" />
          </section>
        </div>

        <div className="cs-slug" aria-hidden="true">
          <div className="cs-colourbar">{SWATCHES.map((c) => <i key={c} style={{ background: c }} />)}</div>
          <span className="cs-slug__text">{config.siteUrl.replace(/^https?:\/\//, '')} · proof 04 · please return corrections to {config.contactEmail}</span>
        </div>
      </div>
    </div>
  );
}

function Folio({ n }: { n: string }) {
  return <div className="cs-folio" aria-hidden="true">{n}</div>;
}

/** Proofreader's insertion: a caret with the inserted word written above it. */
function Insert({ word }: { word: string }) {
  return (
    <span className="cs-ins">
      <svg className="cs-ins__caret" viewBox="0 0 10 8" aria-hidden="true"><path d="M1.5 7 L5 1.5 L8.5 7" /></svg>
      <span className="cs-ins__word">{word}</span>{' '}
    </span>
  );
}

function SheetMarks() {
  return (
    <div className="cs-marks" aria-hidden="true">
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => <span key={c} className={'cs-crop cs-crop--' + c} />)}
      {(['top', 'left', 'right'] as const).map((p) => (
        <svg key={p} className={'cs-reg cs-reg--' + p} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2.6" className="cs-reg__dot" /><path d="M0 12H24M12 0V24" />
        </svg>
      ))}
    </div>
  );
}

function HandCircle() {
  return (
    <svg className="cs-circle" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
      <path d="M64,22 C120,6 236,4 276,26 C304,42 292,74 240,86 C176,100 64,98 26,78 C-2,62 8,30 70,18 C110,10 150,9 186,12" />
    </svg>
  );
}

function HandArrow() {
  return (
    <svg className="cs-arrow" viewBox="0 0 48 56" aria-hidden="true">
      <path pathLength={1} d="M44,6 C24,8 10,22 9,48" />
      <path pathLength={1} d="M2,38 L9,49 L17,40" />
    </svg>
  );
}

function Stamp() {
  return (
    <svg className="cs-stamp" viewBox="0 0 200 200" role="img" aria-label="Stamp: in press, Session 2027–28">
      <defs>
        <path id="cs-stamp-ring" d="M100,100 m-73,0 a73,73 0 1,1 146,0 a73,73 0 1,1 -146,0" />
        <filter id="cs-ink" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.6 0 0 0 2" result="mask" />
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="1" seed="2" result="wobble" />
          <feDisplacementMap in="SourceGraphic" in2="wobble" scale="3" result="rough" />
          <feComposite in="rough" in2="mask" operator="in" />
        </filter>
      </defs>
      <g filter="url(#cs-ink)">
        <circle cx="100" cy="100" r="94" className="cs-stamp__ring cs-stamp__ring--bold" />
        <circle cx="100" cy="100" r="87" className="cs-stamp__ring" />
        <circle cx="100" cy="100" r="62" className="cs-stamp__ring" />
        <text className="cs-stamp__arc"><textPath href="#cs-stamp-ring" textLength="452" lengthAdjust="spacing">ELDEN ACADEMIC PRESS • PROOF • SESSION 2027–28 •</textPath></text>
        <text x="100" y="94" className="cs-stamp__big">IN</text>
        <text x="100" y="124" className="cs-stamp__big">PRESS</text>
      </g>
    </svg>
  );
}
