import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('[DB-CHECK] Connecting to PostgreSQL...');

    // 1. Check migrations table
    const migrations = await prisma.$queryRaw<
      Array<{ migration_name: string; finished_at: Date | null }>
    >`
      SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at ASC;
    `;
    console.log('[DB-CHECK] Applied migrations in _prisma_migrations:');
    for (const m of migrations) {
      console.log(
        `  - ${m.migration_name} (finished: ${m.finished_at ? m.finished_at.toISOString() : 'in progress'})`,
      );
    }

    // 2. Check public tables
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    console.log('[DB-CHECK] Tables in schema public:');
    for (const t of tables) {
      console.log(`  - ${t.table_name}`);
    }

    // 3. Check row counts
    const userCount = await prisma.user.count();
    const orgCount = await prisma.organization.count();
    const membershipCount = await prisma.membership.count();
    const sessionCount = await prisma.session.count();

    console.log('[DB-CHECK] Table row counts:');
    console.log(`  - users: ${userCount}`);
    console.log(`  - organizations: ${orgCount}`);
    console.log(`  - memberships: ${membershipCount}`);
    console.log(`  - sessions: ${sessionCount}`);

    // 4. Check foreign keys
    const fks = await prisma.$queryRaw<
      Array<{ constraint_name: string; table_name: string; foreign_table_name: string }>
    >`
      SELECT
        tc.constraint_name,
        tc.table_name,
        ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      ORDER BY tc.table_name, tc.constraint_name;
    `;
    console.log('[DB-CHECK] Foreign key constraints:');
    for (const fk of fks) {
      console.log(`  - ${fk.table_name} -> ${fk.foreign_table_name} (${fk.constraint_name})`);
    }

    // 5. Check indexes
    const indexes = await prisma.$queryRaw<
      Array<{ tablename: string; indexname: string; indexdef: string }>
    >`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname;
    `;
    console.log('[DB-CHECK] Indexes:');
    for (const idx of indexes) {
      console.log(`  - ${idx.tablename}.${idx.indexname}`);
    }

    console.log('[DB-CHECK] Database inspection completed successfully.');
  } catch (err: unknown) {
    console.error('[DB-CHECK] Error connecting or querying database:', (err as Error).message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
