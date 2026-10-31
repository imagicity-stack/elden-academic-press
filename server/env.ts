// Server environment. Secrets are read here only — never import this from src/.
import { z } from 'zod';

const optional = z.string().trim().optional().transform((v) => (v ? v : undefined));

const schema = z.object({
  /** Supabase Postgres connection (use the transaction pooler URL, port 6543). Unset locally = embedded PGlite. */
  DATABASE_URL: optional,
  /** Local embedded database folder (development only). */
  PGLITE_DIR: z.string().default('.data/pglite'),
  SITE_URL: z.string().default('http://localhost:5173'),
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

  /** Sender of every email, e.g. "Elden Academic Press <hello@eldenap.in>". */
  MAIL_FROM: z.string().default('Elden Academic Press <hello@eldenap.in>'),
  /** Where contact forms and enquiries are sent (comma-separated for several). */
  MAIL_TO: optional,
  /** Google Workspace (or other SMTP) sending; takes priority over Resend when user and password are set. */
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  RESEND_API_KEY: optional,

  /** The first person to sign in with this email becomes the store owner. */
  ADMIN_OWNER_EMAIL: optional,
  /** Vercel Cron sends this as a bearer token. */
  CRON_SECRET: optional,

  /** Local-only conveniences; ignored whenever the code runs on Vercel. */
  ALLOW_DEV_ADMIN: optional,
  ALLOW_PAYMENT_SIMULATOR: optional,
});

export type Env = z.infer<typeof schema> & {
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
    onVercel,
    isProduction,
    devAdmin: !onVercel && parsed.ALLOW_DEV_ADMIN === 'true',
    paymentSimulator: !onVercel && parsed.ALLOW_PAYMENT_SIMULATOR === 'true' && !parsed.RAZORPAY_KEY_SECRET,
  };
}
