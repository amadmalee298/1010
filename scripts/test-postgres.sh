#!/usr/bin/env bash
# Starts a disposable local PostgreSQL for `npm run test:db` (no Docker needed).
# Usage: npm run db:test-server   then   TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres npm run test:db
set -euo pipefail
PGBIN="${PGBIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")}"
PGDATA="${PGDATA:-/tmp/custard-pgdata}"
PORT="${PGPORT:-54329}"
if [ ! -d "$PGDATA" ]; then "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 >/dev/null; fi
"$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k /tmp" -l "$PGDATA/server.log" start
echo "TEST_DATABASE_URL=postgres://postgres@localhost:$PORT/postgres?host=/tmp"
