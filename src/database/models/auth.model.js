import { execute, queryOne } from './base.model.js';

/**
 * WhatsApp auth state repository
 */
export const AuthModel = {
  /**
   * Save auth data for session
   * @param {string} sessionId
   * @param {string} authData
   * @returns {Promise<void>}
   */
  async upsert(sessionId, authData) {
    const existing = await queryOne(
      'SELECT id FROM whatsapp_auth WHERE session_id = ?',
      [sessionId],
    );

    if (existing) {
      await execute(
        'UPDATE whatsapp_auth SET auth_data = ?, updated_at = NOW() WHERE session_id = ?',
        [authData, sessionId],
      );
    } else {
      await execute(
        'INSERT INTO whatsapp_auth (session_id, auth_data, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
        [sessionId, authData],
      );
    }
  },

  /**
   * Get auth data for session
   * @param {string} sessionId
   * @returns {Promise<string | null>}
   */
  async findBySessionId(sessionId) {
    const row = await queryOne('SELECT auth_data FROM whatsapp_auth WHERE session_id = ?', [
      sessionId,
    ]);
    return row?.auth_data || null;
  },

  /**
   * Get auth data and last update time for session
   * @param {string} sessionId
   * @returns {Promise<{ auth_data: string, updated_at: string } | null>}
   */
  async findMetaBySessionId(sessionId) {
    return queryOne('SELECT auth_data, updated_at FROM whatsapp_auth WHERE session_id = ?', [
      sessionId,
    ]);
  },

  /**
   * Delete auth data
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async delete(sessionId) {
    await execute('DELETE FROM whatsapp_auth WHERE session_id = ?', [sessionId]);
  },
};
