import { useEffect } from 'react';
import { motion } from 'motion/react';
import { submitForm, formData } from '../api';
import { PAL } from '../data';
import { useCatalog } from '../store/catalog';
import { useSubmit } from '../store/useSubmit';
import type { ModalKind } from '../site';
import { Field, SelectField } from './Field';

const CFG: Record<ModalKind, [title: string, desc: string, cta: string]> = {
  sample: ['Request a sample copy', 'For teachers, schools and coaching institutes evaluating Elden titles.', 'Request sample'],
  bulk: ['School & bulk order enquiry', 'Tell us about your requirement and we’ll share pricing and delivery options.', 'Send enquiry'],
  teacher: ['Request teacher access', 'Teacher’s manuals, answer keys and lesson plans for adopting schools.', 'Request access'],
  dist: ['Become a distributor', 'Partner with Elden to supply schools and bookstores in your region.', 'Send application'],
};

export function EnquiryModal({ kind, bookId, onClose }: { kind: ModalKind; bookId?: string; onClose: () => void }) {
  const { byId, products } = useCatalog();
  const book = byId(bookId);
  const titles = products.filter((p) => p.category?.slug !== 'journals').map((p) => p.title + (p.classLabel ? ' — ' + p.classLabel : ''));
  const { busy, error, sent, submit } = useSubmit((form) => submitForm(kind, { ...(book ? { title: book.title } : {}), ...formData(form) }));
  const [title, desc, cta] = CFG[kind];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <motion.div className="modal-backdrop" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 40, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.98 }} transition={{ type: 'spring', stiffness: 320, damping: 30 }}>
        <div className="modal__head">
          <div className="modal__head-text">
            <div id="modal-title" className="modal__title">{title}</div>
            <div className="modal__desc">{desc}</div>
          </div>
          <button type="button" className="modal__close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {sent ? (
          <div className="modal__done">
            <div className="h-card">Request received.</div>
            <div className="body-sm">Our team will contact you shortly to confirm details.</div>
            <button type="button" className="btn btn--ink btn--md btn--mt" onClick={onClose}>Done</button>
          </div>
        ) : (
          <form className="modal__form" onSubmit={submit}>
            {book && (
              <div className="modal__book">
                <span className="modal__book-thumb" style={{ background: PAL[book.palette]?.bg ?? PAL[0].bg }} />
                <span className="modal__book-text">
                  <span className="modal__book-title">{book.title}</span>
                  <span className="modal__book-meta">{[book.category?.name, book.classLabel, book.boards.join(', ')].filter(Boolean).join(' · ')}</span>
                </span>
              </div>
            )}
            {!book && kind === 'sample' && (
              <SelectField label="Title(s) you'd like to evaluate" name="title">
                {titles.map((t) => <option key={t}>{t}</option>)}
              </SelectField>
            )}
            <div className="form-grid form-grid--tight">
              <Field label="Name" name="name" required />
              <SelectField label="Role" name="role">
                <option>Teacher</option><option>Principal / school admin</option><option>Coaching institute</option><option>Bookseller</option><option>Student / parent</option>
              </SelectField>
              <Field label="School / institution" name="institution" required />
              <Field label="City" name="city" required />
              <Field label="Phone" name="phone" type="tel" required placeholder="+91" />
              <Field label="Email" name="email" type="email" />
            </div>
            {(kind === 'bulk' || kind === 'dist') && (
              <Field label="Approx. copies needed" name="copies" type="number" min={1} placeholder="e.g. 120" />
            )}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hp" aria-hidden="true" />
            {error && <div className="form-error" role="alert">{error}</div>}
            <button type="submit" className="btn btn--accent btn--lg btn--mt-sm" disabled={busy}>{busy ? 'Sending…' : cta}</button>
          </form>
        )}
      </motion.div>
    </motion.div>
  );
}
