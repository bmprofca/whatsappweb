import { execute, query } from './base.model.js';

/**
 * Message log repository
 */
export const MessageLogModel = {
  /**
   * Create message log entry
   * @param {object} data
   * @returns {Promise<void>}
   */
  async create({
    sessionId,
    messageId,
    direction,
    sender,
    receiver,
    messageType,
    messageText,
  }) {
    await execute(
      `INSERT INTO message_logs
       (session_id, message_id, direction, sender, receiver, message_type, message_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [sessionId, messageId, direction, sender, receiver, messageType, messageText],
    );
  },

  /**
   * Get message logs for session
   * @param {string} sessionId
   * @param {number} limit
   * @returns {Promise<object[]>}
   */
  async findBySessionId(sessionId, limit = 50) {
    return query(
      'SELECT * FROM message_logs WHERE session_id = ? ORDER BY created_at DESC LIMIT ?',
      [sessionId, limit],
    );
  },
};
