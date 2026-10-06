/**
 * Database test harness.
 *
 * Creates a throw-away PostgreSQL database per test file, installs a minimal
 * Supabase stub (auth schema + roles) and applies every migration in
 * supabase/migrations in order. Queries can then run as a specific employee
 * through RLS exactly like PostgREST does (role `authenticated` + JWT `sub`).
 *
 * Requires TEST_DATABASE_URL (a superuser connection to any database), e.g.
 *   TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres
 * Tests are skipped when it is not set.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
export const hasDb = TEST_DATABASE_URL.length > 0;

const root = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');

export type Role = 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN';

export interface TestDb {
  pool: pg.Pool;
  /** Run SQL as superuser (bypasses RLS). */
  admin<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run SQL as an authenticated user through RLS (null = anonymous). */
  as<T extends pg.QueryResultRow = pg.QueryResultRow>(userId: string | null, sql: string, params?: unknown[]): Promise<T[]>;
  /** Like admin() but returns exactly one row (throws otherwise). */
  adminOne<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T>;
  /** Like as() but returns exactly one row (throws otherwise). */
  asOne<T extends pg.QueryResultRow = pg.QueryResultRow>(userId: string | null, sql: string, params?: unknown[]): Promise<T>;
  /** Create an auth user + active employee with the given role. Returns the user id. */
  createEmployee(role: Role, name?: string): Promise<string>;
  destroy(): Promise<void>;
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export async function createTestDb(): Promise<TestDb> {
  const dbName = `custard_t_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const adminClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await adminClient.connect();
  await adminClient.query(`create database ${dbName}`);
  await adminClient.end();

  const pool = new pg.Pool({ connectionString: withDatabase(TEST_DATABASE_URL, dbName), max: 4 });
  const setup = await pool.connect();
  try {
    await setup.query(readFileSync(path.join(root, 'supabase', 'tests', 'supabase_stub.sql'), 'utf8'));
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
      try {
        await setup.query(readFileSync(path.join(migrationsDir, file), 'utf8'));
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    setup.release();
  }

  const admin: TestDb['admin'] = async (sql, params = []) => (await pool.query(sql, params)).rows;

  const as: TestDb['as'] = async (userId, sql, params = []) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
      const res = await client.query(sql, params);
      await client.query('commit');
      return res.rows;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  };

  const single = <T>(rows: T[]): T => {
    if (rows.length !== 1 || rows[0] === undefined) throw new Error(`expected 1 row, got ${rows.length}`);
    return rows[0];
  };
  const adminOne: TestDb['adminOne'] = async (sql, params) => single(await admin(sql, params));
  const asOne: TestDb['asOne'] = async (userId, sql, params) => single(await as(userId, sql, params));

  const createEmployee: TestDb['createEmployee'] = async (role, name) => {
    const user = await adminOne<{ id: string }>(
      `insert into auth.users (email) values ($1) returning id`,
      [`${role.toLowerCase()}-${randomUUID().slice(0, 8)}@test.local`],
    );
    await admin(
      `insert into public.employees (user_id, role_id, display_name)
       select $1, id, $2 from public.roles where code = $3`,
      [user.id, name ?? role, role],
    );
    return user.id;
  };

  const destroy = async () => {
    await pool.end();
    const c = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await c.connect();
    await c.query(`drop database if exists ${dbName} with (force)`);
    await c.end();
  };

  return { pool, admin, as, adminOne, asOne, createEmployee, destroy };
}
