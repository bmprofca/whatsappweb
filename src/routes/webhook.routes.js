import { Router } from 'express';

import { getWebhookLogs, updateWebhook } from '../controllers/webhook.controller.js';
import { asyncHandler } from '../middlewares/errorHandler.js';
import validate from '../middlewares/validate.js';
import { webhookUrlSchema } from '../validators/message.validator.js';
import { sessionIdParamSchema } from '../validators/session.validator.js';

const router = Router();

router.put(
  '/:id',
  validate(sessionIdParamSchema, 'params'),
  validate(webhookUrlSchema),
  asyncHandler(updateWebhook),
);
router.get(
  '/:id/logs',
  validate(sessionIdParamSchema, 'params'),
  asyncHandler(getWebhookLogs),
);

export default router;
