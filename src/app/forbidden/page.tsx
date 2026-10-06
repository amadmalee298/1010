import Link from 'next/link';
import { getT } from '@/i18n/server';
import { Button } from '@/components/ui/button';

export default async function ForbiddenPage() {
  const t = await getT();
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="grid gap-4">
        <div className="text-5xl" aria-hidden>🔒</div>
        <p className="text-lg font-medium">{t.auth.forbidden}</p>
        <Button asChild variant="outline"><Link href="/">{t.common.back}</Link></Button>
      </div>
    </main>
  );
}
