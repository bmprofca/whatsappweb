import Joi from 'joi';

const phoneSchema = Joi.string()
  .pattern(/^\d{10,15}$/)
  .required()
  .messages({
    'string.pattern.base': 'number must be 10-15 digits without + or symbols',
  });

export const sendTextSchema = Joi.object({
  sessionId: Joi.string().alphanum().min(3).max(100).required(),
  number: phoneSchema,
  message: Joi.string().min(1).max(4096).required(),
});

export const sendImageSchema = Joi.object({
  sessionId: Joi.string().alphanum().min(3).max(100).required(),
  number: phoneSchema,
  url: Joi.string().uri().required(),
  caption: Joi.string().max(1024).optional().allow(''),
});

export const sendDocumentSchema = Joi.object({
  sessionId: Joi.string().alphanum().min(3).max(100).required(),
  number: phoneSchema,
  url: Joi.string().uri().required(),
  fileName: Joi.string().max(255).optional(),
  mimetype: Joi.string().max(100).optional(),
  caption: Joi.string().max(1024).optional().allow(''),
});

export const sendAudioSchema = Joi.object({
  sessionId: Joi.string().alphanum().min(3).max(100).required(),
  number: phoneSchema,
  url: Joi.string().uri().required(),
  ptt: Joi.boolean().optional().default(false),
  mimetype: Joi.string().max(100).optional().default('audio/mpeg'),
});

export const sendVideoSchema = Joi.object({
  sessionId: Joi.string().alphanum().min(3).max(100).required(),
  number: phoneSchema,
  url: Joi.string().uri().required(),
  caption: Joi.string().max(1024).optional().allow(''),
});

export const sendLocationSchema = Joi.object({
  sessionId: Joi.string().alphanum().min(3).max(100).required(),
  number: phoneSchema,
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  name: Joi.string().max(255).optional().allow(''),
  address: Joi.string().max(500).optional().allow(''),
});

export const webhookUrlSchema = Joi.object({
  webhookUrl: Joi.string().uri().required(),
});
