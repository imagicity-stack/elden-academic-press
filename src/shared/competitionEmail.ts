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

export const EMAIL_LABEL: Record<EmailType, string> = { registration_confirmed: 'Registration confirmed', submission_received: 'Entry received' };
export const AUDIENCE_LABEL: Record<Audience, string> = { parent: 'Parent version', student: 'Student version' };
export const ATTACHMENT_LIMIT = { files: 2, bytes: 5 * 1024 * 1024 };
export const BANNER_MAX_BYTES = 300 * 1024;

/** What the Student version may never carry, whatever is ticked. */
export function forAudience(t: TemplateContent, audience: Audience): TemplateContent {
  return audience === 'student' ? { ...t, blocks: { ...t.blocks, showReferral: false, showUpsell: false } } : t;
}

/** Problems that stop a save (and a test send). Same checks in the editor and on the server. */
export function templateProblems(t: TemplateContent, type: EmailType, audience: Audience, o: { hasBanner: boolean }): string[] {
  const out: string[] = [];
  const fields: [string, string][] = [
    ['subject', t.subject], ['preview text', t.preheader], ['heading', t.heading], ['body', t.bodyContent],
    ['primary button', `${t.primaryCtaLabel} ${t.primaryCtaUrl}`], ['secondary button', `${t.secondaryCtaLabel} ${t.secondaryCtaUrl}`],
  ];
  const all = new Set(MERGE_TAGS.map((m) => m.tag));
  for (const [where, text] of fields) {
    for (const tag of unknownTags(text, type, audience)) {
      const known = MERGE_TAGS.find((m) => m.tag === tag);
      if (!all.has(tag)) out.push(`{{${tag}}} in the ${where} isn’t a merge tag.`);
      else if (known?.only === 'parent') out.push(`{{${tag}}} can only be used in the Parent version (${where}).`);
      else out.push(`{{${tag}}} only works in the entry-received email (${where}).`);
    }
  }
  if (!t.subject.trim()) out.push('Add a subject line.');
  if (!t.heading.trim()) out.push('Add a heading.');
  if (!t.bodyContent.trim()) out.push('Add the body text.');
  for (const [name, label, url] of [['primary', t.primaryCtaLabel, t.primaryCtaUrl], ['secondary', t.secondaryCtaLabel, t.secondaryCtaUrl]] as const) {
    if (label.trim() && !url.trim()) out.push(`Add a link for the ${name} button, or clear its label.`);
    if (!label.trim() && url.trim()) out.push(`Add a label for the ${name} button, or clear its link.`);
    const sample = url.trim().replace(/\{\{\s*[a-z_]+\s*\}\}/g, 'https://eldenap.in');
    if (url.trim() && !/^(https:\/\/|mailto:)\S+$/.test(sample)) out.push(`The ${name} button link must be a merge tag or start with https:// or mailto:.`);
  }
  if ((t.bannerImageKey || o.hasBanner) && !t.bannerAlt.trim()) out.push('Add alt text for the banner (it shows when images are off).');
  if (t.attachmentKeys.length > ATTACHMENT_LIMIT.files) out.push('Attach at most 2 files.');
  return [...new Set(out)];
}
