'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { DEMO_USER, EMPTY_USER, demoLiveClasses } from './seed';
import { getSupabase } from './supabase/client';
import type { Catalog, Course, Note, Profile, UserState } from './types';

const LS_KEY = 'elmaster:v1';
const DEMO_COUPONS: Record<string, number> = { ELDEN20: 20 };

type Mode = 'demo' | 'live';

interface Store {
  mode: Mode;
  ready: boolean;
  user: User | null;
  catalog: Catalog;
  course: (id: string) => Course | undefined;
  s: UserState;
  toast: string | null;
  showToast: (msg: string) => void;
  coupon: { code: string; percent: number } | null;
  // actions
  toggleWish: (id: string) => void;
  addCart: (id: string) => 'added' | 'in-cart' | 'owned';
  removeCart: (id: string) => void;
  applyCoupon: (code: string) => Promise<boolean>;
  placeOrder: (payMethod: string) => Promise<boolean>;
  toggleReg: (examId: string) => void;
  toggleRemind: (classId: string) => void;
  setRemindOn: (on: boolean) => void;
  markAllRead: () => void;
  saveNote: (n: Omit<Note, 'id'>) => void;
  setLesson: (courseId: string, index: number, total: number) => void;
  recordAttempt: (a: { score: number; total: number; timeTaken: number; xp: number; answers: Record<number, number> }) => void;
  updateProfile: (p: Partial<Profile>) => void;
  finishOnboarding: () => void;
  sendOtp: (phone: string) => Promise<string | null>;
  verifyOtp: (phone: string, token: string) => Promise<string | null>;
  logout: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside AppProvider');
  return v;
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export function AppProvider({ catalog: served, children }: { catalog: Catalog; children: ReactNode }) {
  const supabase = getSupabase();
  const mode: Mode = supabase ? 'live' : 'demo';
  // Demo pages are prerendered, so re-anchor the demo class schedule to the visitor's clock.
  const catalog = useMemo(() => (mode === 'demo' ? { ...served, liveClasses: demoLiveClasses() } : served), [served, mode]);
  const [s, setS] = useState<UserState>(mode === 'demo' ? DEMO_USER : EMPTY_USER);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [coupon, setCoupon] = useState<{ code: string; percent: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sRef = useRef(s);
  sRef.current = s;

  const byId = useMemo(() => new Map(catalog.courses.map((c) => [c.id, c])), [catalog.courses]);
  const course = useCallback((id: string) => byId.get(id), [byId]);

  const showToast = useCallback((msg: string) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  /** Run a Supabase write for the signed-in student; surface failures. */
  const remote = useCallback(
    (fn: (uid: string) => PromiseLike<{ error: { message: string } | null }>) => {
      if (!supabase || !user) return;
      fn(user.id).then(({ error }) => {
        if (error) {
          console.error('[sync]', error.message);
          showToast('Couldn’t sync — check your connection');
        }
      });
    },
    [supabase, user, showToast],
  );

  // Local state: restore on mount, persist on change (demo mode and signed-out browsing).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setS((prev) => ({ ...prev, ...JSON.parse(raw) }));
    } catch {}
    if (!supabase) setReady(true);
  }, [supabase]);

