// The signed-in customer's competitions profile: parent or student, children,
// approvals. Shopping never needs it.
import { useCallback, useEffect, useState } from 'react';
import { setStudentSession } from '../consent';
import { ApiError } from './api';
import { accountToken, authApi, onAuthChange, signOut } from './account';
import type { ConsentKind } from '../shared/consents';

export type AccountType = 'parent' | 'student' | null;
export type ApprovalStatus = 'pending' | 'approved' | 'declined' | 'expired';

export interface ProfileStudent {
  id: string; firstName: string; lastName: string; classGrade: number; schoolName: string; city: string; state: string;
  approvalStatus: ApprovalStatus; relation: 'parent' | 'self'; hasLogin: boolean; needsClassConfirm: boolean; editable: string[];
  consents?: Record<ConsentKind, boolean>;
  invite?: { url: string; expiresAt: string } | null;
  approval?: { status: ApprovalStatus; parentName: string; parentWhatsapp: string; parentEmail: string; expiresAt: string; link: string | null } | null;
}
export interface ProfileData {
  account: { email: string; name: string; type: AccountType; fullName: string; whatsapp: string; city: string; state: string; completed: boolean; locked: boolean };
  students: ProfileStudent[];
}

export const profileApi = <T = ProfileData>(path: string, init: { method?: string; body?: unknown } = {}) => authApi<T>('/profile' + path, init);

type State = { status: 'loading' } | { status: 'signedOut' } | { status: 'ready'; data: ProfileData } | { status: 'error'; message: string };

/** Remember a student session so no tracking loads (see consent.ts). */
export function noteAccountType(type: AccountType) { setStudentSession(type === 'student'); }

export function useProfile() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const load = useCallback(async () => {
    try {
      if (!(await accountToken())) { setState({ status: 'signedOut' }); return; }
      const data = await profileApi('');
      noteAccountType(data.account.type);
      setState({ status: 'ready', data });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { await signOut(); setState({ status: 'signedOut' }); }
      else setState({ status: 'error', message: (e as Error).message });
    }
  }, []);
  useEffect(() => { load(); return onAuthChange(load); }, [load]);
  const set = useCallback((data: ProfileData) => { noteAccountType(data.account.type); setState({ status: 'ready', data }); }, []);
  return { state, reload: load, set };
}

/** wa.me link with a message, for "Send to my parent on WhatsApp". */
export const whatsappLink = (text: string, phone?: string) =>
  `https://wa.me/${phone ? '91' + phone.replace(/\D/g, '').slice(-10) : ''}?text=${encodeURIComponent(text)}`;
