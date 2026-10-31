import { Link, useNavigate } from 'react-router-dom';
import { catalogueHref } from '../catalogue';
import { config } from '../config';
import { useSite, type ModalKind } from '../site';
import { LEGAL } from '../legal';
import { CompanyLine } from '../pages/Legal';
import { Logo } from './Brand';

type FooterLink = [label: string, to: string] | [label: string, modal: { modal: ModalKind }] | [label: string, ext: { href: string }];

const COLS: { t: string; links: FooterLink[] }[] = [
  { t: 'Publications', links: [
    ['Textbooks', catalogueHref({ type: ['textbooks'] })],
    ['Reference books', catalogueHref({ type: ['reference-books'] })],
    ['Practice papers', catalogueHref({ type: ['practice-papers'] })],
    ['Workbooks', catalogueHref({ type: ['workbooks'] })],
    ['E-books', catalogueHref({ format: ['ebook'] })],
  ] },
  { t: 'Students', links: [
    ['Study Hub', '/study-hub'],
    ['Sample papers', '/study-hub?kind=' + encodeURIComponent('Sample papers')],
    ['Competitive exams', catalogueHref({ level: ['C'] })],
    ['Track an order', '/track'],
    ...(config.elmasterUrl ? [['elmaster ↗', { href: config.elmasterUrl }] as FooterLink] : []),
  ] },
  { t: 'Schools', links: [
    ['Request a sample', { modal: 'sample' }],
    ['Teacher resources', { modal: 'teacher' }],
    ['Find a distributor', '/contact'],
  ] },
  { t: 'Press', links: [
    ['About Elden', '/about'],
    ['For authors', '/about'],
    ['Journals', catalogueHref({ type: ['journals'] })],
    ['Contact', '/contact'],
  ] },
];

export function Footer() {
  const { openModal } = useSite();
  const navigate = useNavigate();
  const act = (target: FooterLink[1]) => {
    if (typeof target === 'string') navigate(target);
    else if ('modal' in target) openModal(target.modal);
    else window.open(target.href, '_blank', 'noopener');
  };
  return (
    <footer className="footer">
      <div className="wrap footer__inner">
        <div className="footer__top">
          <div className="footer__brand">
            <Logo light />
            <p className="footer__blurb">Textbooks, reference, practice and research publishing for Indian classrooms.</p>
          </div>
          {COLS.map((c) => (
            <div key={c.t} className="footer__col">
              <div className="footer__col-title">{c.t}</div>
              {c.links.map(([label, target]) => (
                <button key={label} type="button" className="footer__link" onClick={() => act(target)}>{label}</button>
              ))}
            </div>
          ))}
        </div>
        <div className="footer__bottom">
          <span>© 2026 Elden Academic Press</span>
          <nav className="footer__legal" aria-label="Policies">
            {LEGAL.map((d) => <Link key={d.key} to={d.path}>{d.short}</Link>)}
          </nav>
        </div>
        <CompanyLine className="footer__company" />
      </div>
    </footer>
  );
}
