'use client';
import { useState } from 'react';
import { Link2, Send, Unlink, Webhook } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { createTelegramLinkAction, setTelegramWebhookAction, unlinkTelegramAction } from '@/server/actions/bills';

export function TelegramLink({ employeeId, linkedAs }: { employeeId: string; linkedAs: string | null }) {
  const { t } = useI18n();
  const T = t.telegram;
  const [link, setLink] = useState<{ code: string; url: string | null; bot: string | null } | null>(null);
  const create = useAction(createTelegramLinkAction, { successMessage: false, refresh: false });
  const unlink = useAction(unlinkTelegramAction);
  return (
    <div className="grid gap-4">
      <p className="text-lg">{linkedAs ? <>✅ {T.linked} <b>{linkedAs}</b></> : T.notLinked}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="lg" disabled={create.pending} onClick={async () => setLink(await create.run({}))}><Link2 /> {T.getLink}</Button>
        {linkedAs ? <Button size="lg" variant="outline" disabled={unlink.pending} onClick={() => void unlink.run({ employee_id: employeeId })}><Unlink /> {T.unlink}</Button> : null}
      </div>
      {link ? (
        <div className="grid gap-3 rounded-2xl border border-border bg-card p-4">
          {link.url ? <Button asChild size="lg"><a href={link.url} target="_blank" rel="noreferrer"><Send /> {T.openBot}</a></Button> : null}
          <p className="text-sm text-muted-foreground">{T.codeHint}{link.bot ? ` @${link.bot}` : ''}</p>
          <code className="select-all rounded-lg bg-muted p-3 text-center text-lg">/start {link.code}</code>
        </div>
      ) : null}
    </div>
  );
}

export function TelegramWebhookButton() {
  const { t } = useI18n();
  const set = useAction(setTelegramWebhookAction, { successMessage: t.admin.webhookSet, refresh: false });
  return <Button variant="outline" disabled={set.pending} onClick={() => void set.run({})}><Webhook /> {t.admin.setWebhook}</Button>;
}
