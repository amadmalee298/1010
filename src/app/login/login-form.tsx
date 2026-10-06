'use client';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useI18n } from '@/i18n/client';
import { signIn, type LoginState } from './actions';

export function LoginForm({ next }: { next?: string | undefined }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, { error: null });
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next ?? ''} />
      <Field label={t.auth.email}>
        <Input name="email" type="email" autoComplete="username" required inputMode="email" />
      </Field>
      <Field label={t.auth.password}>
        <Input name="password" type="password" autoComplete="current-password" required minLength={6} />
      </Field>
      {state.error ? <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" size="lg" disabled={pending}>{pending ? t.common.loading : t.auth.submit}</Button>
    </form>
  );
}
