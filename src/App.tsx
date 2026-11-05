import { useEffect } from 'react';
import { Outlet, Route, Routes, useLocation } from 'react-router-dom';
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
import { Approve } from './pages/Approve';
import { Invite } from './pages/Invite';
import { Onboarding } from './pages/Onboarding';
import { Students } from './pages/Students';
import { CompetitionList } from './pages/CompetitionList';
import { CompetitionDetail } from './pages/CompetitionDetail';
import { CompetitionRegister, RegistrationDone } from './pages/CompetitionRegister';
import { MyEntries } from './pages/MyEntries';
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

function ScrollToTop() {
  const { pathname } = useLocation();
  // A block body: in newer browsers scrollTo returns a Promise, which React would take for a clean-up function.
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  // Meta page view (only after the visitor accepted cookies).
  useEffect(() => { track('PageView'); }, [pathname]);
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
          <Route path="account/students" element={<Students />} />
          <Route path="account/competitions" element={<MyEntries />} />
          <Route path="competitions" element={<CompetitionList />} />
          <Route path="competitions/:slug" element={<CompetitionDetail />} />
          <Route path="competitions/:slug/register" element={<CompetitionRegister />} />
          <Route path="competitions/:slug/registered/:id" element={<RegistrationDone />} />
          <Route path="onboarding" element={<Onboarding />} />
          <Route path="approve/:token" element={<Approve />} />
          <Route path="invite/:token" element={<Invite />} />
          <Route path="newsletter" element={<Newsletter />} />
          <Route path="study-hub" element={<StudyHub />} />
          <Route path="about" element={<About />} />
          <Route path="contact" element={<Contact />} />
          {LEGAL.map((d) => <Route key={d.key} path={d.path.slice(1)} element={<LegalPage doc={d.key} />} />)}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </SiteProvider>
    </CartProvider>
    </CatalogProvider>
    </div>
    </MotionConfig>
  );
}
