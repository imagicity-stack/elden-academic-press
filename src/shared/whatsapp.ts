// WhatsApp (Meta WhatsApp Cloud API): what the site sends, the templates it uses and their
// settings. Shared by the server and Admin → WhatsApp.
//
// Messages that start a conversation must be templates approved by Meta in WhatsApp Manager.
// Each template below has a fixed list of body variables, {{1}}, {{2}}, ... in this order. The
// site can create them all in the WhatsApp account (Admin → WhatsApp → Settings); Meta then
// reviews them (see docs/STORE-SETUP.md §16).

export type WaKind = 'cart' | 'order_confirmed' | 'shipped' | 'ebook_ready' | 'new_books' | 'call_followup' | 'missed_call' | 'reply' | 'inbound';
export type WaStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped' | 'received';

/**
 * The templates the site sends, with their body variables in order. `text` is the body the site
 * creates in WhatsApp Manager (Admin → WhatsApp → Settings → Create templates) and `samples` the
 * example values Meta asks for. Meta's rules: a variable can't start or end the text, and two
 * variables can't sit side by side.
 */
export const WA_TEMPLATES: { key: Exclude<WaKind, 'reply' | 'inbound'>; label: string; category: 'UTILITY' | 'MARKETING'; name: string; vars: string[]; text: string; samples: string[] }[] = [
  {
    key: 'cart', label: 'Cart reminder', category: 'MARKETING', name: 'elden_cart_reminder',
    vars: ['customer name', 'books in the cart', 'cart total', 'finish-your-order link'],
    text: 'Hi {{1}}, your books are still in your cart at Elden Academic Press: {{2}} ({{3}}). Finish your order here: {{4}} Reply to this message if you need any help.',
    samples: ['Asha', 'Mathematics Today x2', '₹798.00', 'https://eldenap.in/checkout?resume=abc123'],
  },
  {
    key: 'order_confirmed', label: 'Order confirmed', category: 'UTILITY', name: 'elden_order_confirmed',
    vars: ['customer name', 'order number', 'order total', 'order link'],
    text: 'Hi {{1}}, thank you for your order! Order #{{2}} for {{3}} is confirmed. See your order and downloads here: {{4}} Thank you for choosing Elden Academic Press.',
    samples: ['Asha', '1042', '₹798.00', 'https://eldenap.in/order/1042?t=abc123'],
  },
  {
    key: 'shipped', label: 'Order shipped', category: 'UTILITY', name: 'elden_order_shipped',
    vars: ['customer name', 'order number', 'courier and tracking', 'order link'],
    text: 'Hi {{1}}, your books for order #{{2}} are on their way. {{3}}. Order details: {{4}} Thank you for choosing Elden Academic Press.',
    samples: ['Asha', '1042', 'DTDC tracking number D12345678', 'https://eldenap.in/order/1042?t=abc123'],
  },
  {
    key: 'ebook_ready', label: 'Free e-book ready', category: 'UTILITY', name: 'elden_ebook_ready',
    vars: ['customer name', 'order number', 'order link'],
    text: 'Hi {{1}}, your books for order #{{2}} have been delivered and your free e-book is ready to download here: {{3}} Happy reading!',
    samples: ['Asha', '1042', 'https://eldenap.in/order/1042?t=abc123'],
  },
  {
    key: 'call_followup', label: 'After a call', category: 'UTILITY', name: 'elden_call_followup',
    vars: ['customer name', 'what happens next', 'link'],
    text: 'Hi {{1}}, thank you for speaking with Elden Academic Press on the phone. {{2}} Link: {{3}} Reply here if you have any questions.',
    samples: ['Asha', 'Here is the link to finish your order; use code COMEBACK10 at checkout.', 'https://eldenap.in/checkout?resume=abc123'],
  },
  {
    key: 'missed_call', label: 'Missed our call', category: 'UTILITY', name: 'elden_missed_call',
    vars: ['customer name', 'what the call was about', 'link'],
    text: 'Hi {{1}}, we tried to call you from Elden Academic Press about {{2}}. You can continue here: {{3}} Or reply to this message and we will help.',
    samples: ['Asha', 'the books in your cart', 'https://eldenap.in/checkout?resume=abc123'],
  },
  {
    key: 'new_books', label: 'New books (to subscribers)', category: 'MARKETING', name: 'elden_new_books',
    vars: ['customer name', 'your message', 'link'],
    text: 'Hi {{1}}, new from Elden Academic Press: {{2}} See them here: {{3}} Reply STOP to stop these messages.',
    samples: ['Asha', 'Mathematics Today for Class 10 (2027 edition) is out, with 40 solved sample papers.', 'https://eldenap.in/books'],
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
export const WA_STOP = /^\s*(stop|unsubscribe|stop all|band karo|बंद करो)\s*[.!]?\s*$/i;
export const WA_START = /^\s*(start|subscribe|unstop)\s*[.!]?\s*$/i;