  useEffect(() => {
    if (!ready || user) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(s));
    } catch {}
  }, [s, ready, user]);

  // Live mode: follow the auth session and load the student's rows.
  const loadRemote = useCallback(
    async (u: User) => {
      if (!supabase) return;
      const local = sRef.current;
      // Carry anything picked while signed out into the account.
      if (local.cart.length) await supabase.from('cart_items').upsert(local.cart.map((course_id) => ({ user_id: u.id, course_id })), { ignoreDuplicates: true });
      if (local.wish.length) await supabase.from('wishlist').upsert(local.wish.map((course_id) => ({ user_id: u.id, course_id })), { ignoreDuplicates: true });

      const [profile, cart, wish, enr, reg, rem, notes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', u.id).maybeSingle(),
        supabase.from('cart_items').select('course_id').order('added_at'),
        supabase.from('wishlist').select('course_id').order('added_at'),
        supabase.from('enrollments').select('course_id, progress, current_lesson').order('enrolled_at'),
        supabase.from('registrations').select('exam_id'),
        supabase.from('class_reminders').select('class_id'),
        supabase.from('notes').select('*').order('created_at', { ascending: false }),
      ]);
      const p = profile.data;
      const owned = (enr.data ?? []).map((r) => r.course_id as string);
      setS((prev) => ({
        ...prev,
        onboarded: true,
        profile: p ? { name: p.name, grade: p.grade, goals: p.goals, phone: p.phone ?? undefined } : prev.profile,
        remindOn: p?.remind_on ?? true,
        readAll: Boolean(p?.notifs_read_at),
        cart: (cart.data ?? []).map((r) => r.course_id).filter((id: string) => !owned.includes(id)),
        wish: (wish.data ?? []).map((r) => r.course_id),
        owned,
        progress: Object.fromEntries((enr.data ?? []).map((r) => [r.course_id, r.progress])),
        currentLesson: Object.fromEntries((enr.data ?? []).map((r) => [r.course_id, r.current_lesson])),
        reg: (reg.data ?? []).map((r) => r.exam_id),
        remind: (rem.data ?? []).map((r) => r.class_id),
        notes: (notes.data ?? []).map((r) => ({ id: r.id, courseId: r.course_id, lessonId: r.lesson_id, at: r.at, text: r.body })),
      }));
    },
    [supabase],
  );

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!alive) return;
      setUser(data.user);
      if (data.user) await loadRemote(data.user);
      if (alive) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === 'SIGNED_IN' && session?.user) loadRemote(session.user);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, loadRemote]);

  // ───── actions ─────

  const toggleWish = useCallback(
    (id: string) => {
      const had = sRef.current.wish.includes(id);
      setS((p) => ({ ...p, wish: toggle(p.wish, id) }));
      remote((uid) => (had ? supabase!.from('wishlist').delete().match({ user_id: uid, course_id: id }) : supabase!.from('wishlist').insert({ user_id: uid, course_id: id })));
      showToast(had ? 'Removed from wishlist' : 'Saved to wishlist');
    },
    [remote, supabase, showToast],
  );

  const addCart = useCallback(
    (id: string) => {
      const cur = sRef.current;
      if (cur.owned.includes(id)) return 'owned' as const;
      if (cur.cart.includes(id)) return 'in-cart' as const;
      setS((p) => ({ ...p, cart: [...p.cart, id] }));
      remote((uid) => supabase!.from('cart_items').insert({ user_id: uid, course_id: id }));
      return 'added' as const;
    },
    [remote, supabase],
  );

  const removeCart = useCallback(
    (id: string) => {
      setS((p) => ({ ...p, cart: p.cart.filter((x) => x !== id) }));
      remote((uid) => supabase!.from('cart_items').delete().match({ user_id: uid, course_id: id }));
    },
    [remote, supabase],
  );

  const applyCoupon = useCallback(
    async (code: string) => {
      const c = code.trim().toUpperCase();
      let percent = 0;
      if (supabase) {
        const { data, error } = await supabase.rpc('check_coupon', { p_code: c });
        if (error) console.error('[coupon]', error.message);
        percent = Number(data) || 0;
      } else percent = DEMO_COUPONS[c] ?? 0;
      if (!percent) {
        showToast('That code isn’t valid');
        return false;
      }
      setCoupon({ code: c, percent });
      showToast(`${c} applied — ${percent}% off`);
      return true;
    },
    [supabase, showToast],
  );

  const placeOrder = useCallback(
    async (payMethod: string) => {
      const cart = sRef.current.cart;
      if (!cart.length) return false;
      if (supabase) {
        if (!user) return false;
        const { error } = await supabase.rpc('place_order', { p_course_ids: cart, p_coupon: coupon?.code ?? null, p_pay_method: payMethod });
        if (error) {
          console.error('[order]', error.message);
          showToast('Payment failed — please try again');
          return false;
        }
      } else {
        await new Promise((r) => setTimeout(r, 1500));
      }
      setS((p) => ({
        ...p,
        owned: [...p.owned, ...cart.filter((id) => !p.owned.includes(id))],
        progress: { ...Object.fromEntries(cart.map((id) => [id, 0])), ...p.progress },
        lastOrder: cart,
        cart: [],
      }));
      setCoupon(null);
      return true;
    },
    [supabase, user, coupon, showToast],
  );

  const toggleReg = useCallback(
    (examId: string) => {
      const had = sRef.current.reg.includes(examId);
      setS((p) => ({ ...p, reg: toggle(p.reg, examId) }));
      remote((uid) => (had ? supabase!.from('registrations').delete().match({ user_id: uid, exam_id: examId }) : supabase!.from('registrations').insert({ user_id: uid, exam_id: examId })));
      showToast(had ? 'Registration cancelled' : 'Registered! Admit card in your inbox');
    },
    [remote, supabase, showToast],
  );

  const toggleRemind = useCallback(
    (classId: string) => {
      const had = sRef.current.remind.includes(classId);
      setS((p) => ({ ...p, remind: toggle(p.remind, classId) }));
      remote((uid) => (had ? supabase!.from('class_reminders').delete().match({ user_id: uid, class_id: classId }) : supabase!.from('class_reminders').insert({ user_id: uid, class_id: classId })));
      showToast(had ? 'Reminder removed' : 'We’ll remind you 15 min before');
    },
    [remote, supabase, showToast],
  );

  const setRemindOn = useCallback(
    (on: boolean) => {
      setS((p) => ({ ...p, remindOn: on }));
      remote((uid) => supabase!.from('profiles').update({ remind_on: on }).eq('id', uid));
    },
    [remote, supabase],
  );

  const markAllRead = useCallback(() => {
    setS((p) => ({ ...p, readAll: true }));
    remote((uid) => supabase!.from('profiles').update({ notifs_read_at: new Date().toISOString() }).eq('id', uid));
  }, [remote, supabase]);

  const saveNote = useCallback(
    (n: Omit<Note, 'id'>) => {
      const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
      setS((p) => ({ ...p, notes: [{ ...n, id }, ...p.notes] }));
      remote((uid) => supabase!.from('notes').insert({ id, user_id: uid, course_id: n.courseId, lesson_id: n.lessonId, at: n.at, body: n.text }));
      showToast('Note saved');
    },
    [remote, supabase, showToast],
  );

  const setLesson = useCallback(
    (courseId: string, index: number, total: number) => {
      const progress = Math.max(sRef.current.progress[courseId] ?? 0, Math.round((index / total) * 100));
      setS((p) => ({ ...p, currentLesson: { ...p.currentLesson, [courseId]: index }, progress: { ...p.progress, [courseId]: progress } }));
      remote((uid) => supabase!.from('enrollments').update({ current_lesson: index, progress }).match({ user_id: uid, course_id: courseId }));
    },
    [remote, supabase],
  );

  const recordAttempt = useCallback<Store['recordAttempt']>(
    (a) => remote((uid) => supabase!.from('quiz_attempts').insert({ user_id: uid, mock_id: 'nt-sprint', score: a.score, total: a.total, time_taken: a.timeTaken, xp: a.xp, answers: a.answers })),
    [remote, supabase],
  );

  const updateProfile = useCallback(
    (patch: Partial<Profile>) => {
      setS((p) => ({ ...p, profile: { ...p.profile, ...patch } }));
      remote((uid) => supabase!.from('profiles').update(patch).eq('id', uid));
    },
    [remote, supabase],
  );

  const finishOnboarding = useCallback(() => setS((p) => ({ ...p, onboarded: true })), []);

  const sendOtp = useCallback(
    async (phone: string) => {
      if (!supabase) return null;
      const { error } = await supabase.auth.signInWithOtp({
        phone,
        options: { data: { name: sRef.current.profile.name, grade: sRef.current.profile.grade, goals: sRef.current.profile.goals } },
      });
      return error?.message ?? null;
    },
    [supabase],
  );

  const verifyOtp = useCallback(
    async (phone: string, token: string) => {
      if (!supabase) return null;
      const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
      if (error) return error.message;
      // Returning students keep their saved profile; new ones get what they just entered.
      const u = data.user;
      if (u) {
        const { name, grade, goals } = sRef.current.profile;
        const { data: existing } = await supabase.from('profiles').select('name').eq('id', u.id).maybeSingle();
        if (!existing?.name && name) await supabase.from('profiles').upsert({ id: u.id, name, grade, goals, phone });
      }
      return null;
    },
    [supabase],
  );

  const logout = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    try {
      localStorage.removeItem(LS_KEY);
    } catch {}
    setUser(null);
    setCoupon(null);
    setS(mode === 'demo' ? DEMO_USER : EMPTY_USER);
  }, [supabase, mode]);

  const value: Store = {
    mode, ready, user, catalog, course, s, toast, showToast, coupon,
    toggleWish, addCart, removeCart, applyCoupon, placeOrder, toggleReg, toggleRemind, setRemindOn,
    markAllRead, saveNote, setLesson, recordAttempt, updateProfile, finishOnboarding, sendOtp, verifyOtp, logout,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
