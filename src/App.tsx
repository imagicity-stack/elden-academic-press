import { useEffect, useLayoutEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import './fonts';
import './interior.css';
import './competitions.css';
import { config } from './config';
import { SiteProvider } from './site';
import { CartProvider } from './store/cart';
import { CatalogProvider } from './store/catalog';
import { CartDrawer } from './components/CartDrawer';
import { CookieBanner } from './components/CookieBanner';
import { track } from './meta';
import { Footer } from './components/Footer';
import { Header, TopBar } from './components/Header';
import { About } from './pages/About';
import { Account } from './pages/Account';
import { CompetitionPage, CompetitionsPage } from './pages/Competitions';
import { CompetitionRules, TeamConfirmation } from './pages/doomsday/DoomsdayPage';
import './doomsday.css';
import { BookDetail } from './pages/BookDetail';
import { Catalogue } from './pages/Catalogue';
import { Checkout } from './pages/Checkout';
import { Contact } from './pages/Contact';
import { Home } from './pages/Home';
import { LegalPage } from './pages/Legal';
import { LEGAL } from './legal';
import { Newsletter } from './pages/Newsletter';
import { NotFound } from './pages/NotFound';
import { OrderStatus, Track } from './pages/OrderStatus';
import { StudyHub } from './pages/StudyHub';
import { PopupHost } from './components/popups/PopupHost';
import { dropPrerenderUnless } from './prerender';

function ScrollToTop() {
  const { pathname } = useLocation();
  // A block body: in newer browsers scrollTo returns a Promise, which React would take for a clean-up function.
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  // Meta page view (only after the visitor accepted cookies).
  useEffect(() => { track('PageView'); }, [pathname]);
  // A ready-made page from the server belongs to its own address only.
  useLayoutEffect(() => dropPrerenderUnless(pathname), [pathname]);
  return null;
}

function Layout() {
  const { pathname } = useLocation();
  return (
    <>
      <ScrollToTop />
      {config.showTopBar && <TopBar />}
      <Header />
      <main className="main"><div key={pathname} className="page-enter"><Outlet /></div></main>
      <Footer />
      <CartDrawer />
      <CookieBanner />
    </>
  );
}

/** /competitions/<slug>/anything → the competition's page. */
function ToCompetition() {
  const { slug = '' } = useParams();
  return <Navigate to={`/competitions/${slug}`} replace />;
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
    <div className="site">
    <CatalogProvider>
    <CartProvider>
    <SiteProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="catalogue" element={<Catalogue />} />
          <Route path="store" element={<Catalogue />} />
          <Route path="books/:slug" element={<BookDetail />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="order/:number" element={<OrderStatus />} />
          <Route path="track" element={<Track />} />
          <Route path="account" element={<Account />} />
          <Route path="account/competitions" element={<Navigate to="/account?tab=competitions" replace />} />
          <Route path="competitions" element={<CompetitionsPage />} />
          <Route path="competitions/:slug" element={<CompetitionPage />} />
          <Route path="competitions/:slug/rules" element={<CompetitionRules />} />
          <Route path="competitions/:slug/confirmation/:id" element={<TeamConfirmation />} />
          <Route path="competitions/:slug/*" element={<ToCompetition />} />
          {/* Addresses from the earlier competitions system (links in old emails). */}
          {['account/students', 'onboarding', 'approve/:token', 'invite/:token'].map((p) => <Route key={p} path={p} element={<Navigate to="/account" replace />} />)}
          <Route path="newsletter" element={<Newsletter />} />
          <Route path="study-hub" element={<StudyHub />} />
          <Route path="about" element={<About />} />
          <Route path="contact" element={<Contact />} />
          {LEGAL.map((d) => <Route key={d.key} path={d.path.slice(1)} element={<LegalPage doc={d.key} />} />)}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <PopupHost />
    </SiteProvider>
    </CartProvider>
    </CatalogProvider>
    </div>
    </MotionConfig>
  );
}
