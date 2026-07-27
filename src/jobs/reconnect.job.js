import { SessionModel } from '../database/models/session.model.js';
import sessionManager from '../services/session.manager.js';
import logger from '../utils/logger.js';

/**
 * Reconnect job - periodically reconnects logged-in but disconnected sessions
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
   * Reconnect previously logged-in sessions that are currently disconnected
   */
  async run() {
    try {
      const dbSessions = await SessionModel.findRestorable();

      for (const dbSession of dbSessions) {
        const sessionId = dbSession.session_id;
        let instance = sessionManager.sessions.get(sessionId);

        // Session missing from memory after crash/restart — bring it back
        if (!instance) {
          if (!sessionManager.hasCredsFile(sessionId)) {
            const restored = await sessionManager.restoreAuthFromDb(sessionId);
            if (!restored || !sessionManager.isAuthRegistered(sessionId)) {
              continue;
            }
          }

          logger.info('Reconnect job restoring missing session into memory', { sessionId });
          try {
            await sessionManager.connectSession(sessionId);
          } catch (error) {
            logger.error('Reconnect job failed to restore session', {
              sessionId,
              error: error.message,
            });
          }
          continue;
        }

        if (instance.status !== 'disconnected') continue;
        if (instance.reconnectAttempts >= 10) continue;

        try {
          logger.info('Reconnect job attempting reconnect', {
            sessionId,
            attempt: instance.reconnectAttempts + 1,
          });
          await sessionManager.reconnectSession(sessionId);
        } catch (error) {
          logger.error('Reconnect job failed', {
            sessionId,
            error: error.message,
          });
        }
      }
    } catch (error) {
      logger.error('Reconnect job run failed', { error: error.message });
    }
  }
}

const reconnectJob = new ReconnectJob();
export default reconnectJob;
