// Server environment. Secrets are read here only — never import this from src/.
import { z } from 'zod';

const optional = z.string().trim().optional().transform((v) => (v ? v : undefined));

const schema = z.object({
  /** Supabase Postgres connection (use the transaction pooler URL, port 6543). Unset locally = embedded PGlite. */
  DATABASE_URL: optional,
  /** Local embedded database folder (development only). */
  PGLITE_DIR: z.string().default('.data/pglite'),
  /** The public address, e.g. https://eldenap.in: used in emails, the sitemap and staff invitations. */
  SITE_URL: optional,
  /** Signs customers' private order links. Long random string; changing it invalidates old links. */
  ORDER_LINK_SECRET: z.string().default('dev-order-link-secret'),

  RAZORPAY_KEY_ID: optional,
  RAZORPAY_KEY_SECRET: optional,
  RAZORPAY_WEBHOOK_SECRET: optional,

  SUPABASE_URL: optional,
  /** Service role / secret key: storage uploads, signed links, staff invites. */
  SUPABASE_SERVICE_ROLE_KEY: optional,
  /** Legacy JWT secret: needed only while the project still signs sign-ins with it (HS256). */
  SUPABASE_JWT_SECRET: optional,

  /** Sender of every email, e.g. "Elden Academic Press <noreply@eldenap.in>". Replies go to the support email. */
  MAIL_FROM: z.string().default('Elden Academic Press <noreply@eldenap.in>'),
  /** Our inboxes (comma-separated): they receive contact forms and a copy of every customer email. */
  MAIL_TO: optional,
  /** Google Workspace (or other SMTP) sending; takes priority over Resend when user and password are set. */
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  RESEND_API_KEY: optional,

  /** Meta Pixel / dataset ID (public; the browser uses it too). */
  VITE_META_PIXEL_ID: optional,
  /** Conversions API access token (secret). With the Pixel ID, the server reports events to Meta. */
  META_CAPI_TOKEN: optional,
  /** From Events Manager → Test events, while testing. Remove it to go live. */
  META_TEST_EVENT_CODE: optional,
  /** Student accounts are sent to Meta only from this age (by their date of birth); younger, or with no date
   *  of birth, nothing is sent, browser or server. Other accounts aren't affected. Change it here (Vercel), no code. */
  META_MIN_AGE: z.coerce.number().int().min(0).max(100).default(13),

  /** Voice-agent calls (Admin → Calls): the secret in the call-end webhook's address, so only the provider can post results. */
  CALLS_WEBHOOK_SECRET: optional,
  /** Sarvam Voice Agents workspace API key (apps.sarvam.ai → Settings → API Key; sent as X-API-Key). */
  SARVAM_API_KEY: optional,
  /** From the Sarvam dashboard address (…/orgs/<org id>/workspaces/<workspace id>/…). */
  SARVAM_ORG_ID: optional,
  SARVAM_WORKSPACE_ID: optional,
  /** The outgoing campaigns the site adds customers to, one per kind of call. All five set = calls are placed. */
  SARVAM_CART_CAMPAIGN_ID: optional,
  SARVAM_FEEDBACK_CAMPAIGN_ID: optional,

  /** WhatsApp Cloud API (Elden Academic Press portfolio): a system user's permanent access token (secret). */
  WHATSAPP_TOKEN: optional,
  /** The sending number's "Phone number ID" (WhatsApp Manager / the app's WhatsApp → API setup), not the number itself. */
  WHATSAPP_PHONE_NUMBER_ID: optional,
  /** The Meta app's App secret: checks that webhook deliveries really come from Meta. */
  WHATSAPP_APP_SECRET: optional,
  /** The WhatsApp Business Account id (WhatsApp Manager → Account tools / the app's API setup): to create and check the templates. */
  WHATSAPP_BUSINESS_ACCOUNT_ID: optional,
  /** Any long random string; typed into the app's webhook settings as the "Verify token". */
  WHATSAPP_VERIFY_TOKEN: optional,

  /** Delhivery B2C API token (Delhivery One → Settings → API setup, or from Delhivery's onboarding team). Secret. */
  DELHIVERY_API_TOKEN: optional,
  /** 'production' (track.delhivery.com, the default) or 'staging' (staging-express.delhivery.com, needs a staging token). */
  DELHIVERY_ENV: z.enum(['production', 'staging']).default('production'),
  /** Any long random string: the secret part of the address Delhivery pushes status updates to (docs/DELHIVERY.md). */
  DELHIVERY_WEBHOOK_SECRET: optional,

  /** The first person to sign in with this email becomes the store owner. */
  ADMIN_OWNER_EMAIL: optional,
  /** Vercel Cron sends this as a bearer token. */
  CRON_SECRET: optional,

  /** Local-only conveniences; ignored whenever the code runs on Vercel. */
  ALLOW_DEV_ADMIN: optional,
  ALLOW_PAYMENT_SIMULATOR: optional,
});

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i;
/** The store's own domain: used on Vercel when SITE_URL is missing or points at a local address. */
export const PUBLIC_SITE = 'https://eldenap.in';

/** "eldenap.in/" or "https://eldenap.in/" → "https://eldenap.in". */
const normalise = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`).replace(/\/+$/, '');

/**
 * The address links point to. Locally: the dev server. On Vercel: SITE_URL, but never
 * a localhost address (a common copy-paste slip), falling back to the store's domain.
 */
export function siteUrl(source: Record<string, string | undefined>, onVercel: boolean): string {
  const set = source.SITE_URL?.trim();
  if (!onVercel) return set ? normalise(set) : 'http://localhost:5173';
  if (set && !LOCAL.test(normalise(set))) return normalise(set);
  return PUBLIC_SITE;
}

export type Env = Omit<z.infer<typeof schema>, 'SITE_URL'> & {
  /** Public address without a trailing slash, never localhost on Vercel. */
  SITE_URL: string;
  /** Running on Vercel (production or preview). */
  onVercel: boolean;
  isProduction: boolean;
  devAdmin: boolean;
  paymentSimulator: boolean;
};

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.parse(source);
  const onVercel = Boolean(source.VERCEL);
  if (onVercel && (parsed.ORDER_LINK_SECRET === 'dev-order-link-secret' || parsed.ORDER_LINK_SECRET.length < 32)) {
    throw new Error('Set ORDER_LINK_SECRET to a random string of at least 32 characters');
  }
  const isProduction = source.VERCEL_ENV === 'production' || (source.NODE_ENV === 'production' && onVercel);
  return {
    ...parsed,
    SITE_URL: siteUrl(source, onVercel),
    onVercel,
    isProduction,
    devAdmin: !onVercel && parsed.ALLOW_DEV_ADMIN === 'true',
    paymentSimulator: !onVercel && parsed.ALLOW_PAYMENT_SIMULATOR === 'true' && !parsed.RAZORPAY_KEY_SECRET,
  };
}
