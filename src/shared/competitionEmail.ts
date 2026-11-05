// Per-competition emails: the merge tags, which version may use which, and the
// default templates every new competition starts with ("Reset to default").

export type EmailType = 'registration_confirmed' | 'submission_received';
export type Audience = 'parent' | 'student';

export interface MergeTag { tag: string; label: string; only?: 'submission' | 'parent' }

export const MERGE_TAGS: MergeTag[] = [
  { tag: 'parent_name', label: 'Parent’s name' },
  { tag: 'student_first_name', label: 'Student’s first name' },
  { tag: 'competition_title', label: 'Competition' },
  { tag: 'competition_url', label: 'Competition page link' },
  { tag: 'group_name', label: 'Group' },
  { tag: 'group_format', label: 'Group format' },
  { tag: 'registration_id', label: 'Registration ID' },
  { tag: 'entry_code', label: 'Entry code', only: 'submission' },
  { tag: 'submitted_at', label: 'Time received (IST)', only: 'submission' },
  { tag: 'submission_deadline', label: 'Submission deadline (IST)' },
  { tag: 'results_date', label: 'Results date' },
  { tag: 'submit_url', label: 'Submission page link' },
  { tag: 'resources_url', label: 'Resources page link' },
  { tag: 'referral_url', label: 'Referral link', only: 'parent' },
  { tag: 'support_email', label: 'Support email' },
];

/** Tags this email may use. */
export const tagsFor = (type: EmailType, audience: Audience) =>
  MERGE_TAGS.filter((t) => (t.only !== 'submission' || type === 'submission_received') && (t.only !== 'parent' || audience === 'parent'));

/** {{tags}} in the text that this email doesn't know. */
export function unknownTags(text: string, type: EmailType, audience: Audience): string[] {
  const ok = new Set(tagsFor(type, audience).map((t) => t.tag));
  return [...new Set([...text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]).filter((t) => !ok.has(t)))];
}

export interface EmailBlocks { showDetails: boolean; showPrizes: boolean; showRules: boolean; showResources: boolean; showReferral: boolean; showUpsell: boolean }
export interface TemplateContent {
  enabled: boolean; subject: string; preheader: string; bannerImageKey: string | null; bannerAlt: string; heading: string; bodyContent: string;
  primaryCtaLabel: string; primaryCtaUrl: string; secondaryCtaLabel: string; secondaryCtaUrl: string; blocks: EmailBlocks; attachmentKeys: string[];
}

const blocks = (o: Partial<EmailBlocks>): EmailBlocks => ({ showDetails: false, showPrizes: false, showRules: false, showResources: false, showReferral: false, showUpsell: false, ...o });

export function defaultTemplate(type: EmailType, audience: Audience, bannerAlt = ''): TemplateContent {
  const base = { enabled: true, bannerImageKey: null, bannerAlt, attachmentKeys: [] as string[] };
  if (type === 'registration_confirmed' && audience === 'parent') {
    return {
      ...base,
      subject: 'Registration confirmed: {{student_first_name}} is in {{competition_title}}',
      preheader: 'Submit the entry by {{submission_deadline}}. Your free resources are ready.',
      heading: 'You’re in! {{student_first_name}} is registered.',
      bodyContent: `Hello {{parent_name}},

{{student_first_name}} is now registered for **{{competition_title}}** by Elden Academic Press.

Here’s what to do next:
1. Download the free resources for this competition.
2. Read the rules once with {{student_first_name}}.
3. Upload the entry before the deadline.

कोई सवाल? Just reply to this email or write to {{support_email}}.`,
      primaryCtaLabel: 'Submit the entry', primaryCtaUrl: '{{submit_url}}',
      secondaryCtaLabel: 'Download resources', secondaryCtaUrl: '{{resources_url}}',
      blocks: blocks({ showDetails: true, showPrizes: true, showRules: true, showResources: true, showReferral: true, showUpsell: true }),
    };
  }
  if (type === 'registration_confirmed') {
    return {
      ...base,
      subject: 'You’re in, {{student_first_name}}! {{competition_title}} starts now',
      preheader: 'Your entry is due by {{submission_deadline}}.',
      heading: 'You’re registered. Now show us what you’ve got.',
      bodyContent: `Hi {{student_first_name}},

You’re registered for **{{competition_title}}**. Download the resources, read the rules and start working on your entry.

Remember: your entry must be your own original work. Upload it before the deadline.

All the best!`,
      primaryCtaLabel: 'Submit my entry', primaryCtaUrl: '{{submit_url}}',
      secondaryCtaLabel: 'Get the resources', secondaryCtaUrl: '{{resources_url}}',
      blocks: blocks({ showDetails: true, showPrizes: true, showRules: true, showResources: true }),
    };
  }
  if (audience === 'parent') {
    return {
      ...base,
      subject: 'Entry received: {{entry_code}}',
      preheader: 'You can make changes until {{submission_deadline}}.',
      heading: 'We’ve got {{student_first_name}}’s entry',
      bodyContent: `Hello {{parent_name}},

We received {{student_first_name}}’s entry for **{{competition_title}}** on {{submitted_at}}. The entry code is **{{entry_code}}**.

You can make changes until {{submission_deadline}}. Results come out on {{results_date}}.

We’ll email you if {{student_first_name}} is shortlisted.`,
      primaryCtaLabel: 'View my entry', primaryCtaUrl: '{{submit_url}}',
      secondaryCtaLabel: '', secondaryCtaUrl: '',
      blocks: blocks({ showDetails: true }),
    };
  }
  return {
    ...base,
    subject: 'Entry received: {{entry_code}}',
    preheader: 'You can make changes until {{submission_deadline}}.',
    heading: 'We’ve got your entry',
    bodyContent: `Hi {{student_first_name}},

We received your entry for **{{competition_title}}** on {{submitted_at}}. Your entry code is **{{entry_code}}**.

You can make changes until {{submission_deadline}}. Results come out on {{results_date}}.

All the best!`,
    primaryCtaLabel: 'View my entry', primaryCtaUrl: '{{submit_url}}',
    secondaryCtaLabel: '', secondaryCtaUrl: '',
    blocks: blocks({ showDetails: true }),
  };
}

export const EMAIL_KINDS: [EmailType, Audience][] = [
  ['registration_confirmed', 'parent'], ['registration_confirmed', 'student'], ['submission_received', 'parent'], ['submission_received', 'student'],
];
