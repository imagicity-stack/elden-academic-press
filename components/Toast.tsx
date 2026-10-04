'use client';

import { useStore } from '@/lib/store';
import { Icon, font } from './ui';

export function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return (
    <div className="fixed-col" style={{ top: 'calc(var(--top) - 2px)', height: 0, zIndex: 80, display: 'flex', justifyContent: 'center' }}>
      <div role="status" style={{ height: 'fit-content', background: '#0A1F4D', color: '#F4F5FA', padding: '12px 18px', borderRadius: 16, font: font(700, 13), whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 14px 30px -10px rgba(10,31,77,.6)', animation: 'toastIn .35s var(--ease)' }}>
        <Icon name="check_circle" size={18} color="#3DD6CF" />
        {toast}
      </div>
    </div>
  );
}
