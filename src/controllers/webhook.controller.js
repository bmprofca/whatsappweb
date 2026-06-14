import sessionService from '../services/session.service.js';
import { success } from '../utils/response.js';

/**
 * Get webhook logs for session
 */
export async function getWebhookLogs(req, res) {
  const limit = parseInt(req.query.limit || '50', 10);
  const logs = await sessionService.getWebhookLogs(req.params.id, limit);
  return success(res, 'Webhook logs retrieved', { logs });
}

/**
 * Update webhook URL for session
 */
export async function updateWebhook(req, res) {
  const data = await sessionService.updateWebhook(req.params.id, req.body.webhookUrl);
  return success(res, 'Webhook URL updated', data);
}
