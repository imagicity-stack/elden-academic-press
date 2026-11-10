// Meta events that the website (Pixel) and the server (Conversions API) both send: the same
// event id and parameters on both sides, so Meta counts each once ("Deduplicated").

/** A competition registration (team, individual or group), the moment it's saved. */
export const registrationEventId = (registrationId: string) => `reg_${registrationId}`;
export const registrationParams = (slug: string) => ({ content_name: slug, content_category: 'competition', currency: 'INR', value: 0 });

/** A new account (first Google sign-in). A custom event, so it never counts as a registration. */
export const SIGNUP_EVENT = 'AccountSignup';
export const signupEventId = (userId: string) => `signup-${userId}`;
export const signupParams = () => ({ content_name: 'Google sign-in', status: 'complete' });

/**
 * Runs `fire` at most once per key in this browser, so a refresh or a double submit doesn't
 * send the event again. Never throws: blocked storage or a failing Pixel (ad blockers, in-app
 * browsers) can't stop the page that called it. Returns whether it ran.
 */
export function fireOnce(storage: Pick<Storage, 'getItem' | 'setItem'> | null, key: string, fire: () => void): boolean {
  try {
    if (storage?.getItem(key)) return false;
    storage?.setItem(key, '1');
  } catch { /* storage blocked: Meta still drops a repeat, since the event id is the same */ }
  try { fire(); } catch { /* the Pixel failed: nothing to do */ }
  return true;
}
