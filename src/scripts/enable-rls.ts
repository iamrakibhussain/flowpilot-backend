import { prisma } from '../database/prisma.js';

async function main() {
  console.log('--- FlowPilot Supabase RLS Hardening & PostgREST Lockdown ---');

  // 1. Fetch all tables in the public schema
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
  `;

  console.log(`Found ${tables.length} tables in public schema.`);

  // 2. Enable RLS on every table
  for (const { tablename } of tables) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE public."${tablename}" ENABLE ROW LEVEL SECURITY;`);
      console.log(`[RLS ENABLED] public."${tablename}"`);
    } catch (err) {
      console.error(`[ERROR] Failed to enable RLS on "${tablename}":`, err);
    }
  }

  // 3. Revoke public/anon/authenticated permissions from public schema (stops PostgREST data leaks)
  try {
    const roles = await prisma.$queryRaw<Array<{ rolname: string }>>`
      SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated');
    `;
    const roleNames = roles.map((r) => r.rolname);
    console.log(`Found Supabase API roles: ${roleNames.join(', ')}`);

    if (roleNames.length > 0) {
      for (const role of roleNames) {
        await prisma.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${role}";`);
        await prisma.$executeRawUnsafe(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "${role}";`);
        await prisma.$executeRawUnsafe(`REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM "${role}";`);
        await prisma.$executeRawUnsafe(`REVOKE USAGE ON SCHEMA public FROM "${role}";`);
        console.log(`[REVOKED ALL ACCESS] Revoked public schema usage from PostgREST role: "${role}"`);
      }
    }
  } catch (err) {
    console.warn(`[WARN] Note on role permissions:`, err);
  }

  // 4. Verify RLS status
  const verification = await prisma.$queryRaw<Array<{ tablename: string; rowsecurity: boolean }>>`
    SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
  `;

  console.log('\n--- Final Verification ---');
  let allSecured = true;
  for (const { tablename, rowsecurity } of verification) {
    console.log(`Table: ${tablename.padEnd(35)} RLS: ${rowsecurity ? 'ENABLED (SECURE)' : 'DISABLED (RISK)'}`);
    if (!rowsecurity) allSecured = false;
  }

  if (allSecured) {
    console.log('\nSUCCESS: 100% of tables in public schema now have Row Level Security ENABLED!');
  } else {
    console.warn('\nWARNING: Some tables still do not have RLS enabled.');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error during RLS hardening:', err);
  process.exit(1);
});

