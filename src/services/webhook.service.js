import axios from 'axios';

import env from '../config/env.js';
import { WebhookLogModel } from '../database/models/webhookLog.model.js';
import { sleep } from '../utils/helpers.js';
import logger from '../utils/logger.js';

/**
 * Webhook delivery service with retry logic
 */
class WebhookService {
  /**
   * Send webhook with retries
   * @param {string} webhookUrl
   * @param {string} event
   * @param {object} payload
   * @param {string} [sessionId]
   * @returns {Promise<boolean>}
   */
  async send(webhookUrl, event, payload, sessionId = payload?.sessionId) {
    const body = {
      event,
      timestamp: new Date().toISOString(),
      data: payload,
    };

    let lastError = null;
    const maxRetries = env.webhook.maxRetries;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.post(webhookUrl, body, {
          timeout: 15000,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'WhatsApp-Multi-Session-Server/1.0',
            'X-Webhook-Event': event,
          },
          validateStatus: (status) => status >= 200 && status < 300,
        });

        await WebhookLogModel.create({
          sessionId: sessionId || 'unknown',
          event,
          webhookUrl,
          payload: body,
          status: 'success',
          responseCode: response.status,
          responseBody: response.data,
          attempts: attempt,
        });

        logger.info('Webhook delivered', { sessionId, event, attempt });
        return true;
      } catch (error) {
        lastError = error;
        const statusCode = error.response?.status || null;

        logger.warn('Webhook delivery failed', {
          sessionId,
          event,
          attempt,
          error: error.message,
          statusCode,
        });

        if (attempt < maxRetries) {
          await sleep(env.webhook.retryDelayMs * attempt);
        }
      }
    }

    await WebhookLogModel.create({
      sessionId: sessionId || 'unknown',
      event,
      webhookUrl,
      payload: body,
      status: 'failed',
      responseCode: lastError?.response?.status || null,
      responseBody: lastError?.response?.data || null,
      attempts: maxRetries,
      errorMessage: lastError?.message || 'Unknown error',
    });

    return false;
  }
}

const webhookService = new WebhookService();
export default webhookService;
