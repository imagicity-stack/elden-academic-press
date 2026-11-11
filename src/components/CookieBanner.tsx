import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { getConsent, setConsent, type Consent } from '../consent';
import { bannerShown, choiceMade } from '../consentTrack';
import { EASE } from './motion';

/** The cookie choice: shown until the visitor picks, and again from "Cookie settings" in the footer. */
export function CookieBanner() {
  const [open, setOpen] = useState(() => getConsent() === null);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('elden:consent-open', show);
    return () => window.removeEventListener('elden:consent-open', show);
  }, []);
  // Analytics: counted once when a browser first sees the banner (anonymous counters only).
  useEffect(() => { if (open && getConsent() === null) bannerShown(); }, [open]);
  const choose = (c: Consent) => { choiceMade(getConsent(), c); setConsent(c); setOpen(false); };
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="cookie" role="region" aria-label="Cookie choice"
          initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1, transition: { delay: 0.6, duration: 0.45, ease: EASE } }} exit={{ y: 24, opacity: 0, transition: { duration: 0.2 } }}>
          <p className="cookie__text">
            We use cookies to see how the site is used and to show you relevant ads on Facebook and Instagram.
            Cookies for your cart and sign-in are always on. <Link to="/privacy">Privacy policy</Link>
          </p>
          <div className="cookie__actions">
            <button type="button" className="btn btn--yellow btn--md" onClick={() => choose('all')}>Accept all</button>
            <button type="button" className="btn btn--ghost-light btn--md" onClick={() => choose('essential')}>Only essential</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
