// WhatsApp (Meta WhatsApp Cloud API): what the site sends, the templates it uses and their
// settings. Shared by the server and Admin → WhatsApp.
//
// Messages that start a conversation must be templates approved by Meta in WhatsApp Manager.
// Each template has a header, a body with variables {{1}}, {{2}}… in a fixed order, a footer and
// a link button whose path is filled in per customer. The site creates or updates them all in
// the WhatsApp account (Admin → WhatsApp → Settings); Meta then reviews them (STORE-SETUP §16).

export type WaKind = 'cart' | 'order_confirmed' | 'shipped' | 'ebook_ready' | 'new_books' | 'call_followup' | 'missed_call' | 'reply' | 'inbound';
export type WaStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped' | 'received';

export interface WaTemplateDef {
  key: Exclude<WaKind, 'reply' | 'inbound'>;
  label: string;
  category: 'UTILITY' | 'MARKETING';
  name: string;
  /** Bold title at the top (plain text: Meta allows no variables, emoji or formatting here). */
  header: string;
  /** The message. {{1}}, {{2}}… are filled in per customer; *bold* works. */
  text: string;
  /** What each body variable holds, in order. */
  vars: string[];
  /** Example values Meta's reviewers see, one per variable. */
  samples: string[];
  /** Small grey line at the bottom. */
  footer: string;
  /** The link button: opens <site>/<path>, the path filled in per customer (e.g. the order link). */
  button: { label: string; sample: string };
  /** An optional one-tap reply button. */
  quickReply?: string;
}

/**
 * The templates the site sends. The site creates or updates them in the WhatsApp account
 * (Admin → WhatsApp → Settings → Update all templates in Meta) and Meta reviews them.
 * Meta's rules: a body variable can't start or end the text, two variables can't sit side by side,
 * and the header and footer are plain text.
 */
export const WA_TEMPLATES: WaTemplateDef[] = [
  {
    key: 'cart', label: 'Cart reminder', category: 'MARKETING', name: 'elden_cart_reminder',
    header: 'Your books are saved for you',
    text: 'Hi {{1}} 👋\n\nYou picked some great books earlier, and we have kept them safe in your cart:\n\n📚 *{{2}}*\n💳 Total: *{{3}}*\n\nWhenever you are ready, you can pick up right where you left off. If anything held you back, a question about the books, delivery or payment, just reply here. We are happy to help!',
    vars: ['customer name', 'books in the cart', 'cart total'],
    samples: ['Asha', 'Mathematics Today x2', '₹798.00'],
    footer: 'Elden Academic Press · eldenap.in',
    button: { label: 'Complete my order', sample: 'checkout?resume=abc123' },
  },
  {
    key: 'order_confirmed', label: 'Order confirmed', category: 'UTILITY', name: 'elden_order_confirmed',
    header: 'Thank you for your order!',
    text: 'Hi {{1}}, thank you for choosing Elden Academic Press! 🎉\n\nYour order *#{{2}}* is confirmed.\nOrder total: *{{3}}*\n\nWe are getting everything ready with care and will message you as soon as it is on its way. Your invoice and any e-books are waiting on your order page.',
    vars: ['customer name', 'order number', 'order total'],
    samples: ['Asha', '1042', '₹798.00'],
    footer: 'Elden Academic Press · eldenap.in',
    button: { label: 'View my order', sample: 'order/1042?t=abc123' },
  },
  {
    key: 'shipped', label: 'Order shipped', category: 'UTILITY', name: 'elden_order_shipped',
    header: 'Your books are on their way',
    text: 'Great news, {{1}}! 📦\n\nYour order *#{{2}}* has left our office and is heading to you.\n\n{{3}}\n\nTap below any time for your order details. We hope you enjoy every page!',
    vars: ['customer name', 'order number', 'courier and tracking'],
    samples: ['Asha', '1042', 'Courier: India Post · Tracking number: EK123456789IN'],
    footer: 'Elden Academic Press · eldenap.in',
    button: { label: 'Track my order', sample: 'order/1042?t=abc123' },
  },
  {
    key: 'ebook_ready', label: 'Free e-book ready', category: 'UTILITY', name: 'elden_ebook_ready',
    header: 'Your free e-book is ready',
    text: 'Hi {{1}}, your books for order *#{{2}}* have arrived, and your free e-book is now unlocked! 📖\n\nTo get it, sign in on our website with Google using *{{3}}*, the email you ordered with. It takes a minute, and your e-book will be waiting in your Library. Happy learning!',
    vars: ['customer name', 'order number', 'email to sign in with'],
    samples: ['Asha', '1042', 'asha.verma@gmail.com'],
    footer: 'Elden Academic Press · eldenap.in',
    button: { label: 'Get my e-book', sample: 'account?tab=library' },
  },
  {
    key: 'call_followup', label: 'After a call', category: 'UTILITY', name: 'elden_call_followup',
    header: 'Lovely speaking with you',
    text: 'Hi {{1}}, thank you for taking the time to talk with us today! 😊\n\n{{2}}\n\nIf anything else comes to mind, just reply to this message. We are always happy to help.',
    vars: ['customer name', 'what happens next'],
    samples: ['Asha', 'Your cart is saved: tap the button below to finish your order. Use code *COMEBACK10* at checkout.'],
    footer: 'Elden Academic Press · eldenap.in',
    button: { label: 'Continue', sample: 'checkout?resume=abc123' },
  },
  {
    key: 'missed_call', label: 'Missed our call', category: 'UTILITY', name: 'elden_missed_call',
    header: 'Sorry we missed you',
    text: 'Hi {{1}}, we gave you a quick call about {{2}} but could not reach you. No worries at all!\n\nYou can continue online in a tap, or simply reply here whenever it suits you and we will be glad to help.',
    vars: ['customer name', 'what the call was about'],
    samples: ['Asha', 'the books in your cart'],
    footer: 'Elden Academic Press · eldenap.in',
    button: { label: 'Continue online', sample: 'checkout?resume=abc123' },
  },
  {
    key: 'new_books', label: 'New books (to subscribers)', category: 'MARKETING', name: 'elden_new_books',
    header: 'Something new for you',
    text: 'Hi {{1}} 👋\n\nWe have something we think you will love:\n\n{{2}}\n\nTake a look, and if you would like help choosing the right book, just reply here. Happy learning!',
    vars: ['customer name', 'your message'],
    samples: ['Asha', 'Mathematics Today for Class 10 (2027 edition) is out, with 40 fully solved sample papers.'],
    footer: 'Elden Academic Press · eldenap.in',
    button: { label: 'Explore new books', sample: 'books' },
  },
];

