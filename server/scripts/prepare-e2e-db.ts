import { execSync } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const envPath = path.resolve(__dirname, '../.env.e2e');
dotenv.config({ path: envPath, override: true });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required in server/.env.e2e');
}

const targetUrl = new URL(databaseUrl);
const targetDatabase = targetUrl.pathname.replace(/^\//, '');

if (!/(e2e|test)/i.test(targetDatabase)) {
  throw new Error(`Refusing to prepare non-E2E database: ${targetDatabase}`);
}

const maintenanceUrl = new URL(databaseUrl);
maintenanceUrl.pathname = '/postgres';

async function ensureDatabase() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: maintenanceUrl.toString(),
      },
    },
  });

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      targetDatabase
    );

    if (!rows[0]?.exists) {
      await prisma.$executeRawUnsafe(`CREATE DATABASE "${targetDatabase.replace(/"/g, '""')}"`);
      console.log(`Created E2E database ${targetDatabase}`);
    } else {
      console.log(`E2E database ${targetDatabase} already exists`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await ensureDatabase();

  const serverRoot = path.resolve(__dirname, '..');
  const env = {
    ...process.env,
    ENV_FILE: '.env.e2e',
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
  };

  if (process.env.E2E_PRISMA_GENERATE === 'true') {
    execSync('npx prisma generate', { cwd: serverRoot, env, stdio: 'inherit' });
  }
  execSync('npx prisma migrate deploy', { cwd: serverRoot, env, stdio: 'inherit' });
  execSync('npm run e2e:db:seed', { cwd: serverRoot, env, stdio: 'inherit' });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
