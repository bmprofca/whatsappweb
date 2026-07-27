/**
 * In-memory message store used by Baileys getMessage for encryption retries.
 */
export class MessageStore {
  /**
   * @param {number} [maxSize]
   */
  constructor(maxSize = 1000) {
    /** @type {Map<string, object>} */
    this.messages = new Map();
    this.maxSize = maxSize;
  }

  /**
   * @param {object} key
   * @returns {string}
   */
  static key({ remoteJid, id, participant }) {
    return `${remoteJid || ''}:${participant || ''}:${id || ''}`;
  }

  /**
   * @param {string} jid
   * @returns {string}
   */
  static jidUser(jid) {
    if (!jid) return '';
    return jid.split('@')[0].split(':')[0];
  }

  /**
   * @param {object} waMessage
   */
  save(waMessage) {
    if (!waMessage?.key?.id || !waMessage?.key?.remoteJid) return;

    const storeKey = MessageStore.key(waMessage.key);
    this.messages.set(storeKey, waMessage);

    if (this.messages.size > this.maxSize) {
      const oldestKey = this.messages.keys().next().value;
      this.messages.delete(oldestKey);
    }
  }

  /**
   * @param {object} messageKey
   * @returns {object | undefined}
   */
  get(messageKey) {
    if (!messageKey?.id) return undefined;

    const storeKey = MessageStore.key(messageKey);
    const stored = this.messages.get(storeKey);
    if (stored?.message) return stored.message;

    if (messageKey.participant) {
      const altKey = MessageStore.key({ ...messageKey, participant: undefined });
      const altStored = this.messages.get(altKey);
      if (altStored?.message) return altStored.message;
    }

    const targetUser = MessageStore.jidUser(messageKey.remoteJid);

    for (const waMessage of this.messages.values()) {
      if (waMessage.key?.id !== messageKey.id) continue;

      if (!messageKey.remoteJid || waMessage.key.remoteJid === messageKey.remoteJid) {
        return waMessage.message;
      }

      if (targetUser && MessageStore.jidUser(waMessage.key.remoteJid) === targetUser) {
        return waMessage.message;
      }
    }

    return undefined;
  }
}
