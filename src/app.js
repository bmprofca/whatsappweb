import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import env from './config/env.js';
import apiKeyAuth from './middlewares/auth.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import messageRoutes from './routes/message.routes.js';
import sessionRoutes from './routes/session.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import sessionService from './services/session.service.js';
import { formatUptime, getMemoryUsage } from './utils/helpers.js';
import { success } from './utils/response.js';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin === '*' ? '*' : env.corsOrigin.split(','),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'X-API-Key'],
  }),
);

const limiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
});

app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  return success(res, 'Server is working');
});

app.get('/health', (req, res) => {
  const stats = sessionService.getStats();
  return success(res, 'Server is healthy', {
    status: 'ok',
    uptime: formatUptime(process.uptime()),
    memory: getMemoryUsage(),
    sessions: stats.total,
    connected: stats.connected,
    connecting: stats.connecting,
    disconnected: stats.disconnected,
    reconnectQueue: stats.reconnectQueue,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', apiKeyAuth);

app.use('/api/sessions', sessionRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/webhooks', webhookRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
