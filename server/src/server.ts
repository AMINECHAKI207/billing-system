import { env } from '@config/env';
import { logger } from '@config/logger';
import { disconnectDatabase, prisma, setDatabaseConnected } from '@config/database';
import { createApp } from './app';
import http from 'http';
import { startRecurringBillingJob, stopRecurringBillingJob } from './jobs/recurringBilling.job';

async function bootstrap(): Promise<void> {
  const app = createApp();
  const server = http.createServer(app);

  server.listen(env.PORT, () => {
    logger.info('Server running', {
      port: env.PORT,
      environment: env.NODE_ENV,
      url: `http://localhost:${env.PORT}`,
      health: `http://localhost:${env.PORT}/health`,
    });
  });

  try {
    await prisma.$connect();
    setDatabaseConnected(true);
    logger.info('Database connected successfully');
    startRecurringBillingJob();
  } catch (error) {
    setDatabaseConnected(false);
    logger.error('Failed to connect to database', { error });
  }

  const gracefulShutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received - shutting down gracefully`);

    server.close(async () => {
      logger.info('HTTP server closed');
      stopRecurringBillingJob();
      await disconnectDatabase();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30_000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

bootstrap();
