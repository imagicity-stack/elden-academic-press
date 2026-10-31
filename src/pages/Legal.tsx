import { useEffect, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Logo } from '../components/Brand';
import '../fonts';
import '../interior.css';
import { config } from '../config';
import { LEGAL, legalDocFor, type LegalDoc } from '../legal';
import { inr } from '../store/api';
import { useStoreConfig } from '../store/catalog';

const { company: C, grievanceOfficer: G, policy: P } = config;

// Plain links (not router links) so they also work from the pre-launch policy pages.
const Mail = ({ to = config.contactEmail }: { to?: string }) => <a href={`mailto:${to}`}>{to}</a>;
const Page = ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>;
const Doc = ({ doc, children }: { doc: LegalDoc; children: ReactNode }) => <NavLink to={LEGAL.find((d) => d.key === doc)!.path}>{children}</NavLink>;

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="legal__section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function GrievanceOfficer() {
  return (
    <address className="legal__card">
      <strong>{G.name || 'Grievance Officer'}</strong>
      {G.name && <span>Grievance Officer</span>}
      <span>{C.legalName}</span>
      <span>{C.address}</span>
      <span>Email: <Mail to={G.email} /></span>
      {G.phone && <span>Phone: <a href={`tel:${G.phone.replace(/\s/g, '')}`}>{G.phone}</a></span>}
    </address>
  );
}

function Terms() {
  return (
    <>
      <Section title="1. Who we are">
        <p>
          This website, eldenap.in, is run by <strong>{C.legalName}</strong>, which publishes under the name
          Elden Academic Press (“Elden”, “we”, “us”). Registered office: {C.address}. Email: <Mail />.
        </p>
        {(C.cin || C.gstin) && <p>{[C.cin && `CIN: ${C.cin}`, C.gstin && `GSTIN: ${C.gstin}`].filter(Boolean).join(' · ')}</p>}
        <p>By using this website or placing an order, you agree to these terms, our <Doc doc="privacy">privacy policy</Doc>, our <Doc doc="refunds">cancellation and refund policy</Doc> and our <Doc doc="shipping">shipping policy</Doc>.</p>
      </Section>

      <Section title="2. Buying from us">
        <p>Orders should be placed by someone aged 18 or over. If you are a student under 18, please ask a parent or guardian to order for you.</p>
        <p>We describe our books, e-books and journals as accurately as we can. Covers and colours on screen may differ slightly from the printed copy.</p>
        <p>Prices are in Indian rupees and include GST. Delivery charges, if any, are shown in your cart and at checkout before you pay. Prices can change, but the price shown at checkout is the price you pay for that order.</p>
        <p>If a price is clearly wrong because of an error, we will tell you before dispatch and you can either pay the correct price or cancel for a full refund.</p>
      </Section>

      <Section title="3. Orders and payment">
        <p>After you pay you receive a confirmation email with your order number and a private link to your order. Your order is accepted once the payment is confirmed.</p>
        <p>Payments are processed by Razorpay (UPI, cards, net banking and wallets). We never see or store your card or UPI details. An order that is not paid within the time shown at checkout lapses and nothing is charged.</p>
        <p>We may cancel an order, with a full refund, if an item is unavailable, we cannot deliver to the address given, or we suspect fraud. School and bulk orders agreed by quotation follow the terms of that quotation.</p>
      </Section>

      <Section title="4. E-books">
        <p>When you buy an e-book you receive a personal, non-transferable licence to download it and read it for your own study or teaching. It is not a sale of the copyright.</p>
        <p>Each purchase allows a limited number of downloads within a set period, shown on your order page. Please save a copy on your device.</p>
        <p>You may not share, copy, upload, resell or distribute e-book files, or remove any marks that identify the buyer. We may stop access to downloads if a file is being misused.</p>
      </Section>

      <Section title="5. Free resources">
        <p>Sample papers, notes, answer keys and other files in the <Page to="/study-hub">Study Hub</Page> are free for personal study and classroom use. They may not be sold or republished.</p>
      </Section>

      <Section title="6. Copyright and trade marks">
        <p>The books, text, illustrations, website design and the Elden name and logo belong to us or to our authors and licensors, and are protected by the Copyright Act, 1957 and trade mark law. Do not reproduce them without our written permission, except as the law allows.</p>
      </Section>

      <Section title="7. Using the website">
        <p>Please do not misuse the website: no attempts to break its security, overload it, copy its content in bulk, or submit false information or someone else’s details.</p>
      </Section>

      <Section title="8. Our responsibility">
        <p>We take care that our content is accurate and up to date with the syllabus, but study material cannot guarantee any exam result.</p>
        <p>As far as the law allows, our liability for any order is limited to the amount paid for that order, and we are not liable for indirect losses. Nothing in these terms affects your rights under the Consumer Protection Act, 2019.</p>
      </Section>

      <Section title="9. Complaints">
        <p>Write to our Grievance Officer. We acknowledge complaints within 48 hours and aim to resolve them within one month.</p>
        <GrievanceOfficer />
      </Section>

      <Section title="10. Law and disputes">
        <p>These terms are governed by the laws of India. Subject to your right to approach a consumer commission, the courts at Hazaribagh, Jharkhand have jurisdiction.</p>
      </Section>

      <Section title="11. Changes">
        <p>We may update these terms. The date at the top shows the latest version; the version in force when you placed an order applies to that order.</p>
      </Section>
    </>
  );
}

