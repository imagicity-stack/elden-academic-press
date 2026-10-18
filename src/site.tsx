import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { EnquiryModal } from './components/EnquiryModal';

export type ModalKind = 'sample' | 'bulk' | 'teacher' | 'dist';

interface Site {
  openModal: (kind: ModalKind, bookId?: string) => void;
  downloaded: Set<string>;
  markDownloaded: (id: string) => void;
}

const SiteContext = createContext<Site | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<{ kind: ModalKind; bookId?: string } | null>(null);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());

  const openModal = useCallback((kind: ModalKind, bookId?: string) => setModal({ kind, bookId }), []);
  const closeModal = useCallback(() => setModal(null), []);
  const markDownloaded = useCallback((id: string) => setDownloaded((s) => new Set(s).add(id)), []);
  const value = useMemo(() => ({ openModal, downloaded, markDownloaded }), [openModal, downloaded, markDownloaded]);

  return (
    <SiteContext.Provider value={value}>
      {children}
      {modal && <EnquiryModal kind={modal.kind} bookId={modal.bookId} onClose={closeModal} />}
    </SiteContext.Provider>
  );
}

export function useSite() {
  const s = useContext(SiteContext);
  if (!s) throw new Error('useSite must be used inside <SiteProvider>');
  return s;
}
