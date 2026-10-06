import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { getLocale } from '@/i18n/server';
import { I18nProvider } from '@/i18n/client';
import { ServiceWorkerRegistrar } from '@/components/pwa/service-worker-registrar';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Custard POS', template: '%s · Custard POS' },
  description: 'ระบบขายและบริหารร้านขนมหวาน Custard',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Custard POS', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon.svg', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#b8761a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <I18nProvider locale={locale}>
          {children}
          <Toaster position="top-center" richColors closeButton />
        </I18nProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