function Privacy() {
  return (
    <>
      <p className="legal__lead">
        This policy explains what personal data {C.legalName} (Elden Academic Press) collects through eldenap.in, why, who it is
        shared with, and your rights under the Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000.
      </p>

      <Section title="1. What we collect">
        <ul>
          <li><strong>When you order:</strong> your name, email, phone number, delivery address (for printed books), state (for GST), what you bought and paid, any discount code, and the payment reference from Razorpay. We do not receive your card or UPI details.</li>
          <li><strong>When you send a form</strong> (sample request, school order, enquiry or proposal): your name, contact details, institution, city, role and message.</li>
          <li><strong>Technical data:</strong> your IP address and browser details in our server logs, used for security and to prevent abuse.</li>
          <li><strong>In your browser:</strong> your cart and a few preferences (such as whether you have seen the opening animation) are kept in your browser’s storage. We do not use advertising or tracking cookies or third-party analytics. Fonts are loaded from Google Fonts, and Razorpay sets its own cookies when you pay.</li>
        </ul>
      </Section>

      <Section title="2. How we use it">
        <ul>
          <li>to process, deliver and support your order, including emails about it (confirmation, dispatch, downloads, refunds);</li>
          <li>to issue invoices and keep the records that tax and accounting laws require;</li>
          <li>to reply to your enquiries;</li>
          <li>to keep the website secure and prevent fraud.</li>
        </ul>
        <p>We use your data with your consent, given when you place an order or send a form, and where the law allows or requires it. We do not sell your data, and we do not send marketing emails unless you ask for them.</p>
      </Section>

      <Section title="3. Who we share it with">
        <p>Only what each needs to do its job for us:</p>
        <ul>
          <li><strong>Razorpay</strong>: payments and refunds;</li>
          <li><strong>courier and postal partners</strong>: your name, address and phone number, to deliver printed books;</li>
          <li><strong>Supabase</strong>: our database and file storage;</li>
          <li><strong>Vercel</strong>: website hosting;</li>
          <li><strong>Resend</strong>: sending our emails;</li>
          <li><strong>authorities</strong>, when the law requires it.</li>
        </ul>
        <p>Some of these providers may process data outside India, under their own security and confidentiality obligations.</p>
      </Section>

      <Section title="4. How long we keep it">
        <p>Order and invoice records are kept for as long as tax and company law require (generally up to eight years). Enquiries are kept for up to two years after our last contact. Server logs are kept for a short period. After that, data is deleted or anonymised.</p>
      </Section>

      <Section title="5. Security">
        <p>The website uses encrypted connections (HTTPS). Our database is accessible only to our server, staff sign in with two-step verification, e-book files are stored privately, and payments are handled by Razorpay to industry security standards. If a breach affects your data, we will inform you and the authorities as the law requires.</p>
      </Section>

      <Section id="grievance" title="6. Your rights">
        <p>You can ask us for a summary of the personal data we hold about you, ask us to correct or update it, ask us to erase it (except what we must keep by law), withdraw your consent, nominate someone to exercise these rights for you, and raise a grievance. Withdrawing consent does not affect what was done before, but we may not be able to complete an order without the details it needs.</p>
        <p>Write to our Grievance Officer. We will reply within 30 days. If you are not satisfied, you may approach the Data Protection Board of India.</p>
        <GrievanceOfficer />
      </Section>

      <Section title="7. Children">
        <p>Our books are written for students, but orders and forms should be completed by an adult. If you are under 18, please ask a parent or guardian. If you believe a child has given us personal data without a parent’s consent, write to us and we will delete it.</p>
      </Section>

      <Section title="8. Changes">
        <p>We may update this policy. The date at the top shows the latest version.</p>
      </Section>
    </>
  );
}

