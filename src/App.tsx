import { useEffect } from 'react';
import { Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { config } from './config';
import { SiteProvider } from './site';
import { Footer } from './components/Footer';
import { Header, TopBar } from './components/Header';
import { About } from './pages/About';
import { BookDetail } from './pages/BookDetail';
import { Catalogue } from './pages/Catalogue';
import { Contact } from './pages/Contact';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';
import { StudyHub } from './pages/StudyHub';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

function Layout() {
  return (
    <div className="shell">
      <ScrollToTop />
      {config.showTopBar && <TopBar />}
      <Header />
      <main className="main"><Outlet /></main>
      <Footer />
    </div>
  );
}

export function App() {
  return (
    <SiteProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="catalogue" element={<Catalogue />} />
          <Route path="books/:id" element={<BookDetail />} />
          <Route path="study-hub" element={<StudyHub />} />
          <Route path="about" element={<About />} />
          <Route path="contact" element={<Contact />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </SiteProvider>
  );
}
