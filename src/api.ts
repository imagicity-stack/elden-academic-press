// Form submissions. The site has no backend yet: wire this to your email
// service, CRM or API. Each form passes its name and the fields as entered.

export type FormName = 'sample' | 'bulk' | 'teacher' | 'dist' | 'contact' | 'proposal';

export async function submitForm(form: FormName, data: Record<string, string>): Promise<void> {
  if (import.meta.env.DEV) console.info('[form]', form, data);
}

export const formData = (el: HTMLFormElement) =>
  Object.fromEntries([...new FormData(el)].map(([k, v]) => [k, String(v)]));
