import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { catalogueHref } from '../catalogue';
import { config } from '../config';
import { useSite } from '../site';
import { Logo } from './Brand';

const NAV: { label: string; to: string; match?: (path: string) => boolean }[] = [
  { label: 'Home', to: '/', match: (p) => p === '/' },
  { label: 'Catalogue', to: '/catalogue', match: (p) => p.startsWith('/catalogue') || p.startsWith('/books/') },
  { label: 'Study Hub', to: '/study-hub', match: (p) => p.startsWith('/study-hub') },
  { label: 'Journals', to: catalogueHref({ type: ['Journal'] }) },
  { label: 'For Authors', to: '/about', match: (p) => p.startsWith('/about') },
  { label: 'Contact', to: '/contact', match: (p) => p.startsWith('/contact') },
];

export function TopBar() {
  const { openModal } = useSite();
  const navigate = useNavigate();
  return (
    <div className="topbar">
      <div className="wrap topbar__inner">
        <div className="topbar__msg">
          <span className="topbar__tag">SESSION 2027–28</span>
          <span>New titles for CBSE, ICSE &amp; State Boards are out.</span>
          <button type="button" className="topbar__cta" onClick={() => openModal('sample')}>Request inspection copies</button>
        </div>
        <div className="topbar__links">
          <button type="button" className="topbar__link" onClick={() => navigate('/contact')}>Find a distributor</button>
          <button type="button" className="topbar__link" onClick={() => navigate('/about')}>Publish with us</button>
        </div>
      </div>
    </div>
  );
}

export function Header() {
  const { openModal } = useSite();
  const { pathname, search } = useLocation();
  const [menu, setMenu] = useState(false);

  useEffect(() => setMenu(false), [pathname, search]);

  const links = (cls: string) =>
    NAV.map((n) => (
      <Link key={n.label} to={n.to} className={cls + (n.match?.(pathname) ? ' is-active' : '')} onClick={() => setMenu(false)}>
        {n.label}
      </Link>
    ));

  return (
    <header className="header">
      <div className="wrap header__inner">
        <Link to="/" className="header__home" aria-label="Elden Academic Press — home"><Logo /></Link>
        <nav className="header__nav" aria-label="Main">{links('header__nav-link')}</nav>
        <div className="header__actions">
          {config.showElmasterInNav && config.elmasterUrl && (
            <a href={config.elmasterUrl} target="_blank" rel="noopener" className="header__elm">
              <span className="dot dot--teal" />elmaster ↗
            </a>
          )}
          <button type="button" className="btn btn--bronze btn--sm header__cta" onClick={() => openModal('sample')}>Request a sample</button>
          <button type="button" className="header__menu-btn" aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? 'Close' : 'Menu'}</button>
        </div>
      </div>
      {menu && (
        <div className="header__drawer">
          {links('header__drawer-link')}
          <button type="button" className="btn btn--bronze header__drawer-cta" onClick={() => { setMenu(false); openModal('sample'); }}>Request a sample</button>
        </div>
      )}
    </header>
  );
}
