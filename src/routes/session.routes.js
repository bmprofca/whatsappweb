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

router.post('/create', validate(createSessionSchema), asyncHandler(createSession));
router.get('/', asyncHandler(getSessions));
router.get('/:id', validate(sessionIdParamSchema, 'params'), asyncHandler(getSession));
router.get('/:id/qr', validate(sessionIdParamSchema, 'params'), asyncHandler(getQR));
router.post(
  '/:id/pairing-code',
  validate(sessionIdParamSchema, 'params'),
  validate(pairingCodeSchema),
  asyncHandler(requestPairingCode),
);
router.put(
  '/:id/webhook',
  validate(sessionIdParamSchema, 'params'),
  validate(webhookUrlSchema),
  asyncHandler(updateWebhook),
);
router.get(
  '/:id/messages',
  validate(sessionIdParamSchema, 'params'),
  asyncHandler(getMessageLogs),
);
router.delete('/:id', validate(sessionIdParamSchema, 'params'), asyncHandler(deleteSession));

export default router;
