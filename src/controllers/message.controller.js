import whatsappService from '../services/whatsapp.service.js';
import { success } from '../utils/response.js';

/**
 * Send text message
 */
export async function sendText(req, res) {
  const result = await whatsappService.sendText(req.body);
  return success(res, 'Message sent', result);
}

/**
 * Send image message
 */
export async function sendImage(req, res) {
  const result = await whatsappService.sendImage(req.body);
  return success(res, 'Image sent', result);
}

/**
 * Send document message
 */
export async function sendDocument(req, res) {
  const result = await whatsappService.sendDocument(req.body);
  return success(res, 'Document sent', result);
}

/**
 * Send audio message
 */
export async function sendAudio(req, res) {
  const result = await whatsappService.sendAudio(req.body);
  return success(res, 'Audio sent', result);
}

/**
 * Send video message
 */
export async function sendVideo(req, res) {
  const result = await whatsappService.sendVideo(req.body);
  return success(res, 'Video sent', result);
}

/**
 * Send location message
 */
export async function sendLocation(req, res) {
  const result = await whatsappService.sendLocation(req.body);
  return success(res, 'Location sent', result);
}
