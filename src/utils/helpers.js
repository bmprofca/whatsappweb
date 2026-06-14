/**
 * Format phone number to WhatsApp JID
 * @param {string} number
 * @returns {string}
 */
export function toJid(number) {
  const cleaned = String(number).replace(/\D/g, '');
  return `${cleaned}@s.whatsapp.net`;
}

/**
 * Extract phone number from JID
 * @param {string} jid
 * @returns {string}
 */
export function fromJid(jid) {
  if (!jid) return '';
  return jid.split('@')[0].split(':')[0];
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get memory usage formatted
 * @returns {object}
 */
export function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
    heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
    external: `${Math.round(usage.external / 1024 / 1024)}MB`,
  };
}

/**
 * Format uptime
 * @param {number} seconds
 * @returns {string}
 */
export function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}

/**
 * Parse message content from Baileys message object
 * @param {object} message
 * @returns {{ type: string, text: string }}
 */
export function parseMessageContent(message) {
  if (!message) return { type: 'unknown', text: '' };

  const msg = message.message || message;

  if (msg.conversation) return { type: 'text', text: msg.conversation };
  if (msg.extendedTextMessage)
    return { type: 'text', text: msg.extendedTextMessage.text || '' };
  if (msg.imageMessage)
    return { type: 'image', text: msg.imageMessage.caption || '[Image]' };
  if (msg.videoMessage)
    return { type: 'video', text: msg.videoMessage.caption || '[Video]' };
  if (msg.audioMessage) return { type: 'audio', text: '[Audio]' };
  if (msg.documentMessage)
    return {
      type: 'document',
      text: msg.documentMessage.fileName || msg.documentMessage.caption || '[Document]',
    };
  if (msg.stickerMessage) return { type: 'sticker', text: '[Sticker]' };
  if (msg.contactMessage)
    return { type: 'contact', text: msg.contactMessage.displayName || '[Contact]' };
  if (msg.locationMessage) {
    const lat = msg.locationMessage.degreesLatitude;
    const lng = msg.locationMessage.degreesLongitude;
    return { type: 'location', text: `Location: ${lat}, ${lng}` };
  }
  if (msg.contactsArrayMessage)
    return { type: 'contact', text: '[Contacts]' };
  if (msg.buttonsResponseMessage)
    return { type: 'text', text: msg.buttonsResponseMessage.selectedDisplayText || '' };
  if (msg.listResponseMessage)
    return { type: 'text', text: msg.listResponseMessage.title || '' };

  return { type: 'unknown', text: JSON.stringify(msg).slice(0, 500) };
}

/**
 * Check if message is from me
 * @param {object} msg
 * @returns {boolean}
 */
export function isFromMe(msg) {
  return msg.key?.fromMe === true;
}
