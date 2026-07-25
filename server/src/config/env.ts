import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('5000').transform(Number),

  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid URL' }),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  COOKIE_SECRET: z.string().min(16, 'COOKIE_SECRET must be at least 16 characters'),

  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  TRUST_PROXY: z.string().default('false').transform((value) => value === 'true'),

  SMTP_HOST: z.string(),
  SMTP_PORT: z.string().default('587').transform(Number),
  SMTP_SECURE: z.string().default('false').transform((value) => value === 'true'),
  SMTP_USER: z.string().email(),
  SMTP_PASS: z.string(),
  SMTP_FROM_NAME: z.string().default('Billing System'),
  SMTP_FROM_EMAIL: z.string().email(),

  UPLOADS_DIR: z.string().default('./uploads'),
  MAX_FILE_SIZE_MB: z.string().default('10').transform(Number),

  AI_BACKGROUND_REMOVAL_PYTHON: z.string().default('python'),
  AI_BACKGROUND_REMOVAL_MODEL: z.string().default('ZhengPeng7/BiRefNet'),
  AI_BACKGROUND_REMOVAL_IMAGE_SIZE: z.string().default('768').transform(Number),
  AI_BACKGROUND_REMOVAL_TIMEOUT_MS: z.string().default('180000').transform(Number),

  DEFAULT_CURRENCY: z.string().default('MAD'),
  COMPANY_NAME: z.string().default('My Company'),
  COMPANY_ADDRESS: z.string().optional(),
  COMPANY_PHONE: z.string().optional(),
  COMPANY_EMAIL: z.string().email().optional(),
  COMPANY_TAX_NUMBER: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return;

  const forbiddenProductionValues: Array<[keyof typeof value, string]> = [
    ['JWT_ACCESS_SECRET', 'dev_access_secret_replace_before_production_1234567890'],
    ['JWT_REFRESH_SECRET', 'dev_refresh_secret_replace_before_production_1234567890'],
    ['COOKIE_SECRET', 'dev_cookie_secret'],
    ['SMTP_USER', 'demo@example.com'],
    ['SMTP_FROM_EMAIL', 'demo@example.com'],
    ['SMTP_PASS', 'replace_with_smtp_password'],
  ];

  for (const [key, forbiddenValue] of forbiddenProductionValues) {
    if (value[key] === forbiddenValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} must be changed for production`,
      });
    }
  }
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('Invalid environment variables:\n');
  console.error(
    _env.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
  );
  console.error('\nCheck your .env file against .env.example\n');
  process.exit(1);
}

export const env = _env.data;

export const isDev = env.NODE_ENV === 'development';
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
