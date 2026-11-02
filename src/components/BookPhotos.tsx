import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';

export interface Photo { url: string; alt: string }

/** A book's extra photos (besides the cover): a row of thumbnails that open a full-screen viewer. */
export function BookPhotos({ photos, title }: { photos: Photo[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  if (!photos.length) return null;
  return (
    <div className="pd__photos">
      <div className="pd__photos-label">More photos <span>{photos.length}</span></div>
      <ul className="pd__photos-row">
        {photos.map((p, i) => (
          <li key={p.url}>
            <button type="button" className="pd__thumb" aria-label={`Open photo ${i + 1} of ${photos.length}${p.alt ? `: ${p.alt}` : ''}`}
              onClick={(e) => { opener.current = e.currentTarget; setOpen(i); }}>
              <img src={p.url} alt="" loading="lazy" decoding="async" />
            </button>
          </li>
        ))}
      </ul>
      {/* Rendered at the top of the site, so it sits above the header and the sticky cover column. */}
      {createPortal(
        <AnimatePresence>
          {open !== null && (
            <PhotoViewer photos={photos} title={title} start={open}
              onClose={() => { setOpen(null); opener.current?.focus(); }} />
          )}
        </AnimatePresence>,
        document.querySelector('.site') ?? document.body,
      )}
    </div>
  );
}

function PhotoViewer({ photos, title, start, onClose }: { photos: Photo[]; title: string; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const n = photos.length;
  const go = useCallback((by: number) => setI((x) => (x + by + n) % n), [n]);
  const close = useRef<HTMLButtonElement>(null);
  const swipe = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    close.current?.focus();
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [go, onClose]);

  // Load the next and previous photos ahead, so arrows feel instant.
  useEffect(() => {
    for (const k of [i + 1, i - 1]) { const img = new Image(); img.src = photos[(k + n) % n].url; }
  }, [i, n, photos]);

  const p = photos[i];
  return (
    <motion.div className="viewer" role="dialog" aria-modal="true" aria-label={`${title}: photo ${i + 1} of ${n}`} onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <div className="viewer__bar" onClick={(e) => e.stopPropagation()}>
        <span className="viewer__count" aria-live="polite">{i + 1} / {n}</span>
        <button ref={close} type="button" className="viewer__close" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <figure className="viewer__stage" onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => { swipe.current = e.clientX; }}
        onPointerUp={(e) => {
          if (swipe.current === null) return;
          const dx = e.clientX - swipe.current;
          swipe.current = null;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.img key={p.url} src={p.url} alt={p.alt || `${title}, photo ${i + 1}`} draggable={false}
            initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
        </AnimatePresence>
        {p.alt && <figcaption>{p.alt}</figcaption>}
      </figure>
      {n > 1 && <>
        <button type="button" className="viewer__nav viewer__nav--prev" aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); go(-1); }}>‹</button>
        <button type="button" className="viewer__nav viewer__nav--next" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); go(1); }}>›</button>
      </>}
    </motion.div>
  );
}
