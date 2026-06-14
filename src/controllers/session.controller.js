import sessionService from '../services/session.service.js';
import { success } from '../utils/response.js';

/**
 * Create a new WhatsApp session
 */
export async function createSession(req, res) {
  const data = await sessionService.create(req.body);
  return success(res, 'Session created successfully', data, 201);
}

/**
 * Get all sessions
 */
export async function getSessions(req, res) {
  const sessions = await sessionService.getAll();
  return success(res, 'Sessions retrieved', { sessions, stats: sessionService.getStats() });
}

/**
 * Get session by ID
 */
export async function getSession(req, res) {
  const data = await sessionService.getById(req.params.id);
  return success(res, 'Session retrieved', data);
}

/**
 * Get QR code for session
 */
export async function getQR(req, res) {
  const data = await sessionService.getQR(req.params.id);
  return success(res, 'QR code retrieved', data);
}

/**
 * Request pairing code
 */
export async function requestPairingCode(req, res) {
  const data = await sessionService.requestPairingCode(req.params.id, req.body.phone);
  return success(res, 'Pairing code generated', data);
}

/**
 * Delete session
 */
export async function deleteSession(req, res) {
  await sessionService.delete(req.params.id);
  return success(res, 'Session deleted successfully');
}

/**
 * Update session webhook URL
 */
export async function updateWebhook(req, res) {
  const data = await sessionService.updateWebhook(req.params.id, req.body.webhookUrl);
  return success(res, 'Webhook URL updated', data);
}

/**
 * Get session message logs
 */
export async function getMessageLogs(req, res) {
  const limit = parseInt(req.query.limit || '50', 10);
  const logs = await sessionService.getMessageLogs(req.params.id, limit);
  return success(res, 'Message logs retrieved', { logs });
}
