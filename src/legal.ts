// The policy pages. Kept apart from pages/Legal.tsx so main.tsx can route to
// them before launch without loading the pages themselves.
export type LegalDoc = 'terms' | 'privacy' | 'refunds' | 'shipping';

export const LEGAL: { key: LegalDoc; path: string; title: string; short: string }[] = [
  { key: 'terms', path: '/terms', title: 'Terms of use and sale', short: 'Terms' },
  { key: 'privacy', path: '/privacy', title: 'Privacy policy', short: 'Privacy' },
  { key: 'refunds', path: '/refunds', title: 'Cancellations, returns and refunds', short: 'Refunds' },
  { key: 'shipping', path: '/shipping', title: 'Shipping and delivery', short: 'Shipping' },
];

export const legalDocFor = (pathname: string) => LEGAL.find((d) => d.path === pathname.replace(/\/+$/, ''))?.key;
