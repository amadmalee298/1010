#!/usr/bin/env bash
# Prints a percent-encoded Postgres URL for `supabase db push --db-url`.
#
# SUPABASE_DB_URL may be pasted exactly as shown in the Supabase "Connect" panel, with the
# literal [YOUR-PASSWORD] placeholder or with a password typed in. When SUPABASE_DB_PASSWORD
# is set it always wins, so a stale password left in the URL cannot cause a login failure.
# Typical phone copy/paste damage (surrounding spaces, newlines, [brackets]) is cleaned up,
# and non-secret diagnostics go to stderr so a failed run explains itself.
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is empty}"
exec python3 -I - <<'PY'
import os
import re
import sys
import urllib.parse


def note(msg: str) -> None:
    print(msg, file=sys.stderr)


url = "".join(os.environ["SUPABASE_DB_URL"].split())
placeholder = "[YOUR-PASSWORD]"
had_placeholder = placeholder in url
url = url.replace(placeholder, "__PASSWORD__")

# Parsed by hand: a typed-in password may contain unencoded @ / # ? characters.
m = re.fullmatch(r"(postgres(?:ql)?)://([^:@/]+)(?::(.*))?@([^@/]+?)(?::(\d+))?(/.*)?", url)
if not m:
    note("::error::SUPABASE_DB_URL must look like postgresql://USER:PASSWORD@HOST:5432/postgres")
    sys.exit(1)
scheme, user, url_password, host, port, path = m.groups()
url_password = urllib.parse.unquote(url_password or "").replace("__PASSWORD__", "")

secret = os.environ.get("SUPABASE_DB_PASSWORD", "")
cleaned = secret.strip()
if cleaned != secret:
    note("note: removed spaces/newlines around SUPABASE_DB_PASSWORD")

if cleaned:
    password, source = cleaned, "SUPABASE_DB_PASSWORD"
    if not had_placeholder and url_password and url_password != cleaned:
        note("note: SUPABASE_DB_URL contains a different password; using SUPABASE_DB_PASSWORD instead")
elif had_placeholder or not url_password:
    note("::error::SUPABASE_DB_URL has no password ([YOUR-PASSWORD]) and SUPABASE_DB_PASSWORD is empty")
    sys.exit(1)
else:
    password, source = url_password, "SUPABASE_DB_URL"

if len(password) > 2 and password.startswith("[") and password.endswith("]"):
    password = password[1:-1]
    note(f"note: removed [ ] around the password from {source}")

note(f"host: {host}  port: {port}  user: {user}")
note(f"password from: {source}")
if not password.isascii():
    note("warning: password contains non-English characters (Thai keyboard or smart quotes?)")
if "pooler.supabase.com" not in host:
    note("warning: host is not the Session pooler; GitHub runners cannot reach the IPv6-only direct host")
elif port == "6543":
    note("warning: port 6543 is the Transaction pooler; use the Session pooler (port 5432)")

hostport = f"{host}:{port}" if port else host
print(f"{scheme}://{user}:{urllib.parse.quote(password, safe='')}@{hostport}{path or ''}", end="")
PY
