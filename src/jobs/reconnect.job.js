import sessionManager from '../services/session.manager.js';
import logger from '../utils/logger.js';

/**
 * Reconnect job - periodically checks disconnected sessions and attempts reconnect
 */
class ReconnectJob {
  constructor() {
    this.interval = null;
    this.isRunning = false;
  }

  /**
   * Start reconnect job
   * @param {number} intervalMs
   */
  start(intervalMs = 60000) {
    if (this.isRunning) return;

    this.isRunning = true;
    this.interval = setInterval(() => this.run(), intervalMs);
    logger.info('Reconnect job started', { intervalMs });
  }

  /**
   * Stop reconnect job
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    logger.info('Reconnect job stopped');
  }

  /**
   * Run reconnect check
   */
  async run() {
    const sessions = sessionManager.getAllSessions();
    const disconnected = sessions.filter((s) => s.status === 'disconnected');

    for (const session of disconnected) {
      if (session.reconnectAttempts < 10) {
        try {
          logger.info('Reconnect job attempting reconnect', {
            sessionId: session.sessionId,
          });
          await sessionManager.reconnectSession(session.sessionId);
        } catch (error) {
          logger.error('Reconnect job failed', {
            sessionId: session.sessionId,
            error: error.message,
          });
        }
      }
    }
  }
}

const reconnectJob = new ReconnectJob();
export default reconnectJob;