function Refunds() {
  return (
    <>
      <Section title="1. Cancelling an order">
        <ul>
          <li><strong>Printed books:</strong> you can cancel any time before your order is dispatched, for a full refund including delivery charges. Once dispatched, it can no longer be cancelled.</li>
          <li><strong>E-books:</strong> you can cancel within {P.ebookCancelDays} days of purchase for a full refund, as long as the e-book has not been downloaded. Once downloaded, an e-book cannot be cancelled or refunded, except as described in section 3.</li>
          <li><strong>E-book + printed copy:</strong> each part follows its own rule above. If only one part can be cancelled, we refund that part’s share of the bundle price.</li>
        </ul>
        <p>To cancel, email <Mail /> with your order number.</p>
      </Section>

      <Section title="2. Damaged, misprinted or wrong books">
        <p>If a printed book arrives damaged, has missing or misprinted pages, or is not what you ordered, email <Mail /> within <strong>{P.reportDays} days of delivery</strong> with your order number and photos. We will send a replacement free of charge or give you a full refund for that item, whichever you prefer, subject to stock. If we need the book back, we will arrange the return or repay the postage.</p>
        <p>We do not accept returns of printed books in good condition for a change of mind.</p>
      </Section>

      <Section title="3. Faulty e-book files">
        <p>If an e-book file does not open, is incomplete or is the wrong title, tell us. We will send a corrected file or, if we cannot, refund it in full.</p>
      </Section>

      <Section title="4. How refunds are paid">
        <p>Refunds go back to the original payment method through Razorpay. We start the refund within two working days of approving it and email you when it is issued. Your bank or card provider usually takes {P.refundTime} to show it.</p>
        <p>If money left your account but you did not receive an order confirmation, please do not pay again. The payment is normally matched to your order automatically; you can check it with <Page to="/track">Track an order</Page>. If the order still does not appear, email us with the payment reference. Unmatched payments are returned by your bank or Razorpay, usually within {P.refundTime}.</p>
      </Section>

      <Section title="5. Undelivered parcels">
        <p>If a parcel comes back to us because the address was incomplete or nobody accepted it, we will contact you to send it again (delivery charged again) or refund the price of the books. Original delivery charges are not refunded in this case.</p>
      </Section>

      <Section title="6. School and bulk orders">
        <p>Orders placed by quotation follow the cancellation and return terms agreed in the quotation.</p>
      </Section>

      <Section title="7. Questions">
        <p>Email <Mail /> or see our <Page to="/contact">contact page</Page>. Unresolved complaints can go to our Grievance Officer, listed in our <Doc doc="terms">terms</Doc>.</p>
      </Section>
    </>
  );
}

