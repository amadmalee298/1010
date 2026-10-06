'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { LogOut, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAVIGATION } from '@/config/navigation';
import { can } from '@/domain/permissions';
import { useI18n } from '@/i18n/client';
import type { AppRole } from '@/lib/database.types';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { NavIcon } from './nav-icon';
import { OnlineStatus } from '@/components/pwa/online-status';

interface ShellProps {
  role: AppRole;
  displayName: string;
  signOut: () => Promise<void>;
  children: ReactNode;
}

function NavLinks({ role, onNavigate }: { role: AppRole; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav className="grid gap-4">
      {NAVIGATION.map((group) => {
        const items = group.items.filter((i) => can(role, i.capability));
        if (!items.length) return null;
        return (
          <div key={group.label} className="grid gap-1">
            <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.nav[group.label]}</p>
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                    active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted',
                  )}
                >
                  <NavIcon name={item.icon} className="size-5" />
                  {t.nav[item.label]}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

export function AppShell({ role, displayName, signOut, children }: ShellProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const footer = (
    <div className="mt-auto grid gap-2 border-t border-border pt-3">
      <div className="px-3 text-sm">
        <p className="font-medium">{displayName}</p>
        <p className="text-xs text-muted-foreground">{t.roles[role]}</p>
      </div>
      <form action={signOut}>
        <button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-muted">
          <LogOut className="size-5" aria-hidden /> {t.nav.signOut}
        </button>
      </form>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-card p-3 lg:flex">
        <Link href="/" className="flex items-center gap-2 px-3 py-2 text-lg font-semibold"><span aria-hidden>🍮</span> Custard</Link>
        <NavLinks role={role} />
        {footer}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
          <button type="button" onClick={() => setOpen(true)} className="rounded-xl p-2 hover:bg-muted" aria-label="menu">
            <Menu className="size-6" />
          </button>
          <span className="font-semibold">🍮 Custard</span>
          <div className="ml-auto"><OnlineStatus /></div>
        </header>
        <div className="hidden justify-end px-6 pt-3 lg:flex"><OnlineStatus /></div>
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent side="right" className="left-0 right-auto max-w-72 rounded-l-none rounded-r-2xl">
          <DialogTitle>🍮 Custard</DialogTitle>
          <NavLinks role={role} onNavigate={() => setOpen(false)} />
          {footer}
        </DialogContent>
      </Dialog>
    </div>
  );
}
