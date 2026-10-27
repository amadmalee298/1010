import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';

const PUBLIC_PATHS = ['/login', '/auth', '/offline', '/unavailable', '/api/telegram/', '/manifest.webmanifest', '/sw.js', '/icons/'];
/** Paths that never need the user's session; skipping the auth call keeps them fast. */
const NO_AUTH_PATHS = ['/unavailable', '/offline', '/api/telegram/', '/manifest.webmanifest', '/sw.js', '/icons/'];
/** Vercel stops middleware after ~25 s; answer well before that if Supabase hangs. */
const AUTH_TIMEOUT_MS = 8000;

/** Refreshes the auth session cookie and redirects anonymous users to /login. */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  if (NO_AUTH_PATHS.some((p) => request.nextUrl.pathname.startsWith(p))) return response;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response; // misconfigured: pages render the setup error

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), AUTH_TIMEOUT_MS));
  const result = await Promise.race([supabase.auth.getUser(), timeout]);
  if (result === 'timeout') {
    // The database is not answering (often a paused Supabase project): explain instead of a 504.
    const unavailable = request.nextUrl.clone();
    unavailable.pathname = '/unavailable';
    unavailable.search = '';
    return NextResponse.rewrite(unavailable, { status: 503 });
  }
  const { data } = result;
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!data.user && !isPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(redirect);
  }
  return response;
}
