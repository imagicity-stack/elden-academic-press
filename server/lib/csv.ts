// Minimal RFC 4180 CSV for spreadsheet export/import.

const cell = (v: unknown) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join('; ') : String(v);
  // Prefix formula-looking values so spreadsheets don't execute them.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv<T>(rows: T[], columns: [header: string, get: (r: T) => unknown][]): string {
  return '﻿' + [columns.map(([h]) => cell(h)).join(','), ...rows.map((r) => columns.map(([, g]) => cell(g(r))).join(','))].join('\r\n') + '\r\n';
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}
