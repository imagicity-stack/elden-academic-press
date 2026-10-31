import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { catalogueHref } from '../catalogue';
import { config } from '../config';
import { useSite } from '../site';
import { useCart } from '../store/cart';
import { Logo } from './Brand';
import { Arrow, EASE, Marquee } from './motion';

const NAV: { label: string; to: string; match?: (path: string, search: string) => boolean }[] = [
  { label: 'Store', to: '/catalogue', match: (p, s) => (p.startsWith('/catalogue') && !s.includes('type=journals')) || p.startsWith('/books/') },
  { label: 'Study Hub', to: '/study-hub', match: (p) => p.startsWith('/study-hub') },
  { label: 'Journals', to: catalogueHref({ type: ['journals'] }), match: (p, s) => p.startsWith('/catalogue') && s.includes('type=journals') },
  { label: 'For authors', to: '/about', match: (p) => p.startsWith('/about') },
  { label: 'Contact', to: '/contact', match: (p) => p.startsWith('/contact') },
];

/** The running ticker above the header. */
export function TopBar() {
  const { openModal } = useSite();
  const items = [
    <><b>Session 2027–28</b> New titles for CBSE, ICSE &amp; State Boards</>,
    <>Free sample papers &amp; notes in the <Link to="/study-hub">Study Hub</Link></>,
    <>Teachers: <button type="button" onClick={() => openModal('sample')}>request inspection copies</button></>,
    <>E-books delivered instantly · printed books across India</>,
  ];
  return (
    <div className="ticker">
      <Marquee speed={48}>
        {items.map((it, i) => <span key={i} className="ticker__item">{it}<span className="ticker__star" aria-hidden="true">✦</span></span>)}
      </Marquee>
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
}
const ICONS = {
  search: 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15ZM21 21l-5.2-5.2',
  bag: 'M5 8h14l-1.1 11.1a2 2 0 0 1-2 1.9H8.1a2 2 0 0 1-2-1.9L5 8ZM9 8V7a3 3 0 0 1 6 0v1',
  menu: 'M4 8h16M4 16h16',
  close: 'M6 6l12 12M18 6 6 18',
};

export function Header() {
  const { openModal } = useSite();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const cart = useCart();
  const [menu, setMenu] = useState(false);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => { setMenu(false); setSearching(false); }, [pathname, search]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [menu]);
  useEffect(() => { if (searching) searchInput.current?.focus(); }, [searching]);

  const active = NAV.find((n) => n.match?.(pathname, search))?.label;

  return (
    <>
    <header className={'header' + (scrolled ? ' is-scrolled' : '')}>
      <div className="wrap header__inner">
        <Link to="/" className="header__home" aria-label="Elden Academic Press — home"><Logo /></Link>

        {searching ? (
          <motion.form className="header__search" role="search" initial={{ opacity: 0, width: '40%' }} animate={{ opacity: 1, width: '100%' }} transition={{ duration: 0.35, ease: EASE }}
            onSubmit={(e) => { e.preventDefault(); navigate(catalogueHref({}, q)); }}>
            <Icon d={ICONS.search} />
            <input ref={searchInput} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, subjects, classes, exams…" aria-label="Search the store"
              onKeyDown={(e) => e.key === 'Escape' && setSearching(false)} onBlur={() => !q && setSearching(false)} />
          </motion.form>
        ) : (
          <nav className="header__nav" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.label} to={n.to} className={'header__nav-link' + (active === n.label ? ' is-active' : '')}>
                {active === n.label && <motion.span layoutId="nav-pill" className="header__nav-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                {n.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="header__actions">
          {!searching && <button type="button" className="icon-btn" aria-label="Search" onClick={() => setSearching(true)}><Icon d={ICONS.search} /></button>}
          <button type="button" className="icon-btn" onClick={cart.openDrawer} aria-label={`Cart, ${cart.count} item${cart.count === 1 ? '' : 's'}`}>
            <Icon d={ICONS.bag} />
            <AnimatePresence>
              {cart.count > 0 && (
                <motion.span key={cart.count} className="header__count" initial={{ scale: 0.4 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
                  {cart.count}
                </motion.span>
              )}
            </AnimatePresence>
          </button>
          <button type="button" className="btn btn--ink btn--sm header__cta" onClick={() => openModal('sample')}>Request a sample</button>
          <button type="button" className="icon-btn header__menu-btn" aria-expanded={menu} aria-label="Menu" onClick={() => setMenu(true)}><Icon d={ICONS.menu} /></button>
        </div>
      </div>
    </header>

    {/* Outside the header: its backdrop blur would trap a fixed overlay inside it. */}
    <AnimatePresence>
        {menu && (
          <motion.div className="menu" role="dialog" aria-modal="true" aria-label="Menu"
            initial={{ clipPath: 'inset(0 0 100% 0)' }} animate={{ clipPath: 'inset(0 0 0% 0)' }} exit={{ clipPath: 'inset(0 0 100% 0)' }} transition={{ duration: 0.55, ease: EASE }}>
            <div className="wrap menu__top">
              <Link to="/" aria-label="Home"><Logo light /></Link>
              <button type="button" className="icon-btn menu__close" aria-label="Close menu" onClick={() => setMenu(false)}><Icon d={ICONS.close} /></button>
            </div>
            <motion.nav className="wrap menu__links" aria-label="Main" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.06, delayChildren: 0.2 } } }}>
              {[{ label: 'Home', to: '/' }, ...NAV, { label: 'Track an order', to: '/track' }].map((n, i) => (
                <motion.div key={n.label} variants={{ hidden: { opacity: 0, y: 30 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } } }}>
                  <Link to={n.to} className={'menu__link' + (active === n.label ? ' is-active' : '')}>
                    {n.label}<small>{String(i + 1).padStart(2, '0')}</small>
                  </Link>
                </motion.div>
              ))}
            </motion.nav>
            <div className="wrap menu__foot">
              <button type="button" className="btn btn--yellow btn--lg" onClick={() => { setMenu(false); openModal('sample'); }}>Request a sample <Arrow /></button>
              <p>{config.contactEmail} · {config.headOffice}</p>
            </div>
          </motion.div>
        )}
    </AnimatePresence>
    </>
  );
}
