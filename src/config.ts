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
};
