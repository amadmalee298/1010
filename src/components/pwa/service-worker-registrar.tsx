'use client';
import { useEffect } from 'react';

/** Registers /sw.js in production so the app is installable and the shell works offline. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => console.warn('SW registration failed', err));
  }, []);
  return null;
}
