import env from '../config/env.js';
import { AppError } from '../utils/errors.js';

/**
 * API Key authentication middleware
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;

  if (!env.apiKey) {
    return next();
  }

  if (!apiKey || apiKey !== env.apiKey) {
    return next(new AppError('Invalid or missing API key', 401));
  }

  return next();
}

export default apiKeyAuth;
