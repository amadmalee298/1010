#!/usr/bin/env bash
# Prints a percent-encoded Postgres URL for `supabase db push --db-url`.
# SUPABASE_DB_URL may be pasted exactly as shown in the Supabase "Connect" panel,
# including the literal [YOUR-PASSWORD] placeholder; SUPABASE_DB_PASSWORD then fills it in.
set -euo pipefail
url="${SUPABASE_DB_URL:?SUPABASE_DB_URL is empty}"
url="$(printf '%s' "$url" | tr -d '[:space:]')"
if [[ "$url" == *"[YOUR-PASSWORD]"* ]]; then
  : "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_URL contains [YOUR-PASSWORD] but SUPABASE_DB_PASSWORD is empty}"
  encoded="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$SUPABASE_DB_PASSWORD")"
  url="${url/\[YOUR-PASSWORD\]/$encoded}"
fi
case "$url" in
  postgres://*|postgresql://*) ;;
  *) echo "SUPABASE_DB_URL must start with postgresql://" >&2; exit 1 ;;
esac
printf '%s' "$url"
