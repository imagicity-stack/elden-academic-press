// Fetching a file someone points us at (a cover photo or an e-book PDF given to the Claude
// connector as a link), safely: https only, never an address inside a private network (the
// server would otherwise fetch from places only it can reach), a few redirects at most (each
// checked the same way), a time limit and a size limit. Google Drive and Dropbox share links
// are turned into their direct-download form.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface RemoteFile { bytes: Uint8Array; name: string; contentType: string }
export type FetchFile = (url: string, maxBytes: number) => Promise<RemoteFile>;

export class RemoteFileError extends Error {}

/** Share links → direct downloads (Drive "view" pages and Dropbox previews are web pages, not the file). */
export function directLink(raw: string): string {
  const u = new URL(raw);
  const drive = /^\/file\/d\/([\w-]{10,})/.exec(u.pathname);
  if (u.hostname === 'drive.google.com' && drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  if (u.hostname === 'drive.google.com' && u.pathname === '/open' && u.searchParams.get('id')) {
    return `https://drive.google.com/uc?export=download&id=${u.searchParams.get('id')}`;
  }
  if (/(^|\.)dropbox\.com$/.test(u.hostname)) { u.searchParams.delete('dl'); u.searchParams.set('dl', '1'); return u.toString(); }
  return u.toString();
}

/** Loopback, private, link-local, carrier-grade NAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateAddress(mapped[1]);
  return /^(fc|fd|fe[89ab]|ff)/.test(v6);
}

async function checkHost(u: URL, resolve: typeof lookup) {
  if (u.protocol !== 'https:') throw new RemoteFileError('Only https:// links can be used.');
  if (u.username || u.password) throw new RemoteFileError('Links with a user name or password can’t be used.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await resolve(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new RemoteFileError(`Couldn’t find ${u.hostname}.`);
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new RemoteFileError('That link points inside a private network and can’t be used.');
}

/** "cover.jpg" from the Content-Disposition header, else the link's last part. */
function nameOf(res: Response, u: URL): string {
  const cd = res.headers.get('content-disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
  const plain = /filename="?([^";]+)"?/i.exec(cd)?.[1];
  let name = '';
  try { name = star ? decodeURIComponent(star) : plain ?? decodeURIComponent(u.pathname.split('/').pop() ?? ''); } catch { name = ''; }
  return name.trim().slice(0, 200) || 'file';
}

export function remoteFiles(opts: { fetch?: typeof fetch; lookup?: typeof lookup; timeoutMs?: number } = {}): FetchFile {
  const fetchImpl = opts.fetch ?? fetch;
  const resolve = opts.lookup ?? lookup;
  return async (raw, maxBytes) => {
    let u: URL;
    try { u = new URL(directLink(raw)); } catch { throw new RemoteFileError('That isn’t a valid link.'); }
    const signal = AbortSignal.timeout(opts.timeoutMs ?? 25_000);
    for (let hop = 0; hop < 4; hop++) {
      await checkHost(u, resolve);
      const res = await fetchImpl(u, { redirect: 'manual', signal, headers: { Accept: 'image/*,application/pdf,application/epub+zip,*/*;q=0.1' } })
        .catch((e) => { throw new RemoteFileError(`Couldn’t download it: ${(e as Error).message}`); });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        u = new URL(res.headers.get('location')!, u);
        continue;
      }
      if (!res.ok) throw new RemoteFileError(`The link answered ${res.status}: is it shared publicly (anyone with the link)?`);
      const declared = Number(res.headers.get('content-length'));
      if (declared > maxBytes) throw new RemoteFileError(`The file is too big (${Math.ceil(declared / 1048576)} MB; the limit here is ${Math.round(maxBytes / 1048576)} MB).`);
      // Read it, stopping as soon as it's over the limit.
      const reader = res.body?.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel().catch(() => {}); throw new RemoteFileError(`The file is too big (the limit here is ${Math.round(maxBytes / 1048576)} MB).`); }
        parts.push(value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const p of parts) { bytes.set(p, at); at += p.byteLength; }
      return { bytes, name: nameOf(res, u), contentType: (res.headers.get('content-type') ?? '').split(';')[0].trim() };
    }
    throw new RemoteFileError('The link redirects too many times.');
  };
}
