'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useStore } from '@/lib/store';
import { BackButton, Chip, Icon, display, font, label, primaryBtn } from '@/components/ui';

const GRADES = ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12', 'College', 'Adult learner'];
const GOALS = [['Olympiads', 'emoji_events'], ['School exams', 'menu_book'], ['JEE / NEET', 'track_changes'], ['Coding', 'code'], ['Languages', 'translate']] as const;

const inputBox: React.CSSProperties = { height: 54, borderRadius: 16, border: '1.5px solid rgba(10,31,77,.1)', background: '#fff', font: font(600, 15), outline: 'none', letterSpacing: 0 };

export default function SignupPage() {
  return (
    <Suspense>
      <Signup />
    </Suspense>
  );
}

function Signup() {
  const router = useRouter();
  const next = useSearchParams().get('next') || '/';
  const { mode, s, updateProfile, finishOnboarding, sendOtp, verifyOtp, showToast } = useStore();
  const [phone, setPhone] = useState(s.profile.phone?.replace(/^\+91/, '') ?? '');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { name, grade, goals } = s.profile;
  const digits = phone.replace(/\D/g, '');
  const e164 = '+91' + digits;

  const done = () => {
    finishOnboarding();
    router.replace(next);
    showToast('Welcome to ElMaster, ' + (name.split(' ')[0] || 'friend'));
  };

  const submit = async () => {
    setErr(null);
    if (mode === 'demo') return done();
    if (!otpSent) {
      if (digits.length !== 10) return setErr('Enter your 10-digit mobile number');
      setBusy(true);
      const e = await sendOtp(e164);
      setBusy(false);
      if (e) return setErr(e);
      setOtpSent(true);
      return;
    }
    if (otp.length !== 6) return setErr('Enter the 6-digit code we sent you');
    setBusy(true);
    const e = await verifyOtp(e164, otp);
    setBusy(false);
    if (e) return setErr(e);
    done();
  };

  return (
    <main className="scr-in" style={{ padding: 'calc(var(--top) + 2px) 24px calc(32px + var(--safe-b))' }}>
      <BackButton fallback="/welcome" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/elmaster-mark.png" alt="" style={{ height: 46, marginTop: 22, display: 'block' }} />
      <h1 style={{ ...display(700, 30, 1.05), margin: '14px 0 0' }}>Join ElMaster</h1>
      <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6 }}>Tell us a little so we can shape your library.</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, ...label }}>
          FULL NAME
          <input className="field" autoComplete="name" value={name} onChange={(e) => updateProfile({ name: e.target.value })} style={{ ...inputBox, padding: '0 16px', color: '#0A1F4D' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, ...label }}>
          MOBILE
          <div style={{ ...inputBox, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
            <span style={{ padding: '0 12px 0 16px', font: font(700, 15), color: '#0A1F4D', borderRight: '1px solid var(--line)' }}>+91</span>
            <input inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" value={phone} disabled={otpSent} onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, '').slice(0, 11))} style={{ flex: 1, minWidth: 0, height: '100%', border: 'none', padding: '0 14px', font: font(600, 15), outline: 'none', background: 'transparent', color: '#0A1F4D' }} />
          </div>
        </label>
        {otpSent && (
          <label className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 6, ...label }}>
            VERIFICATION CODE
            <input className="field" inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder="6-digit code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} style={{ ...inputBox, padding: '0 16px', letterSpacing: '.3em', color: '#0A1F4D' }} />
            <span style={{ font: font(600, 12), letterSpacing: 0, color: 'var(--muted)' }}>
              Sent to +91 {phone}.{' '}
              <button onClick={() => { setOtpSent(false); setOtp(''); }} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--blue)', font: font(700, 12), cursor: 'pointer' }}>
                Change number
              </button>
            </span>
          </label>
        )}
      </div>

      <div style={{ ...label, marginTop: 22 }}>I&apos;M IN</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {GRADES.map((g) => (
          <Chip key={g} active={g === grade} onClick={() => updateProfile({ grade: g })} padding="0 14px">
            {g}
          </Chip>
        ))}
      </div>
      <div style={{ ...label, marginTop: 22 }}>MY GOALS</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {GOALS.map(([g, icon]) => (
          <Chip key={g} active={goals.includes(g)} onClick={() => updateProfile({ goals: goals.includes(g) ? goals.filter((x) => x !== g) : [...goals, g] })} padding="0 14px">
            <Icon name={icon} size={17} />
            {g}
          </Chip>
        ))}
      </div>

      {err && (
        <div role="alert" style={{ marginTop: 18, font: font(700, 13), color: '#E5484D' }}>
          {err}
        </div>
      )}
      <button onClick={submit} disabled={busy} className="press" style={{ ...primaryBtn(58), width: '100%', marginTop: 30, opacity: busy ? 0.7 : 1 }}>
        {busy && <span style={{ width: 20, height: 20, borderRadius: '50%', border: '2.5px solid rgba(244,245,250,.3)', borderTopColor: '#3DD6CF', animation: 'spin .8s linear infinite' }} />}
        {mode === 'live' ? (otpSent ? 'Verify & continue' : 'Send code') : 'Continue'}
      </button>
      <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', marginTop: 16 }}>
        Already have an account?{' '}
        <button onClick={submit} style={{ border: 'none', background: 'none', padding: 0, fontWeight: 700, fontSize: 13, color: 'var(--blue)', cursor: 'pointer' }}>
          Log in
        </button>
      </div>
    </main>
  );
}
