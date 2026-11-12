// Shapes returned by the store API (/api).
import type { LevelKey } from '../data';
import type { CodRule } from '../shared/cod';

export type Kind = 'print' | 'digital' | 'bundle';

export interface Format {
  price: number; compareAt: number | null; available: boolean; lowStock: number | null;
  /** Printed copy only: the e-book comes free with it. */
  includesEbook?: boolean;
}

export interface Category { id: number; name: string; slug: string }

export interface Product {
  id: string;
  slug: string;
  title: string;
  series: string;
  author: string;
  blurb: string;
  description: string;
  category: Category | null;
  level: LevelKey;
  classLabel: string;
  grade: number | null;
  boards: string[];
  subject: string;
  language: string;
  pages: number | null;
  edition: string;
  isbn: string;
  highlights: string[];
  contents: string[];
  coverUrl: string | null;
  /** More photos besides the cover. */
  images?: { url: string; alt: string }[];
  palette: number;
  companion: boolean;
  isNew: boolean;
  featured: boolean;
  formats: Partial<Record<Kind, Format>>;
}

export interface StoreConfig {
  storeName: string;
  payments: { keyId: string; simulated: boolean } | null;
  shipping: { flat: number; freeAbove: number };
  states: { code: string; name: string }[];
  supportEmail: string;
  /** Cash on delivery for printed books: the advance paid online (paise), or null when off. */
  /** Cash on delivery: how the advance paid online is worked out (src/shared/cod.ts). */
  cod: CodRule | null;
  /** Students are sent to Meta only from this age (META_MIN_AGE on the server). */
  metaMinAge?: number;
  /** Cookie banner off: every visitor counts as having accepted cookies (Admin → Settings). */
  consentAuto?: boolean;
}

export type LineIssue = { code: 'unavailable' } | { code: 'out_of_stock' } | { code: 'insufficient_stock'; available: number };

export interface QuoteLine {
  productId: string;
  slug: string;
  title: string;
  kind: Kind;
  formatLabel: string;
  quantity: number;
  unitPrice: number;
  compareAtPrice: number | null;
  lineTotal: number;
  discount: number;
  requiresShipping: boolean;
  isDigital: boolean;
  /** A printed copy that includes the e-book free. */
  includesEbook?: boolean;
  issue: LineIssue | null;
}

export interface Quote {
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  coupon: { code: string; description: string } | null;
  couponError: string | null;
  shipping: number;
  freeShippingRemaining: number;
  tax: number;
  taxBreakup: { cgst: number; sgst: number; igst: number };
  total: number;
  requiresShipping: boolean;
  hasDigital: boolean;
  ok: boolean;
}

export interface Resource { id: string; title: string; kind: string; level: LevelKey; subject: string; size: number | null; url: string | null }
