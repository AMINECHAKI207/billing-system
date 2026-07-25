import assert from 'assert/strict';
import path from 'path';
import { spawnSync } from 'child_process';

const serverRoot = path.resolve(__dirname, '../..');

const result = spawnSync(
  process.execPath,
  [
    '-r',
    'ts-node/register',
    '-e',
    "require('./src/config/env.ts')",
  ],
  {
    cwd: serverRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/billing_db?schema=public',
      JWT_ACCESS_SECRET: 'dev_access_secret_replace_before_production_1234567890',
      JWT_REFRESH_SECRET: 'dev_refresh_secret_replace_before_production_1234567890',
      COOKIE_SECRET: 'dev_cookie_secret',
      CLIENT_URL: 'https://billing.example.com',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: 'demo@example.com',
      SMTP_PASS: 'replace_with_smtp_password',
      SMTP_FROM_NAME: 'Billing System',
      SMTP_FROM_EMAIL: 'demo@example.com',
      UPLOADS_DIR: './uploads',
    },
  }
);

assert.notEqual(result.status, 0);
assert.match(result.stderr, /JWT_ACCESS_SECRET must be changed for production/);
assert.match(result.stderr, /SMTP_PASS must be changed for production/);

console.log('production env guard tests passed');
