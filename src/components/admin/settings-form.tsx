'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { formToObject } from '@/lib/form';
import { saveSettingsAction } from '@/server/actions/admin';
import type { SettingsInput } from '@/domain/schemas/admin';

export function SettingsForm({ settings }: { settings: SettingsInput }) {
  const { t } = useI18n();
  const A = t.admin;
  const save = useAction(saveSettingsAction);
  const err = (k: keyof SettingsInput) => save.fieldErrors[k]?.[0];
  const check = (name: keyof SettingsInput, label: string) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={Boolean(settings[name])} className="size-5" /> {label}</label>
  );
  return (
    <form className="grid gap-4 lg:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); await save.run(formToObject(e.currentTarget)); }}>
      <Card>
        <CardHeader><CardTitle>{A.shop}</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <Field label={A.shopName} error={err('shop_name')}><Input name="shop_name" defaultValue={settings.shop_name} required /></Field>
          <Field label={A.address}><Input name="shop_address" defaultValue={settings.shop_address} /></Field>
          <Field label={A.phone}><Input name="shop_phone" defaultValue={settings.shop_phone} /></Field>
          <Field label={A.taxId} error={err('tax_id')}><Input name="tax_id" inputMode="numeric" defaultValue={settings.tax_id} /></Field>
          <Field label={A.receiptFooter}><Input name="receipt_footer" defaultValue={settings.receipt_footer} /></Field>
        </CardContent>
      </Card>
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader><CardTitle>{A.tax}</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {check('vat_enabled', A.vatEnabled)}
            <Field label={A.vatRate} error={err('vat_rate')}><Input name="vat_rate" type="number" step="0.01" min={0} max={30} defaultValue={settings.vat_rate} /></Field>
            {check('vat_inclusive', A.vatInclusive)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{A.payments}</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <Field label={A.promptpay} error={err('promptpay_id')}><Input name="promptpay_id" inputMode="numeric" defaultValue={settings.promptpay_id} /></Field>
            <Field label={A.maxCashierDiscount}><Input name="max_cashier_discount" type="number" min={0} step="1" defaultValue={settings.max_cashier_discount} /></Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{A.loyalty}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Field label={A.bahtPerPoint}><Input name="baht_per_point" type="number" min={0} defaultValue={settings.baht_per_point} /></Field>
            <Field label={A.pointValue}><Input name="point_value" type="number" min={0} step="0.01" defaultValue={settings.point_value} /></Field>
            <Field label={A.minRedeem}><Input name="min_redeem_points" type="number" min={0} defaultValue={settings.min_redeem_points} /></Field>
          </CardContent>
        </Card>
      </div>
      <div className="lg:col-span-2"><Button type="submit" size="lg" disabled={save.pending}>{t.common.save}</Button></div>
    </form>
  );
}
