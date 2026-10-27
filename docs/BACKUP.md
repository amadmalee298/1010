# Database backups

**What is backed up:** the whole `public` schema of the Supabase database (sales, orders, stock,
recipes, bills, accounting, employees, signatures, settings), every day at 03:13 Bangkok time,
by the GitHub Actions workflow **Database backup**. Each backup is kept for 30 days.

**Not in the file:** bill photos and attachments (Supabase Storage). The app copies them to
Google Drive (My Drive → Custard POS), and the substitute receipts are filed there as PDFs.
Login accounts (Supabase Auth) are not included; staff can be invited again.

## One-time setup (iPhone)
1. Make a long passphrase (for example four random words and numbers) and **write it down
   somewhere safe** (Notes with a lock, password manager). Without it a backup cannot be opened.
2. GitHub → repository **1010** → Settings → Secrets and variables → Actions →
   **New repository secret** → Name `BACKUP_PASSPHRASE`, Secret = the passphrase → Add secret.
3. Actions → **Database backup** → Run workflow, to make the first backup now.

The repository is public; that is why every backup is encrypted with this passphrase.

## Where the backups are
Actions → **Database backup** → open a run → **Artifacts** → `custard-db-YYYY-MM-DD_HHMM`
(a zip containing `custard-db-….dump.gpg`).

## Restore (needs a computer with PostgreSQL 17 tools and gpg)
```bash
unzip custard-db-2026-10-28_0313.zip
gpg --decrypt custard-db-2026-10-28_0313.dump.gpg > backup.dump   # asks for the passphrase
pg_restore --list backup.dump | head                              # look inside
# Restore everything into an EMPTY project (or a new Supabase project):
pg_restore --no-owner --no-privileges --dbname "$DATABASE_URL" backup.dump
# Or a single table, e.g. bills:
pg_restore --no-owner --data-only --table bill_submissions --dbname "$DATABASE_URL" backup.dump
```
Restoring over a live database overwrites data: restore into a new project first and compare.
