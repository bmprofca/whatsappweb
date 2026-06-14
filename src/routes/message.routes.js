import { Router } from 'express';

import {
  sendAudio,
  sendDocument,
  sendImage,
  sendLocation,
  sendText,
  sendVideo,
} from '../controllers/message.controller.js';
import { asyncHandler } from '../middlewares/errorHandler.js';
import validate from '../middlewares/validate.js';
import {
  sendAudioSchema,
  sendDocumentSchema,
  sendImageSchema,
  sendLocationSchema,
  sendTextSchema,
  sendVideoSchema,
} from '../validators/message.validator.js';

const router = Router();

router.post('/send-text', validate(sendTextSchema), asyncHandler(sendText));
router.post('/send-image', validate(sendImageSchema), asyncHandler(sendImage));
router.post('/send-document', validate(sendDocumentSchema), asyncHandler(sendDocument));
router.post('/send-audio', validate(sendAudioSchema), asyncHandler(sendAudio));
router.post('/send-video', validate(sendVideoSchema), asyncHandler(sendVideo));
router.post('/send-location', validate(sendLocationSchema), asyncHandler(sendLocation));

export default router;
