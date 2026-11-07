// Browsers send here whatever the site's Content Security Policy (vercel.json) blocked, so a
// script or picture that's missing from the allowed list shows up in Vercel → Logs as
// "[csp] blocked …" instead of silently breaking something. Logged only, never stored; the
// page and the blocked address are logged without their query strings (order links carry
// private tokens there). At most 30 reports a minute per server instance.

const MAX_PER_MINUTE = 30;
let tally = { minute: 0, n: 0 };

/** "https://host/path" from a URL, without ?query or #hash; non-URLs (e.g. "inline", "eval") as they are. */
export function bare(u: unknown): string {
  const s = String(u ?? '').slice(0, 500);
  try { const x = new URL(s); return `${x.protocol === 'data:' || x.protocol === 'blob:' ? x.protocol : x.origin + x.pathname}`.slice(0, 200); }
  catch { return s.replace(/[^\w:.-]/g, '').slice(0, 40); }
}

/** One log line per violation in a report (the old "csp-report" format or the Reporting API's list). */
export function cspLines(text: string): string[] {
  let body: unknown;
  try { body = JSON.parse(text); } catch { return []; }
  const reports = Array.isArray(body)
    ? body.filter((r) => r && r.type === 'csp-violation').map((r) => r.body ?? {})
    : [(body as Record<string, unknown>)?.['csp-report'] ?? {}];
  return reports.slice(0, 5).map((r: Record<string, unknown>) => {
    const directive = String(r.effectiveDirective ?? r['effective-directive'] ?? r['violated-directive'] ?? '').replace(/[^\w-]/g, '').slice(0, 40);
    return `[csp] blocked ${directive || '?'} ${bare(r.blockedURL ?? r['blocked-uri'])} on ${bare(r.documentURL ?? r['document-uri'])}`;
  });
}

export async function handleCspReport(req: Request): Promise<Response> {
  const minute = Math.floor(Date.now() / 60_000);
  if (tally.minute !== minute) tally = { minute, n: 0 };
  if (++tally.n <= MAX_PER_MINUTE) {
    const text = (await req.text()).slice(0, 16_000);
    for (const line of cspLines(text)) console.warn(line);
  }
  return new Response(null, { status: 204 });
}
