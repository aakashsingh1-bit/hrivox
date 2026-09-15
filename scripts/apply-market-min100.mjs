/**
 * Apply market min-100 migration using SUPABASE_SERVICE_ROLE_KEY / DB URL from .env
 * Usage: node scripts/apply-market-min100.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const sqlPath = resolve(root, 'supabase/migrations/20260915010000_market_min100_no_final_hour.sql');

function loadEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim();
  }
  return out;
}

const env = { ...process.env, ...loadEnv(envPath) };
const sql = readFileSync(sqlPath, 'utf8');
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
const dbUrl = env.DATABASE_URL || env.SUPABASE_DB_URL || '';
const ref = url.replace(/^https?:\/\//, '').split('.')[0];

async function viaFetchSql() {
  // Supabase SQL over Management API (needs personal access token)
  const pat = env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_PAT || '';
  if (!pat || !ref) return null;
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, via: 'management-api' };
}

async function viaPg(connectionString) {
  const { default: pg } = await import('pg').catch(() => ({ default: null }));
  if (!pg) {
    // dynamic install hint
    throw new Error('pg package missing');
  }
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    const check = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'place_bets'
      LIMIT 1
    `);
    const def = check.rows[0]?.def || '';
    const hasMin = def.includes('Minimum bet Rs 100');
    const harfOnlyFinal =
      def.includes("v_game.short_code = 'HF'") || def.includes('v_is_harf');
    return { ok: true, via: 'postgres', hasMin, harfOnlyFinal };
  } finally {
    await client.end();
  }
}

async function main() {
  console.log('Applying', sqlPath);

  const mgmt = await viaFetchSql();
  if (mgmt) {
    console.log(mgmt);
    if (mgmt.ok) {
      console.log('Migration applied via Management API');
      return;
    }
  }

  const candidates = [];
  if (dbUrl) candidates.push(dbUrl);
  // Common pooler URLs — password must be the database password (not API secret)
  if (env.SUPABASE_DB_PASSWORD && ref) {
    const pwd = encodeURIComponent(env.SUPABASE_DB_PASSWORD);
    candidates.push(
      `postgresql://postgres.${ref}:${pwd}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`,
    );
    candidates.push(
      `postgresql://postgres.${ref}:${pwd}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
    );
    candidates.push(`postgresql://postgres:${pwd}@db.${ref}.supabase.co:5432/postgres`);
  }

  if (!candidates.length) {
    console.error(`
No DATABASE_URL / SUPABASE_DB_PASSWORD / SUPABASE_ACCESS_TOKEN in .env

Add one of these to .env then re-run:
  DATABASE_URL=postgresql://postgres.[ref]:[DB_PASSWORD]@aws-0-....pooler.supabase.com:6543/postgres
  SUPABASE_DB_PASSWORD=your-database-password
  SUPABASE_ACCESS_TOKEN=sbp_... (Account → Access Tokens)

Service role API key alone cannot run DDL (CREATE FUNCTION).
`);
    process.exit(2);
  }

  let lastErr;
  for (const conn of candidates) {
    try {
      const result = await viaPg(conn);
      console.log(result);
      if (result.hasMin) console.log('Verified: Minimum bet Rs 100 is in place_bets');
      else console.warn('Applied but could not verify min-100 string in function body');
      return;
    } catch (e) {
      lastErr = e;
      console.warn('Conn failed:', e instanceof Error ? e.message : e);
    }
  }
  console.error('All connection attempts failed:', lastErr);
  process.exit(1);
}

main();
