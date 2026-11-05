// What a parent agrees to for each child (one-time, changeable from their account),
// and the default "own work" declaration. The version is stored with every consent
// record, so a new wording gets a new version.

export const CONSENT_VERSION = 'v1';

export type ConsentKind = 'data_processing' | 'publication' | 'marketing';

export const CONSENT_TEXT: Record<ConsentKind, { label: string; text: string; required: boolean }> = {
  data_processing: {
    label: 'Taking part (required)',
    text: 'I am this child’s parent or guardian. I allow Elden Academic Press to use my child’s first and last name, class, school, city and state, and the work we upload, only to run EAP competitions: registration, judging, results, certificates and prizes.',
    required: true,
  },
  publication: {
    label: 'Showing the entry (optional)',
    text: 'EAP may show my child’s entries on eldenap.in, in EAP books and on EAP’s social media, credited with first name and city only.',
    required: false,
  },
  marketing: {
    label: 'Book news for parents (optional)',
    text: 'Email me (not my child) about EAP books and offers suited to my child’s class.',
    required: false,
  },
};

export const DEFAULT_DECLARATION =
  'I confirm this entry is the student’s own original work. It is not copied, traced or made with AI tools, and it follows the competition rules.';