function Shipping() {
  const cfg = useStoreConfig();
  const charges = !cfg
    ? 'Delivery charges, if any, are shown in your cart before you pay.'
    : cfg.shipping.flat === 0
      ? 'Delivery is free on all orders.'
      : `Delivery costs ${inr(cfg.shipping.flat)} per order` +
        (cfg.shipping.freeAbove > 0 ? `, and is free on orders of ${inr(cfg.shipping.freeAbove)} or more (after discounts).` : '.');
  return (
    <>
      <Section title="1. Where we deliver">
        <p>We deliver printed books to addresses in India.</p>
      </Section>

      <Section title="2. Charges">
        <p>{charges} The exact amount is shown in your cart and at checkout before you pay. E-books carry no delivery charge.</p>
      </Section>

      <Section title="3. Dispatch and delivery times">
        <p>Orders are dispatched within <strong>{P.dispatch}</strong> of payment. Orders placed on Sundays or public holidays are processed on the next working day.</p>
        <p>Delivery usually takes <strong>{P.delivery}</strong> after dispatch, depending on your location. Remote areas, bad weather, strikes and other events outside our control can cause delays; we will keep you informed.</p>
      </Section>

      <Section title="4. Tracking">
        <p>When your order is dispatched we email you the courier name and tracking number. You can also see it on your order page or with <Page to="/track">Track an order</Page>.</p>
      </Section>

      <Section title="5. E-books">
        <p>E-books are not shipped. They are available to download as soon as your payment is confirmed, from your order page and the link in your confirmation email.</p>
      </Section>

      <Section title="6. Your address">
        <p>Please check your delivery address and phone number at checkout. If you need to change them, email <Mail /> before the order is dispatched. For parcels that cannot be delivered, see our <Doc doc="refunds">refund policy</Doc>.</p>
      </Section>

      <Section title="7. Damaged parcels">
        <p>If a parcel looks opened or badly damaged, please note it with the courier or refuse it, and tell us within {P.reportDays} days of delivery. We will replace or refund damaged books as set out in our <Doc doc="refunds">refund policy</Doc>.</p>
      </Section>

      <Section title="8. School and bulk orders">
        <p>Delivery dates and charges for school and bulk orders are agreed in the quotation.</p>
      </Section>
    </>
  );
}

const BODIES: Record<LegalDoc, () => ReactNode> = { terms: Terms, privacy: Privacy, refunds: Refunds, shipping: Shipping };

export function LegalPage({ doc }: { doc: LegalDoc }) {
  const meta = LEGAL.find((d) => d.key === doc)!;
  const Body = BODIES[doc];
  return (
    <div className="wrap legal">
      <div className="crumbs crumbs--28">
        <a href="/">Home</a><span>/</span><span className="crumbs__here">{meta.short}</span>
      </div>
      <div className="eyebrow">Policies</div>
      <h1 className="h1-page legal__title">{meta.title}</h1>
      <p className="legal__updated">Last updated {P.updated}</p>
      <nav className="legal__tabs" aria-label="Policies">
        {LEGAL.map((d) => <NavLink key={d.key} to={d.path} className="legal__tab">{d.short}</NavLink>)}
      </nav>
      <div className="legal__body"><Body /></div>
    </div>
  );
}

/** Company name and address, required on every page of an online store. */
export function CompanyLine({ className = '' }: { className?: string }) {
  return <p className={className}>Elden Academic Press is a publishing imprint of {C.legalName}, {C.address}.</p>;
}

/** Before launch: the policies on their own, so payment providers and visitors can read them. */
export function LegalStandalone() {
  const { pathname } = useLocation();
  const doc = legalDocFor(pathname) ?? 'terms';
  // A block body: in newer browsers scrollTo returns a Promise, which React would take for a clean-up function.
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <div className="site legal-shell">
      <header className="legal-shell__head">
        <div className="wrap"><a href="/" aria-label="Elden Academic Press home"><Logo /></a></div>
      </header>
      <main><LegalPage doc={doc} /></main>
      <footer className="legal-shell__foot">
        <div className="wrap">
          <CompanyLine />
          <p>© 2026 Elden Academic Press · <Mail /></p>
        </div>
      </footer>
    </div>
  );
}