export type WaTemplateKey = (typeof WA_TEMPLATES)[number]['key'];

export interface WhatsAppSettings {
  /** Master switch: nothing is sent while off (replies from the inbox still work). */
  enabled: boolean;
  /** The templates' language code in WhatsApp Manager, e.g. en, en_US or hi. */
  language: string;
  /** Minutes after a checkout is left before the cart reminder. */
  cartDelayMinutes: number;
  /** Which automatic messages are on. */
  cart: boolean;
  orderConfirmed: boolean;
  shipped: boolean;
  ebookReady: boolean;
  /** After an AI voice call (Sarvam): a thank-you with the link, or "we tried to call you" when nobody answered. */
  callFollowup: boolean;
  /** Template names, if yours differ from the defaults. */
  templates: Record<WaTemplateKey, string>;
}

export const DEFAULT_WA_SETTINGS: WhatsAppSettings = {
  enabled: false,
  language: 'en',
  cartDelayMinutes: 30,
  cart: false,
  orderConfirmed: false,
  shipped: false,
  ebookReady: false,
  callFollowup: false,
  templates: Object.fromEntries(WA_TEMPLATES.map((t) => [t.key, t.name])) as Record<WaTemplateKey, string>,
};

export const WA_STATUS_LABEL: Record<WaStatus, string> = {
  queued: 'Waiting', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed', skipped: 'Not sent', received: 'Received',
};

/** Reminders and announcements go out only between these hours, India time; order updates any time. */
export const WA_DAY = { start: 9, end: 21 };

/** Customers may reply freely for 24 hours after their last message; after that only a template can be sent. */
export const WA_REPLY_WINDOW_MS = 24 * 3600_000;

/** Words that stop (or restart) our WhatsApp messages. */
export const WA_STOP = /^\s*(stop|unsubscribe|stop all|stop messages|stop promotions|band karo|बंद करो)\s*[.!]?\s*$/i;
export const WA_START = /^\s*(start|subscribe|unstop)\s*[.!]?\s*$/i;
