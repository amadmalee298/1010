import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/server/auth';
import { getBill } from '@/server/repositories/bills';
import { buildSubstituteReceipt } from '@/server/bills/substitute';
import { substituteReceiptHtml } from '@/domain/bills';
import { can } from '@/domain/permissions';

/** Printable substitute receipt (ใบรับรองแทนใบเสร็จรับเงิน) for an approved bill without a receipt. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const employee = await getCurrentEmployee();
  if (!employee || !can(employee.role, 'approveBills')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await params;
  const db = await createSupabaseServerClient();
  const bill = await getBill(db, id);
  const doc = bill ? await buildSubstituteReceipt(db, bill) : null;
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return new NextResponse(substituteReceiptHtml(doc), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
