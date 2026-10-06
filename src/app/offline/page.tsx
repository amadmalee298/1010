import { getT } from '@/i18n/server';

export const dynamic = 'force-static';

export default async function OfflinePage() {
  const t = await getT();
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="grid gap-3">
        <div className="text-5xl" aria-hidden>📴</div>
        <h1 className="text-xl font-semibold">{t.app.name}</h1>
        <p className="text-muted-foreground">{t.errors.offline}</p>
      </div>
    </main>
  );
}
