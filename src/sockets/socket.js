import sessionManager from '../services/session.manager.js';
import logger from '../utils/logger.js';

/**
 * Initialize Socket.IO handlers
 * @param {import('socket.io').Server} io
 */
export function initSocket(io) {
  sessionManager.init(io);

  io.on('connection', (socket) => {
    logger.info('Socket.IO client connected', { socketId: socket.id });

    socket.on('join:session', (sessionId) => {
      if (sessionId) {
        socket.join(`session:${sessionId}`);
        logger.debug('Client joined session room', { socketId: socket.id, sessionId });
        socket.emit('session.joined', { sessionId });
      }
    });

    socket.on('leave:session', (sessionId) => {
      if (sessionId) {
        socket.leave(`session:${sessionId}`);
        logger.debug('Client left session room', { socketId: socket.id, sessionId });
      }
    });

    socket.on('sessions:stats', () => {
      socket.emit('sessions.stats', sessionManager.getStats());
    });

    socket.on('disconnect', (reason) => {
      logger.info('Socket.IO client disconnected', { socketId: socket.id, reason });
    });
  });

  logger.info('Socket.IO initialized');
}

export default { initSocket };
