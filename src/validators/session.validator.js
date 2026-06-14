import Joi from 'joi';

export const createSessionSchema = Joi.object({
  sessionId: Joi.string()
    .alphanum()
    .min(3)
    .max(100)
    .required()
    .messages({
      'string.alphanum': 'sessionId must contain only alphanumeric characters',
    }),
  webhookUrl: Joi.string().uri().optional().allow(null, ''),
  pairingCodeEnabled: Joi.boolean().optional().default(false),
});

export const pairingCodeSchema = Joi.object({
  phone: Joi.string()
    .pattern(/^\d{10,15}$/)
    .required()
    .messages({
      'string.pattern.base': 'phone must be 10-15 digits without + or symbols',
    }),
});

export const sessionIdParamSchema = Joi.object({
  id: Joi.string().alphanum().min(3).max(100).required(),
});
