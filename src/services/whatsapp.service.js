import sessionManager from './session.manager.js';

/**
 * WhatsApp message service
 */
class WhatsAppService {
  /**
   * Send text message
   * @param {object} data
   * @returns {Promise<object>}
   */
  async sendText({ sessionId, number, message }) {
    const result = await sessionManager.sendText(sessionId, number, message);
    return this.formatSendResult(result);
  }

  /**
   * Send image message
   * @param {object} data
   * @returns {Promise<object>}
   */
  async sendImage({ sessionId, number, url, caption }) {
    const result = await sessionManager.sendImage(sessionId, number, { url, caption });
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
    return this.formatSendResult(result);
  }

  /**
   * Send audio message
   * @param {object} data
   * @returns {Promise<object>}
   */
  async sendAudio({ sessionId, number, url, ptt, mimetype }) {
    const result = await sessionManager.sendAudio(sessionId, number, { url, ptt, mimetype });
    return this.formatSendResult(result);
  }

  /**
   * Send video message
   * @param {object} data
   * @returns {Promise<object>}
   */
  async sendVideo({ sessionId, number, url, caption }) {
    const result = await sessionManager.sendVideo(sessionId, number, { url, caption });
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
    return this.formatSendResult(result);
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
