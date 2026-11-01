// Enquiry forms (sample copies, bulk orders, teacher access, distributors,
// contact, author proposals) are stored in the admin and emailed to the store.
import { formEvent, newEventId, track } from './meta';
import { api } from './store/api';

export type FormName = 'sample' | 'bulk' | 'teacher' | 'dist' | 'contact' | 'proposal';

const KNOWN = ['name', 'email', 'phone', 'institution', 'city', 'role', 'title', 'message', 'website'];

export async function submitForm(form: FormName, data: Record<string, string>): Promise<void> {
  const fields: Record<string, string> = {};
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (KNOWN.includes(k)) fields[k] = v;
    else if (v) extra[k] = v;
  }
  if (data.synopsis && !fields.message) { fields.message = data.synopsis; delete extra.synopsis; }
  const eventId = newEventId();
  await api('/enquiries', { body: { kind: form, ...fields, data: Object.keys(extra).length ? extra : undefined }, headers: { 'X-Meta-Event-Id': eventId } });
  track(formEvent(form), { content_name: form, content_category: 'enquiry' }, { eventId });
}

export const formData = (el: HTMLFormElement) =>
  Object.fromEntries([...new FormData(el)].map(([k, v]) => [k, String(v)]));
