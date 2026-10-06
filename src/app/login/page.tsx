import type { Metadata } from 'next';
import { getT } from '@/i18n/server';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'เข้าสู่ระบบ' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const t = await getT();
  const { next } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center bg-[radial-gradient(circle_at_20%_10%,#fbe7c2,transparent_45%),radial-gradient(circle_at_90%_90%,#f6dcc0,transparent_40%)] p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="text-5xl" aria-hidden>🍮</div>
          <h1 className="text-2xl font-semibold">{t.app.name}</h1>
          <p className="text-sm text-muted-foreground">{t.app.tagline}</p>
        </CardHeader>
        <CardContent>
          <LoginForm next={next} />
        </CardContent>
      </Card>
    </main>
  );
}
