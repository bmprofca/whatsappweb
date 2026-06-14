import { AppError } from '../utils/errors.js';

/**
 * Joi validation middleware factory
 * @param {import('joi').ObjectSchema} schema
 * @param {'body' | 'query' | 'params'} source
 * @returns {import('express').RequestHandler}
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      return next(new AppError('Validation failed', 400, details));
    }

    req[source] = value;
    return next();
  };
}

export default validate;
