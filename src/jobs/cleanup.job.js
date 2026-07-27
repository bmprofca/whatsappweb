import { SessionModel } from '../database/models/session.model.js';
import sessionManager from '../services/session.manager.js';
import logger from '../utils/logger.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
const STALE_MINUTES = 30;

/**
 * Cleanup job - removes sessions disconnected longer than 30 minutes.
 * Runs once every hour.
 */
class CleanupJob {
  constructor() {
    this.interval = null;
    this.isRunning = false;
  }

  /**
   * Start cleanup job
   * @param {number} intervalMs
   */
  start(intervalMs = ONE_HOUR_MS) {
    if (this.isRunning) return;

    this.isRunning = true;
    this.interval = setInterval(() => this.run(), intervalMs);

    // Run once shortly after startup
    setTimeout(() => this.run(), 15000);

    logger.info('Cleanup job started', { intervalMs, staleMinutes: STALE_MINUTES });
  }

  /**
   * Stop cleanup job
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    logger.info('Cleanup job stopped');
  }

  /**
   * Delete sessions that stayed disconnected for 30+ minutes
   */
  async run() {
    try {
      const staleSessions = await SessionModel.findStaleDisconnected(STALE_MINUTES);

      if (!staleSessions.length) {
        logger.debug('Cleanup job: no stale sessions found');
        return;
      }

      logger.info('Cleanup job found stale sessions', { count: staleSessions.length });

      for (const session of staleSessions) {
        const sessionId = session.session_id;
        const memory = sessionManager.sessions.get(sessionId);

        // Never delete a session that is currently connected/connecting
        if (memory && ['connected', 'connecting'].includes(memory.status)) {
          continue;
        }

        try {
          logger.info('Cleaning up stale disconnected session', {
            sessionId,
            status: session.status,
            phone: session.phone,
            disconnectedAt: session.disconnected_at,
            updatedAt: session.updated_at,
          });

          if (memory) {
            await sessionManager.destroySession(sessionId);
          } else {
            // Not in memory — still wipe DB + storage
            await sessionManager.clearSessionAuth(sessionId);
            sessionManager.deleteQrImage(sessionId);
            await SessionModel.delete(sessionId);
          }
        } catch (error) {
          logger.error('Failed to cleanup stale session', {
            sessionId,
            error: error.message,
          });
        }
      }
    } catch (error) {
      logger.error('Cleanup job failed', { error: error.message });
    }
  }
}

const cleanupJob = new CleanupJob();
export default cleanupJob;
