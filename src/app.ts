import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { MulterError } from 'multer';
import { HttpError } from './common/http';
import { buildOpenApi } from './common/openapi';
import { authRouter } from './modules/auth/auth.routes';
import { employeesRouter } from './modules/employees/employees.routes';
import { contactsRouter } from './modules/contacts/contacts.routes';
import { assignmentsRouter } from './modules/assignments/assignments.routes';
import { callLogsRouter } from './modules/call-logs/call-logs.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { uploadsRouter } from './modules/uploads/uploads.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { settingsRouter } from './modules/settings/settings.routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by'); app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: (process.env.WEB_URL || 'http://localhost:5173').split(','), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  const api = express.Router();
  api.use('/auth', authRouter); api.use('/employees', employeesRouter); api.use('/contacts', contactsRouter); api.use('/assignments', assignmentsRouter); api.use('/call-logs', callLogsRouter);
  api.use('/reports', reportsRouter); api.use('/dashboard', dashboardRouter); api.use('/uploads', uploadsRouter); api.use('/notifications', notificationsRouter); api.use('/settings', settingsRouter);
  app.use('/api', api);
  app.get('/api/docs.json', (_q, res) => res.json(buildOpenApi())); app.use('/api/docs', swaggerUi.serve, (req: Request, res: Response, next: NextFunction) => swaggerUi.setup(buildOpenApi())(req, res, next));
  app.use((_req, _res, next) => next(new HttpError(404, 'Route not found')));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    let status = 500, message: string | string[] = 'Internal server error';
    if (err instanceof HttpError) { status = err.status; message = err.detail; }
    else if (err instanceof MulterError) { status = 400; message = err.message; }
    else if (err?.type === 'entity.parse.failed' || err?.name === 'CastError') { status = 400; message = 'Invalid request'; }
    else if (err?.code === 11000) { status = 409; message = 'Duplicate value'; }
    else if (err?.name === 'ValidationError') { status = 400; message = err.message; }
    else console.error(err);
    res.status(status).json({ statusCode: status, message, error: status === 500 ? 'Internal Server Error' : 'Error' });
  });
  return app;
}
