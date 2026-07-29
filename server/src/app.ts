import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import { env } from '@config/env';
import { isDatabaseConnected } from '@config/database';
import { requestId } from '@middleware/requestId';
import { requestLogger } from '@middleware/requestLogger';
import { errorHandler } from '@middleware/errorHandler';
import { generalLimiter } from '@middleware/rateLimiter';
import authRouter from '@modules/auth/auth.routes';
import customerRouter from '@modules/customer/customer.routes';
import invoiceRouter from '@modules/invoice/invoice.routes';
import devisRouter from '@modules/devis/devis.routes';
import reminderRouter from '@modules/reminder/reminder.routes';
import settingsRouter from '@modules/settings/settings.routes';
import productRouter from '@modules/product/product.routes';
import paymentRouter from '@modules/payment/payment.routes';
import reportRouter from '@modules/report/report.routes';
import userRouter from '@modules/user/user.routes';
import rbacRouter from '@modules/rbac/rbac.routes';
import recurringRouter from '@modules/recurring/recurring.routes';
import expenseRouter from '@modules/expense/expense.routes';

export function createApp(): Application {
  const app = express();

  if (env.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(
    cors({
      origin: env.CLIENT_URL,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser(env.COOKIE_SECRET));

  app.use(requestId);
  app.use(requestLogger);
  app.use('/api', generalLimiter);
  app.use('/uploads', express.static(path.resolve(process.cwd(), env.UPLOADS_DIR)));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', (_req: Request, res: Response) => {
    const database = isDatabaseConnected() ? 'connected' : 'disconnected';

    res.status(database === 'connected' ? 200 : 503).json({
      status: database === 'connected' ? 'ok' : 'degraded',
      database,
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/customers', customerRouter);
  app.use('/api/invoices', invoiceRouter);
  app.use('/api/devis', devisRouter);
  app.use('/api/reminders', reminderRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/products', productRouter);
  app.use('/api/expense-notes', expenseRouter);
  app.use('/api/payments', paymentRouter);
  app.use('/api/reports', reportRouter);
  app.use('/api/users', userRouter);
  app.use('/api/rbac', rbacRouter);
  app.use('/api/recurring-plans', recurringRouter);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      message: 'Route not found',
      timestamp: new Date().toISOString(),
    });
  });

  app.use(errorHandler);

  return app;
}
