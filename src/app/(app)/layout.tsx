import { requireEmployee } from '@/server/auth';
import { AppShell } from '@/components/layout/app-shell';
import { signOut } from '@/app/login/actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const employee = await requireEmployee();
  return (
    <AppShell role={employee.role} displayName={employee.displayName} signOut={signOut}>
      {children}
    </AppShell>
  );
}
