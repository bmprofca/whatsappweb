import { execute, query, queryOne } from './base.model.js';

/** @typedef {'disconnected' | 'connecting' | 'qr' | 'pairing' | 'connected' | 'destroyed'} SessionStatus */

/**
 * WhatsApp session repository
 */
export const SessionModel = {
  /**
   * Create a new session record
   * @param {object} data
   * @returns {Promise<object>}
   */
  async create({ sessionId, webhookUrl = null, pairingCodeEnabled = 0 }) {
    await execute(
      `INSERT INTO whatsapp_sessions (session_id, status, webhook_url, pairing_code_enabled, created_at, updated_at)
       VALUES (?, 'disconnected', ?, ?, NOW(), NOW())`,
      [sessionId, webhookUrl, pairingCodeEnabled ? 1 : 0],
    );
    return this.findBySessionId(sessionId);
  },

  /**
   * Find session by session_id
   * @param {string} sessionId
   * @returns {Promise<object | null>}
   */
  async findBySessionId(sessionId) {
    return queryOne('SELECT * FROM whatsapp_sessions WHERE session_id = ?', [sessionId]);
  },

  /**
   * Get all sessions
   * @returns {Promise<object[]>}
   */
  async findAll() {
    return query('SELECT * FROM whatsapp_sessions ORDER BY created_at DESC');
  },

  /**
   * Get sessions that should be restored on startup
   * @returns {Promise<object[]>}
   */
  async findRestorable() {
    return query(
      `SELECT * FROM whatsapp_sessions
       WHERE status IN ('connected', 'connecting', 'disconnected', 'qr', 'pairing')
       ORDER BY created_at ASC`,
    );
  },

  /**
   * Update session status
   * @param {string} sessionId
   * @param {SessionStatus} status
   * @param {object} [extra]
   * @returns {Promise<void>}
   */
  async updateStatus(sessionId, status, extra = {}) {
    const fields = ['status = ?', 'updated_at = NOW()'];
    const params = [status];

    if (extra.phone !== undefined) {
      fields.push('phone = ?');
      params.push(extra.phone);
    }
    if (extra.displayName !== undefined) {
      fields.push('display_name = ?');
      params.push(extra.displayName);
    }
    if (extra.webhookUrl !== undefined) {
      fields.push('webhook_url = ?');
      params.push(extra.webhookUrl);
    }

    params.push(sessionId);
    await execute(
      `UPDATE whatsapp_sessions SET ${fields.join(', ')} WHERE session_id = ?`,
      params,
    );
  },

  /**
   * Delete session
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async delete(sessionId) {
    await execute('DELETE FROM whatsapp_sessions WHERE session_id = ?', [sessionId]);
  },
};
