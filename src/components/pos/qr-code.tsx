'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Renders a QR code as inline SVG (generated locally — works offline). */
export function QrCode({ value, size = 240, label }: { value: string; size?: number; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })
      .then((s) => { if (alive) setSvg(s); })
      .catch(() => { if (alive) setSvg(null); });
    return () => { alive = false; };
  }, [value]);
  if (!svg) return <div style={{ width: size, height: size }} className="animate-pulse rounded-xl bg-muted" />;
  return <div role="img" aria-label={label} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
