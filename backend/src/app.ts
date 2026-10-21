import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config, isTest } from './config.js';
import { logger } from './logger.js';
import { checkDb } from './db.js';
import { checkRedis } from './redis.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth/routes.js';
import { attendanceRouter } from './modules/attendance/routes.js';
import { leavesRouter } from './modules/leaves/routes.js';
import { employeesRouter } from './modules/employees/routes.js';
import { documentsRouter } from './modules/documents/routes.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { chatRouter } from './modules/chat/routes.js';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => req.url === '/api/health' },
        customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
        serializers: {
          req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
      }),
    );
  }

  app.get('/api/health', async (_req, res) => {
    const [db, redis] = await Promise.all([checkDb(), checkRedis()]);
    res.json({ status: 'ok', db, redis });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/attendance', attendanceRouter);
  app.use('/api/leaves', leavesRouter);
  app.use('/api/employees', employeesRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/chat', chatRouter);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
