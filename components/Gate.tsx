'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useStore } from '@/lib/store';

const OPEN = ['/welcome', '/signup'];

/** Shows a splash until the student's state is loaded, and sends first-time visitors to onboarding. */
export function Gate({ children }: { children: ReactNode }) {
  const { ready, s, user } = useStore();
  const path = usePathname();
  const router = useRouter();
  const open = OPEN.includes(path);
  const needsOnboarding = ready && !s.onboarded && !user && !open;

  useEffect(() => {
    if (needsOnboarding) router.replace('/welcome');
  }, [needsOnboarding, router]);

  if (!ready || needsOnboarding) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0A1F4D', display: 'grid', placeItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/elmaster-logo-light.png" alt="ElMaster" style={{ height: 34, animation: 'fadeIn .6s' }} />
      </div>
    );
  }
  return <>{children}</>;
}
