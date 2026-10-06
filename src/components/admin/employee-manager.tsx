'use client';
import { useState } from 'react';
import { KeyRound, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { formToObject } from '@/lib/form';
import { createEmployeeAction, resetPasswordAction, updateEmployeeAction } from '@/server/actions/admin';
import type { AppRole } from '@/lib/database.types';

export interface DirectoryEntry { id: string; user_id: string | null; display_name: string; phone: string | null; is_active: boolean; role: AppRole; email: string | null }
// KITCHEN stays valid in the database but is not offered: it has no screen without the kitchen display.
const ROLES: AppRole[] = ['OWNER', 'MANAGER', 'CASHIER'];

export function EmployeeManager({ employees, canCreate }: { employees: DirectoryEntry[]; canCreate: boolean }) {
  const { t } = useI18n();
  const A = t.admin;
  const [dialog, setDialog] = useState<{ kind: 'new' } | { kind: 'edit' | 'password'; e: DirectoryEntry } | null>(null);
  const create = useAction(createEmployeeAction);
  const update = useAction(updateEmployeeAction);
  const reset = useAction(resetPasswordAction);
  const roleSelect = (value?: AppRole) => (
    <NativeSelect name="role" defaultValue={value ?? 'CASHIER'}>{ROLES.map((r) => <option key={r} value={r}>{t.roles[r]}</option>)}</NativeSelect>
  );
  return (
    <>
      {!canCreate ? <p className="mb-4 rounded-xl bg-warning/20 p-3 text-sm">{A.serviceKeyMissing}</p> : null}
      <div className="mb-4 flex justify-end"><Button disabled={!canCreate} onClick={() => setDialog({ kind: 'new' })}><Plus /> {A.newEmployee}</Button></div>
      <Table>
        <THead><TR><TH>{t.common.name}</TH><TH>{A.email}</TH><TH>{A.role}</TH><TH>{t.common.status}</TH><TH /></TR></THead>
        <TBody>
          {employees.map((e) => (
            <TR key={e.id} className={e.is_active ? '' : 'opacity-50'}>
              <TD className="font-medium">{e.display_name}</TD><TD>{e.email}</TD>
              <TD><Badge variant={e.role === 'OWNER' ? 'default' : 'secondary'}>{t.roles[e.role]}</Badge></TD>
              <TD><Badge variant={e.is_active ? 'success' : 'secondary'}>{e.is_active ? t.common.active : t.common.inactive}</Badge></TD>
              <TD className="whitespace-nowrap text-right">
                {e.user_id && canCreate ? <Button size="sm" variant="ghost" aria-label={A.resetPassword} onClick={() => setDialog({ kind: 'password', e })}><KeyRound /></Button> : null}
                <Button size="sm" variant="ghost" aria-label={t.common.edit} onClick={() => setDialog({ kind: 'edit', e })}><Pencil /></Button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          {dialog?.kind === 'new' ? (
            <>
              <DialogHeader><DialogTitle>{A.newEmployee}</DialogTitle></DialogHeader>
              <form className="grid gap-4" autoComplete="off" onSubmit={async (ev) => { ev.preventDefault(); if (await create.run(formToObject(ev.currentTarget))) setDialog(null); }}>
                <Field label={t.common.name} error={create.fieldErrors.display_name?.[0]}><Input name="display_name" required /></Field>
                <Field label={A.email} error={create.fieldErrors.email?.[0]}><Input name="email" type="email" required autoComplete="off" /></Field>
                <Field label={A.tempPassword} error={create.fieldErrors.password?.[0]}><Input name="password" type="password" minLength={8} required autoComplete="new-password" /></Field>
                <Field label={A.role}>{roleSelect()}</Field>
                <Field label={A.phone}><Input name="phone" inputMode="tel" /></Field>
                <DialogFooter><Button type="submit" disabled={create.pending}>{t.common.save}</Button></DialogFooter>
              </form>
            </>
          ) : dialog?.kind === 'edit' ? (
            <>
              <DialogHeader><DialogTitle>{A.editEmployee}</DialogTitle></DialogHeader>
              <form className="grid gap-4" onSubmit={async (ev) => { ev.preventDefault(); if (await update.run({ ...formToObject(ev.currentTarget), id: dialog.e.id })) setDialog(null); }}>
                <Field label={t.common.name}><Input name="display_name" defaultValue={dialog.e.display_name} required /></Field>
                <Field label={A.role}>{roleSelect(dialog.e.role)}</Field>
                <Field label={A.phone}><Input name="phone" defaultValue={dialog.e.phone ?? ''} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={dialog.e.is_active} className="size-5" /> {t.common.active}</label>
                <DialogFooter><Button type="submit" disabled={update.pending}>{t.common.save}</Button></DialogFooter>
              </form>
            </>
          ) : dialog?.kind === 'password' && dialog.e.user_id ? (
            <>
              <DialogHeader><DialogTitle>{A.resetPassword}: {dialog.e.display_name}</DialogTitle></DialogHeader>
              <form className="grid gap-4" onSubmit={async (ev) => {
                ev.preventDefault(); const fd = new FormData(ev.currentTarget);
                if (await reset.run({ user_id: dialog.e.user_id, password: fd.get('password') })) setDialog(null);
              }}>
                <Field label={A.newPassword}><Input name="password" type="password" minLength={8} required autoComplete="new-password" /></Field>
                <DialogFooter><Button type="submit" disabled={reset.pending}>{t.common.save}</Button></DialogFooter>
              </form>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
