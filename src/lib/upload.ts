// Uploading students' work from a phone on slow mobile data.
// - Photos are redrawn on the phone before upload: this drops hidden data such as the
//   GPS location, turns a 5 MB photo into about 1 MB, and makes a small preview.
//   (The server checks and cleans every file again.)
// - The upload goes straight to private storage with a progress bar, and is retried
//   automatically if the connection drops.

export interface Prepared { main: Blob; type: string; name: string; thumb: Blob | null }

const MAX_SIDE = 2400;
const THUMB_SIDE = 480;

function draw(bmp: ImageBitmap, max: number, type: string, quality: number): Promise<Blob | null> {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  if (type === 'image/jpeg') { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h); } // transparent drawings on white
  ctx.drawImage(bmp, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function preparePhoto(file: File): Promise<Prepared> {
  const plain = { main: file as Blob, type: file.type, name: file.name, thumb: null };
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap === 'undefined') return plain;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return plain; }
  try {
    // Small PNG drawings stay crisp as PNG; everything else becomes a well-compressed JPEG.
    const keepPng = file.type === 'image/png' && file.size <= 3 * 1024 * 1024 && Math.max(bmp.width, bmp.height) <= MAX_SIDE;
    const main = keepPng ? await draw(bmp, MAX_SIDE, 'image/png', 1) : await draw(bmp, MAX_SIDE, 'image/jpeg', 0.88);
    const thumb = await draw(bmp, THUMB_SIDE, 'image/jpeg', 0.72);
    if (!main) return plain;
    const type = keepPng ? 'image/png' : 'image/jpeg';
    return { main, type, name: file.name.replace(/\.[^.]+$/, '') + (keepPng ? '.png' : '.jpg'), thumb };
  } finally {
    bmp.close();
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function putOnce(url: string, blob: Blob, type: string, onProgress: (f: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Type', type);
    x.setRequestHeader('x-upsert', 'true');
    x.timeout = 10 * 60_000;
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(Object.assign(new Error(`Upload failed (${x.status})`), { status: x.status })));
    x.onerror = () => reject(Object.assign(new Error('The connection dropped'), { status: 0 }));
    x.ontimeout = () => reject(Object.assign(new Error('The upload took too long'), { status: 0 }));
    signal?.addEventListener('abort', () => x.abort());
    x.onabort = () => reject(Object.assign(new Error('Cancelled'), { status: -1 }));
    x.send(blob);
  });
}

/** Upload with up to 4 tries (waiting longer each time) when the network drops. */
export async function putWithRetry(url: string, blob: Blob, type: string, onProgress: (f: number) => void, signal?: AbortSignal) {
  let last: unknown;
  for (let i = 0; i < 4; i++) {
    try { await putOnce(url, blob, type, onProgress, signal); return; } catch (e) {
      last = e;
      const status = (e as { status?: number }).status ?? 0;
      if (status === -1 || (status >= 400 && status < 500)) break;
      await wait(1500 * 2 ** i);
    }
  }
  throw last;
}

export const sizeText = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
