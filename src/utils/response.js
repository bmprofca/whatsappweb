/**
 * Send standardized JSON response
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {boolean} success
 * @param {string} message
 * @param {object} [data]
 */
export function sendResponse(res, statusCode, success, message, data = null) {
  const response = { success, message };
  if (data !== null && data !== undefined) {
    response.data = data;
  }
  return res.status(statusCode).json(response);
}

/**
 * Send success response
 * @param {import('express').Response} res
 * @param {string} message
 * @param {object} [data]
 * @param {number} [statusCode]
 */
export function success(res, message, data = null, statusCode = 200) {
  return sendResponse(res, statusCode, true, message, data);
}

/**
 * Send error response
 * @param {import('express').Response} res
 * @param {string} message
 * @param {number} [statusCode]
 * @param {object} [details]
 */
export function error(res, message, statusCode = 500, details = null) {
  const response = { success: false, message };
  if (details) response.details = details;
  return res.status(statusCode).json(response);
}
