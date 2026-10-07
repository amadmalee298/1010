'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Eraser, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { saveSignatureAction } from '@/server/actions/accounting';

const WIDTH = 600;
const HEIGHT = 220;

/** Finger/stylus signature pad; saves a transparent PNG cropped to the ink. */
export function SignaturePad({ current }: { current: string | null }) {
  const { t } = useI18n();
  const S = t.signature;
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);
  const save = useAction(saveSignatureAction);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1e3a8a';
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * WIDTH, y: ((e.clientY - r.top) / r.height) * HEIGHT };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
    setDirty(true);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvas.current?.getContext('2d');
    if (!drawing.current || !ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const end = () => { drawing.current = false; };
  const clear = () => {
    canvas.current?.getContext('2d')?.clearRect(0, 0, WIDTH, HEIGHT);
    setDirty(false);
  };

  /** Crops to the drawn area (plus a margin) so the image sits neatly on documents. */
  const cropped = (): string | null => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return null;
    const { data } = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    let minX = WIDTH, minY = HEIGHT, maxX = -1, maxY = -1;
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      if ((data[(y * WIDTH + x) * 4 + 3] ?? 0) > 0) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
    if (maxX < 0) return null;
    const pad = 8;
    const sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
    const w = Math.min(WIDTH, maxX + pad) - sx, h = Math.min(HEIGHT, maxY + pad) - sy;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d')?.drawImage(c, sx, sy, w, h, 0, 0, w, h);
    return out.toDataURL('image/png');
  };

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border-2 border-dashed border-border bg-white">
        <canvas ref={canvas} width={WIDTH} height={HEIGHT} className="h-auto w-full touch-none" style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} onPointerCancel={end} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={clear}><Eraser /> {S.clear}</Button>
        <Button type="button" disabled={!dirty || save.pending} onClick={async () => {
          const image = cropped();
          if (!image) { toast.error(S.empty); return; }
          if (await save.run({ image })) clear();
        }}><Save /> {S.save}</Button>
      </div>
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">{S.current}</p>
        {current ? (
          <div className="flex flex-wrap items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
            <img src={current} alt={S.current} className="h-20 rounded-lg border border-border bg-white p-2" />
            <Button type="button" variant="ghost" disabled={save.pending} onClick={() => void save.run({ image: null })}><Trash2 /> {S.remove}</Button>
          </div>
        ) : <p className="text-sm">{S.none}</p>}
      </div>
    </div>
  );
}
