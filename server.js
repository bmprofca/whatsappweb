import http from 'http';

import { Server } from 'socket.io';

import app from './src/app.js';
import { closePool, initializeDatabase, testConnection } from './src/config/database.js';
import env from './src/config/env.js';
import logger from './src/config/logger.js';
import reconnectJob from './src/jobs/reconnect.job.js';
import sessionManager from './src/services/session.manager.js';
import { initSocket } from './src/sockets/socket.js';

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: env.corsOrigin === '*' ? '*' : env.corsOrigin.split(','),
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

initSocket(io);

let isShuttingDown = false;

/**
 * Start the server
 */
async function start() {
  try {
    await initializeDatabase();
    await testConnection();

    server.listen(env.port, async () => {
      logger.info(`Server running on ${env.baseUrl}`, {
        port: env.port,
        env: env.nodeEnv,
        mode: env.isProduction ? 'production' : 'development',
      });

      await sessionManager.restoreSessions();
      reconnectJob.start(60000);
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

/**
 * Graceful shutdown handler
 * @param {string} signal
 */
async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received. Starting graceful shutdown...`);

  reconnectJob.stop();

  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await sessionManager.shutdown();
      await closePool();
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', {
    reason: reason?.message || String(reason),
  });
});

if (process.send) {
  process.on('message', (msg) => {
    if (msg === 'shutdown') shutdown('PM2_SHUTDOWN');
  });
}

start();
