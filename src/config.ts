// Site-wide settings (were "Tweaks" in the Claude Design prototype).
export const config = {
  siteUrl: 'https://eldenap.in',
  /**
   * The separate elmaster edtech site. Empty = elmaster is mentioned without
   * any link or "Go to elmaster" buttons. Set the real address to turn them on.
   */
  elmasterUrl: '',
  /** Navy announcement bar above the header. */
  showTopBar: true,
  /** Pill link to elmaster in the header (needs elmasterUrl; hidden on narrow screens either way). */
  showElmasterInNav: true,
  contactEmail: 'hello@eldenap.in',
  headOffice: 'Hazaribagh, Jharkhand',
  /** Play the opening book animation (once per browser session). */
  showIntro: true,

  /** The company behind the store, shown in the footer, contact page and policies. */
  company: {
    legalName: 'FLYKRAFT SYNERIGIES PRIVATE LIMITED',
    address: 'Kolghatti, near Black Tank Reformatory School, Hazaribagh, Jharkhand 825310',
    /** Corporate Identity Number and GSTIN; each is shown once filled in. */
    cin: '',
    gstin: '',
  },
  /** Required under the Consumer Protection (E-Commerce) Rules 2020 and the DPDP Act 2023. */
  grievanceOfficer: { name: '', email: 'hello@eldenap.in', phone: '' },
  /** Terms quoted in the policies. */
  policy: {
    updated: '31 October 2026',
    /** Days after delivery to report a damaged, misprinted or wrong book. */
    reportDays: 7,
    /** Days after purchase to cancel an e-book that hasn't been downloaded. */
    ebookCancelDays: 7,
    dispatch: '1–3 working days',
    delivery: '3–7 working days',
    refundTime: '5–7 working days',
  },
};
