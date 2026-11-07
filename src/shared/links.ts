// Which link addresses formatted text (RichText) may use: https://, mailto:, or a path on this
// site. Not "//other-site" or "/\other-site" (browsers read both as another site), and never
// javascript: or data:.
export function safeHref(u: string): string | null {
  if (/^https?:\/\/[^\s]+$/i.test(u) || /^mailto:[^\s]+$/i.test(u)) return u;
  if (/^\/(?![/\\])[^\s]*$/.test(u)) return u;
  return null;
}
