import { execute, query } from './base.model.js';

/**
 * Webhook log repository
 */
export const WebhookLogModel = {
  /**
   * Create webhook log entry
   * @param {object} data
   * @returns {Promise<void>}
   */
  async create({
    sessionId,
    event,
    webhookUrl,
    payload,
    status,
    responseCode = null,
    responseBody = null,
    attempts = 1,
    errorMessage = null,
  }) {
    await execute(
      `INSERT INTO webhook_logs
       (session_id, event, webhook_url, payload, status, response_code, response_body, attempts, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        sessionId,
        event,
        webhookUrl,
        JSON.stringify(payload),
        status,
        responseCode,
        responseBody ? JSON.stringify(responseBody).slice(0, 5000) : null,
        attempts,
        errorMessage,
      ],
    );
  },

  /**
   * Get webhook logs for session
   * @param {string} sessionId
   * @param {number} limit
   * @returns {Promise<object[]>}
   */
  async findBySessionId(sessionId, limit = 50) {
    return query(
      'SELECT * FROM webhook_logs WHERE session_id = ? ORDER BY created_at DESC LIMIT ?',
      [sessionId, limit],
    );
  },
};
