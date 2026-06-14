import { MessageLogModel } from '../database/models/messageLog.model.js';
import { fromJid } from '../utils/helpers.js';
import logger from '../utils/logger.js';

import sessionManager from './session.manager.js';

/**
 * WhatsApp message service
 */
class WhatsAppService {
  /**
   * Send text message and log it
   * @param {object} data
   * @returns {Promise<object>}
   */
  async sendText({ sessionId, number, message }) {
    const result = await sessionManager.sendText(sessionId, number, message);
    await this.logOutgoingMessage(sessionId, number, 'text', message, result);
    return this.formatSendResult(result);
  }

  /**
   * Send image message
   * @param {object} data
   * @returns {Promise<object>}
   */
  async sendImage({ sessionId, number, url, caption }) {
    const result = await sessionManager.sendImage(sessionId, number, { url, caption });
    await this.logOutgoingMessage(sessionId, number, 'image', caption || url, result);
    return this.formatSendResult(result);
  }

  /**
   * Send document message
   * @param {object} data
   * @returns {Promise<object>}
   */
  async sendDocument({ sessionId, number, url, fileName, mimetype, caption }) {
    const result = await sessionManager.sendDocument(sessionId, number, {
      url,
      fileName,
      mimetype,
      caption,
    });
    await this.logOutgoingMessage(
      sessionId,
      number,
      'document',
      fileName || caption || url,
      result,
    );
    return this.formatSendResult(result);
  }

  /**
   * Send audio message
   * @param {object} data
   * @returns {Promise<object>}
   */
  async sendAudio({ sessionId, number, url, ptt, mimetype }) {
    const result = await sessionManager.sendAudio(sessionId, number, { url, ptt, mimetype });
    await this.logOutgoingMessage(sessionId, number, 'audio', url, result);
    return this.formatSendResult(result);
  }

  /**
   * Send video message
   * @param {object} data
   * @returns {Promise<object>}
   */
  async sendVideo({ sessionId, number, url, caption }) {
    const result = await sessionManager.sendVideo(sessionId, number, { url, caption });
    await this.logOutgoingMessage(sessionId, number, 'video', caption || url, result);
    return this.formatSendResult(result);
  }

  /**
   * Send location message
   * @param {object} data
   * @returns {Promise<object>}
   */
  async sendLocation({ sessionId, number, latitude, longitude, name, address }) {
    const result = await sessionManager.sendLocation(sessionId, number, {
      latitude,
      longitude,
      name,
      address,
    });
    const text = `Location: ${latitude}, ${longitude}`;
    await this.logOutgoingMessage(sessionId, number, 'location', text, result);
    return this.formatSendResult(result);
  }

  /**
   * Log outgoing message to database
   * @param {string} sessionId
   * @param {string} number
   * @param {string} messageType
   * @param {string} messageText
   * @param {object} result
   */
  async logOutgoingMessage(sessionId, number, messageType, messageText, result) {
    try {
      const instance = sessionManager.sessions.get(sessionId);
      const sender = instance?.socket?.user?.id
        ? fromJid(instance.socket.user.id)
        : sessionId;

      await MessageLogModel.create({
        sessionId,
        messageId: result?.key?.id || `out_${Date.now()}`,
        direction: 'OUT',
        sender,
        receiver: number,
        messageType,
        messageText,
      });
    } catch (error) {
      logger.error('Failed to log outgoing message', {
        sessionId,
        error: error.message,
      });
    }
  }

  /**
   * Format send result for API response
   * @param {object} result
   * @returns {object}
   */
  formatSendResult(result) {
    return {
      messageId: result?.key?.id,
      remoteJid: result?.key?.remoteJid,
      status: result?.status,
      timestamp: result?.messageTimestamp,
    };
  }
}

const whatsappService = new WhatsAppService();
export default whatsappService;
