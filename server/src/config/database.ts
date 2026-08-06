import { PrismaClient } from '@prisma/client';
import { logger } from './logger';
import { isDev } from './env';
import { createAuditExtension } from '@modules/audit/audit.prisma';

/**
 * Prisma Client Singleton
 *
 * WHY singleton?
 * Prisma maintains a connection pool internally.
 * Creating multiple PrismaClient instances would exhaust
 * the PostgreSQL connection limit very quickly.
 *
 * In development with hot-reload (nodemon), the module cache
 * is cleared on restart, but the global object persists —
 * this prevents creating new connections on every file change.
 */

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const basePrisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log: isDev
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
        ]
      : [{ emit: 'event', level: 'error' }],
  });

export const prisma: PrismaClient = basePrisma.$extends(createAuditExtension(basePrisma)) as unknown as PrismaClient;

// In dev, log all SQL queries for debugging
if (isDev) {
  basePrisma.$on('query' as never, (e: { query: string; duration: number }) => {
    logger.debug(`Prisma Query [${e.duration}ms]`, { query: e.query });
  });
}

basePrisma.$on('error' as never, (e: { message: string }) => {
  logger.error('Prisma Error', { message: e.message });
});

// Store on global to survive hot-reload in development
if (isDev) {
  global.__prisma = basePrisma;
}

let databaseConnected = false;

export function setDatabaseConnected(value: boolean): void {
  databaseConnected = value;
}

export function isDatabaseConnected(): boolean {
  return databaseConnected;
}

/**
 * Gracefully disconnect Prisma on process termination.
 * This ensures all in-flight queries complete before shutdown.
 */
export async function disconnectDatabase(): Promise<void> {
  await basePrisma.$disconnect();
  setDatabaseConnected(false);
  logger.info('Database disconnected gracefully');
}
