// The steps of a competition's registration that the website counts (Admin → Competitions →
// Analytics). Each browser counts once per step and competition, anonymously: no name, email or
// id is sent, only the step and the channel of the visit (Meta ads, Google…).
export type FunnelStep = 'view' | 'signin' | 'start' | 'members' | 'review';

export const FUNNEL_STEPS: { key: FunnelStep; label: string; hint: string; team?: boolean }[] = [
  { key: 'view', label: 'Visited the page', hint: 'Opened the competition page' },
  { key: 'signin', label: 'Signed in', hint: 'Signed in with Google on the page (or came back signed in)' },
  { key: 'start', label: 'Started the form', hint: 'Began filling in the registration form' },
  { key: 'members', label: 'Added the team', hint: 'Reached the Members step of the team form', team: true },
  { key: 'review', label: 'Reached review', hint: 'Reached the last step, Review & send', team: true },
];
export const isFunnelStep = (s: string): s is FunnelStep => FUNNEL_STEPS.some((x) => x.key === s);
