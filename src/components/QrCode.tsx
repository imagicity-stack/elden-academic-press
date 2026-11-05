import { useMemo } from 'react';
import { qrSvgPath } from '../lib/qr';

/** A scannable QR code (drawn on this page, nothing sent anywhere). */
export function QrCode({ text, label, size = 220 }: { text: string; label: string; size?: number }) {
  const { path, size: n } = useMemo(() => qrSvgPath(text), [text]);
  return (
    <svg className="qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#FFFFFF" />
      <path d={path} fill="#0B1220" />
    </svg>
  );
}
