import { SessionModel } from '../database/models/session.model.js';
import { MessageLogModel } from '../database/models/messageLog.model.js';
import { WebhookLogModel } from '../database/models/webhookLog.model.js';
import { AppError } from '../utils/errors.js';

import sessionManager from './session.manager.js';

/**
 * Session business logic service
 */
class SessionService {
  /**
   * Create a new session
   * @param {object} data
   * @returns {Promise<object>}
   */
  async create({ sessionId, webhookUrl, pairingCodeEnabled }) {
    const existing = await SessionModel.findBySessionId(sessionId);
    if (existing) {
      throw new AppError('Session already exists', 409);
    }

    const instance = await sessionManager.createSession(sessionId, {
      webhookUrl,
      pairingCodeEnabled,
    });

    return {
      sessionId,
      status: instance.status,
      webhookUrl: webhookUrl || null,
      pairingCodeEnabled: !!pairingCodeEnabled,
    };
  }

  /**
   * Get all sessions
   * @returns {Promise<object[]>}
   */
  async getAll() {
    const dbSessions = await SessionModel.findAll();
    const memorySessions = sessionManager.getAllSessions();
    const memoryMap = new Map(memorySessions.map((s) => [s.sessionId, s]));

    return dbSessions.map((db) => {
      const mem = memoryMap.get(db.session_id);
      return {
        sessionId: db.session_id,
        phone: db.phone,
        displayName: db.display_name,
        status: mem?.status || db.status,
        webhookUrl: db.webhook_url,
        pairingCodeEnabled: !!db.pairing_code_enabled,
        reconnectAttempts: mem?.reconnectAttempts || 0,
        createdAt: db.created_at,
        updatedAt: db.updated_at,
      };
    });
  }

  /**
   * Get session by ID
   * @param {string} sessionId
   * @returns {Promise<object>}
   */
  async getById(sessionId) {
    const db = await SessionModel.findBySessionId(sessionId);
    if (!db) throw new AppError('Session not found', 404);

    const mem = sessionManager.getAllSessions().find((s) => s.sessionId === sessionId);

    return {
      sessionId: db.session_id,
      phone: db.phone,
      displayName: db.display_name,
      status: mem?.status || db.status,
      webhookUrl: db.webhook_url,
      pairingCodeEnabled: !!db.pairing_code_enabled,
      reconnectAttempts: mem?.reconnectAttempts || 0,
      createdAt: db.created_at,
      updatedAt: db.updated_at,
    };
  }

  /**
   * Get QR code for session
   * @param {string} sessionId
   * @returns {Promise<object>}
   */
  async getQR(sessionId) {
    const db = await SessionModel.findBySessionId(sessionId);
    if (!db) throw new AppError('Session not found', 404);

    const qr = await sessionManager.getQR(sessionId);
    if (!qr) {
      throw new AppError('QR code not available yet. Please wait and try again.', 202);
    }

    return { sessionId, qr };
  }

  /**
   * Request pairing code
   * @param {string} sessionId
   * @param {string} phone
   * @returns {Promise<object>}
   */
  async requestPairingCode(sessionId, phone) {
    const db = await SessionModel.findBySessionId(sessionId);
    if (!db) throw new AppError('Session not found', 404);

    const code = await sessionManager.requestPairingCode(sessionId, phone);
    return { sessionId, pairingCode: code, phone };
  }

  /**
   * Delete session
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async delete(sessionId) {
    const db = await SessionModel.findBySessionId(sessionId);
    if (!db) throw new AppError('Session not found', 404);

    await sessionManager.destroySession(sessionId);
  }

  /**
   * Update webhook URL
   * @param {string} sessionId
   * @param {string} webhookUrl
   * @returns {Promise<object>}
   */
  async updateWebhook(sessionId, webhookUrl) {
    const db = await SessionModel.findBySessionId(sessionId);
    if (!db) throw new AppError('Session not found', 404);

    await SessionModel.updateStatus(sessionId, db.status, { webhookUrl });
    return { sessionId, webhookUrl };
  }

  /**
   * Get session message logs
   * @param {string} sessionId
   * @param {number} limit
   * @returns {Promise<object[]>}
   */
  async getMessageLogs(sessionId, limit = 50) {
    const db = await SessionModel.findBySessionId(sessionId);
    if (!db) throw new AppError('Session not found', 404);

    return MessageLogModel.findBySessionId(sessionId, limit);
  }

  /**
   * Get session webhook logs
   * @param {string} sessionId
   * @param {number} limit
   * @returns {Promise<object[]>}
   */
  async getWebhookLogs(sessionId, limit = 50) {
    const db = await SessionModel.findBySessionId(sessionId);
    if (!db) throw new AppError('Session not found', 404);

    return WebhookLogModel.findBySessionId(sessionId, limit);
  }

  /**
   * Get session statistics
   * @returns {object}
   */
  getStats() {
    return sessionManager.getStats();
  }
}

const sessionService = new SessionService();
export default sessionService;
