import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/server/auth';
import { buildReport } from '@/server/reports/tables';
import { REPORT_TYPES, reportRangeSchema, type ReportType } from '@/domain/schemas/reports';
import { toCsv } from '@/domain/csv';
import { can } from '@/domain/permissions';
import { getT } from '@/i18n/server';
import { DbOperationError } from '@/server/action';

export async function GET(request: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  if (!(REPORT_TYPES as readonly string[]).includes(type)) return NextResponse.json({ error: 'unknown report' }, { status: 404 });
  const employee = await getCurrentEmployee();
  if (!employee || !can(employee.role, 'viewReports')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const range = reportRangeSchema.safeParse({ from: request.nextUrl.searchParams.get('from'), to: request.nextUrl.searchParams.get('to') });
  if (!range.success) return NextResponse.json({ error: 'invalid range' }, { status: 400 });
  try {
    const table = await buildReport(await createSupabaseServerClient(), type as ReportType, range.data, await getT());
    return new NextResponse(toCsv(table.headers, table.rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="custard-${type}-${range.data.from}_${range.data.to}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof DbOperationError) return NextResponse.json({ error: err.db.message }, { status: 400 });
    throw err;
  }
}
