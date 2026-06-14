import { Router } from 'express';

import {
  createSession,
  deleteSession,
  getMessageLogs,
  getQR,
  getSession,
  getSessions,
  requestPairingCode,
  updateWebhook,
} from '../controllers/session.controller.js';
import { asyncHandler } from '../middlewares/errorHandler.js';
import validate from '../middlewares/validate.js';
import {
  createSessionSchema,
  pairingCodeSchema,
  sessionIdParamSchema,
} from '../validators/session.validator.js';
import { webhookUrlSchema } from '../validators/message.validator.js';

const router = Router();

/**
 * POST /api/sessions/create
 * Headers: X-API-Key, Content-Type: application/json
 * Body:
 * {
 *   "sessionId": "session1",           // required, alphanumeric, 3-100 chars
 *   "webhookUrl": "https://...",       // optional, valid URL
 *   "pairingCodeEnabled": false        // optional, default false
 * }
 * Response 201: { success, message, data: { sessionId, status, webhookUrl, pairingCodeEnabled } }
 */
router.post('/create', validate(createSessionSchema), asyncHandler(createSession));

/**
 * GET /api/sessions
 * Headers: X-API-Key
 * Body: none
 * Response 200: { success, message, data: { sessions: [...], stats: { total, connected, ... } } }
 */
router.get('/', asyncHandler(getSessions));

/**
 * GET /api/sessions/:id
 * Headers: X-API-Key
 * Params: id — sessionId (alphanumeric, 3-100 chars)
 * Body: none
 * Response 200: { success, message, data: { sessionId, phone, displayName, status, ... } }
 */
router.get('/:id', validate(sessionIdParamSchema, 'params'), asyncHandler(getSession));

/**
 * GET /api/sessions/:id/qr
 * Headers: X-API-Key
 * Params: id — sessionId (alphanumeric, 3-100 chars)
 * Body: none
 * Response 200: { success, message, data: { sessionId, qr } }  // qr is base64 data URL
 * Response 503: QR could not be generated — delete session and create again
 */
router.get('/:id/qr', validate(sessionIdParamSchema, 'params'), asyncHandler(getQR));

/**
 * POST /api/sessions/:id/pairing-code
 * Headers: X-API-Key, Content-Type: application/json
 * Params: id — sessionId (alphanumeric, 3-100 chars)
 * Body:
 * {
 *   "phone": "919999999999"   // required, 10-15 digits, country code included, no + or symbols
 * }
 * Response 200: { success, message, data: { sessionId, pairingCode, phone } }
 */
router.post(
  '/:id/pairing-code',
  validate(sessionIdParamSchema, 'params'),
  validate(pairingCodeSchema),
  asyncHandler(requestPairingCode),
);

/**
 * PUT /api/sessions/:id/webhook
 * Headers: X-API-Key, Content-Type: application/json
 * Params: id — sessionId (alphanumeric, 3-100 chars)
 * Body:
 * {
 *   "webhookUrl": "https://your-app.com/webhook"   // required, valid URL
 * }
 * Response 200: { success, message, data: { sessionId, webhookUrl } }
 */
router.put(
  '/:id/webhook',
  validate(sessionIdParamSchema, 'params'),
  validate(webhookUrlSchema),
  asyncHandler(updateWebhook),
);

/**
 * GET /api/sessions/:id/messages
 * Headers: X-API-Key
 * Params: id — sessionId (alphanumeric, 3-100 chars)
 * Query: limit — optional, default 50
 * Body: none
 * Response 200: { success, message, data: { logs: [...] } }
 */
router.get(
  '/:id/messages',
  validate(sessionIdParamSchema, 'params'),
  asyncHandler(getMessageLogs),
);

/**
 * DELETE /api/sessions/:id
 * Headers: X-API-Key
 * Params: id — sessionId (alphanumeric, 3-100 chars)
 * Body: none
 * Response 200: { success, message: "Session deleted successfully" }
 */
router.delete('/:id', validate(sessionIdParamSchema, 'params'), asyncHandler(deleteSession));

export default router;
