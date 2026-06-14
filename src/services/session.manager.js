import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import NodeCache from '@cacheable/node-cache';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';

import env from '../config/env.js';
import { AuthModel } from '../database/models/auth.model.js';
import { SessionModel } from '../database/models/session.model.js';
import { fromJid, isFromMe, parseMessageContent, sleep, toJid } from '../utils/helpers.js';
import { MessageStore } from '../utils/message-store.js';
import { wrapKeyStoreWithBackup } from '../utils/auth-store.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

import webhookService from './webhook.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, '../storage/sessions');
const QR_DIR = path.join(__dirname, '../storage/qr');

/** @type {[number, number, number] | null} */
let cachedWaVersion = null;
let versionFetchedAt = 0;
const VERSION_TTL_MS = 60 * 60 * 1000;

/** @typedef {'disconnected' | 'connecting' | 'qr' | 'pairing' | 'connected' | 'destroyed'} SessionStatus */

/**
 * @typedef {object} SessionInstance
 * @property {string} sessionId
 * @property {import('@whiskeysockets/baileys').WASocket | null} socket
 * @property {SessionStatus} status
 * @property {string | null} qr
 * @property {string | null} qrImageName
 * @property {string | null} qrImageUrl
 * @property {string | null} pairingCode
 * @property {number} reconnectAttempts
 * @property {boolean} isDestroying
 * @property {NodeJS.Timeout | null} reconnectTimer
 * @property {Function | null} saveCreds
 * @property {MessageStore} messageStore
 * @property {NodeJS.Timeout | null} authBackupTimer
 */

/**
 * Centralized WhatsApp Session Manager (Singleton)
 */
class SessionManager {
  constructor() {
    /** @type {Map<string, SessionInstance>} */
    this.sessions = new Map();
    /** @type {import('socket.io').Server | null} */
    this.io = null;
    /** @type {Set<string>} */
    this.reconnectQueue = new Set();
    /** @type {Map<string, Promise<SessionInstance>>} */
    this.connectionLocks = new Map();
    this.isRestoring = false;
  }

  /**
   * Initialize SessionManager with Socket.IO instance
   * @param {import('socket.io').Server} io
   */
  init(io) {
    this.io = io;
  }

  /**
   * Resolve WhatsApp Web version from Baileys (cached for 1 hour).
   * Avoid fetchLatestWaWebVersion — it can cause encryption incompatibilities.
   * @param {boolean} [force]
   * @returns {Promise<[number, number, number]>}
   */
  async getWaVersion(force = false) {
    const now = Date.now();
    if (!force && cachedWaVersion && now - versionFetchedAt < VERSION_TTL_MS) {
      return cachedWaVersion;
    }

    const { version } = await fetchLatestBaileysVersion();
    cachedWaVersion = version;
    versionFetchedAt = now;
    logger.info('WhatsApp Web version resolved', { version, source: 'baileys' });
    return version;
  }

  /**
   * Resolve recipient JID via WhatsApp before sending
   * @param {import('@whiskeysockets/baileys').WASocket} socket
   * @param {string} number
   * @returns {Promise<string>}
   */
  async resolveRecipientJid(socket, number) {
    const jid = toJid(number);

    try {
      const results = await socket.onWhatsApp(jid);
      const match = results?.find((entry) => entry.exists && entry.jid);
      if (match?.jid) return match.jid;
    } catch (error) {
      logger.warn('Failed to resolve WhatsApp JID, using phone JID', {
        number,
        error: error.message,
      });
    }

    return jid;
  }

  /**
   * Resolve JID and sync encryption pre-keys before sending
   * @param {import('@whiskeysockets/baileys').WASocket} socket
   * @param {string} number
   * @returns {Promise<string>}
   */
  async prepareForSend(socket, number) {
    const jid = await this.resolveRecipientJid(socket, number);
    await socket.uploadPreKeysToServerIfRequired();
    return jid;
  }

  /**
   * Get session storage path
   * @param {string} sessionId
   * @returns {string}
   */
  getSessionPath(sessionId) {
    return path.join(SESSIONS_DIR, sessionId);
  }

  /**
   * Ensure session directory exists
   * @param {string} sessionId
   */
  ensureSessionDir(sessionId) {
    const dir = this.getSessionPath(sessionId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Ensure QR images directory exists
   */
  ensureQrDir() {
    if (!fs.existsSync(QR_DIR)) {
      fs.mkdirSync(QR_DIR, { recursive: true });
    }
  }

  /**
   * Get QR image file path for session
   * @param {string} sessionId
   * @returns {string}
   */
  getQrImagePath(sessionId) {
    return path.join(QR_DIR, `${sessionId}.png`);
  }

  /**
   * Get public QR image URL for session
   * @param {string} sessionId
   * @returns {string}
   */
  getQrImageUrl(sessionId) {
    return `${env.baseUrl}/qr/${sessionId}.png`;
  }

  /**
   * Save QR code as PNG file
   * @param {string} sessionId
   * @param {string} qrString
   * @returns {Promise<{ imageName: string, imageUrl: string }>}
   */
  async saveQrImage(sessionId, qrString) {
    this.ensureQrDir();
    const imageName = `${sessionId}.png`;
    const filePath = this.getQrImagePath(sessionId);
    const imageUrl = this.getQrImageUrl(sessionId);

    await QRCode.toFile(filePath, qrString, { width: 300, margin: 2 });

    const instance = this.getOrCreateInstance(sessionId);
    instance.qrImageName = imageName;
    instance.qrImageUrl = imageUrl;
    instance.qr = imageUrl;

    return { imageName, imageUrl };
  }

  /**
   * Delete QR image file for session
   * @param {string} sessionId
   */
  deleteQrImage(sessionId) {
    const filePath = this.getQrImagePath(sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const instance = this.sessions.get(sessionId);
    if (instance) {
      instance.qr = null;
      instance.qrImageName = null;
      instance.qrImageUrl = null;
    }
  }

  /**
   * Emit Socket.IO event
   * @param {string} event
   * @param {object} data
   */
  emit(event, data) {
    if (this.io) {
      this.io.emit(event, data);
      if (data.sessionId) {
        this.io.to(`session:${data.sessionId}`).emit(event, data);
      }
    }
  }

  /**
   * Backup auth state to MySQL
   * @param {string} sessionId
   */
  async backupAuthToDb(sessionId) {
    try {
      const authDir = this.getSessionPath(sessionId);
      if (!fs.existsSync(authDir)) return;

      const files = fs.readdirSync(authDir);
      const authData = {};

      for (const file of files) {
        const filePath = path.join(authDir, file);
        if (fs.statSync(filePath).isFile()) {
          authData[file] = fs.readFileSync(filePath, 'utf8');
        }
      }

      await AuthModel.upsert(sessionId, JSON.stringify(authData));
    } catch (error) {
      logger.error('Failed to backup auth to database', {
        sessionId,
        error: error.message,
      });
    }
  }

  /**
   * Restore auth state from MySQL to filesystem
   * @param {string} sessionId
   */
  async restoreAuthFromDb(sessionId) {
    try {
      const authDataStr = await AuthModel.findBySessionId(sessionId);
      if (!authDataStr) return false;

      const authData = JSON.parse(authDataStr);
      this.ensureSessionDir(sessionId);
      const authDir = this.getSessionPath(sessionId);

      for (const [file, content] of Object.entries(authData)) {
        fs.writeFileSync(path.join(authDir, file), content);
      }

      return true;
    } catch (error) {
      logger.error('Failed to restore auth from database', {
        sessionId,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Debounce auth backup after signal key updates
   * @param {string} sessionId
   */
  scheduleAuthBackup(sessionId) {
    const instance = this.getOrCreateInstance(sessionId);
    if (instance.authBackupTimer) {
      clearTimeout(instance.authBackupTimer);
    }

    instance.authBackupTimer = setTimeout(async () => {
      instance.authBackupTimer = null;
      await this.backupAuthToDb(sessionId);
    }, 1500);
  }

  /**
   * Ensure local auth exists and is not older than database backup
   * @param {string} sessionId
   * @returns {Promise<boolean>}
   */
  async ensureAuthState(sessionId) {
    this.ensureSessionDir(sessionId);
    const authDir = this.getSessionPath(sessionId);
    const localCredsPath = path.join(authDir, 'creds.json');
    const hasLocalCreds = fs.existsSync(localCredsPath);
    const dbAuth = await AuthModel.findMetaBySessionId(sessionId);

    if (!dbAuth?.auth_data) {
      return hasLocalCreds;
    }

    if (!hasLocalCreds) {
      logger.info('Restoring auth from database', { sessionId });
      return this.restoreAuthFromDb(sessionId);
    }

    const localMtime = fs.statSync(localCredsPath).mtimeMs;
    const dbMtime = new Date(dbAuth.updated_at).getTime();

    if (dbMtime > localMtime + 1000) {
      logger.info('Database auth is newer than local files, restoring from database', {
        sessionId,
      });
      return this.restoreAuthFromDb(sessionId);
    }

    if (localMtime > dbMtime + 1000) {
      await this.backupAuthToDb(sessionId);
    }

    return true;
  }

  /**
   * Cancel pending reconnect for a session
   * @param {string} sessionId
   */
  cancelReconnect(sessionId) {
    const instance = this.getOrCreateInstance(sessionId);
    if (instance.reconnectTimer) {
      clearTimeout(instance.reconnectTimer);
      instance.reconnectTimer = null;
    }
    this.reconnectQueue.delete(sessionId);
  }

  /**
   * Check if session has auth files on disk
   * @param {string} sessionId
   * @returns {boolean}
   */
  hasAuthFiles(sessionId) {
    const authDir = this.getSessionPath(sessionId);
    if (!fs.existsSync(authDir)) return false;
    return fs.readdirSync(authDir).length > 0;
  }

  /**
   * Wait until QR is generated or timeout
   * @param {string} sessionId
   * @param {number} timeoutMs
   * @returns {Promise<string | null>}
   */
  async waitForQR(sessionId, timeoutMs = 60000) {
    const instance = this.getOrCreateInstance(sessionId);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (instance.qrImageUrl) {
        return {
          imageName: instance.qrImageName,
          imageUrl: instance.qrImageUrl,
        };
      }
      if (instance.status === 'connected') {
        throw new AppError('Session already connected. QR is not required.', 400);
      }
      await sleep(500);
    }

    return instance.qrImageUrl
      ? { imageName: instance.qrImageName, imageUrl: instance.qrImageUrl }
      : null;
  }

  /**
   * Get or create session instance metadata
   * @param {string} sessionId
   * @returns {SessionInstance}
   */
  getOrCreateInstance(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        sessionId,
        socket: null,
        status: 'disconnected',
        qr: null,
        qrImageName: null,
        qrImageUrl: null,
        pairingCode: null,
        reconnectAttempts: 0,
        isDestroying: false,
        reconnectTimer: null,
        saveCreds: null,
        messageStore: new MessageStore(),
        authBackupTimer: null,
      });
    }
    return this.sessions.get(sessionId);
  }

  /**
   * Store sent message for Baileys encryption retry handling
   * @param {SessionInstance} instance
   * @param {object} result
   */
  storeSentMessage(instance, result) {
    if (result?.key && result?.message) {
      instance.messageStore.save(result);
    }
  }

  /**
   * Create a new WhatsApp session
   * @param {string} sessionId
   * @param {object} [options]
   * @returns {Promise<SessionInstance>}
   */
  async createSession(sessionId, options = {}) {
    const existing = this.sessions.get(sessionId);
    if (existing?.socket && existing.status === 'connected') {
      throw new AppError('Session already connected', 409);
    }

    const dbSession = await SessionModel.findBySessionId(sessionId);
    if (!dbSession) {
      await SessionModel.create({
        sessionId,
        webhookUrl: options.webhookUrl || null,
        pairingCodeEnabled: options.pairingCodeEnabled ? 1 : 0,
      });
    }

    this.ensureSessionDir(sessionId);
    return this.connectSession(sessionId, { isNew: true });
  }

  /**
   * Connect or reconnect a session (with lock to prevent parallel connects)
   * @param {string} sessionId
   * @param {object} [options]
   * @returns {Promise<SessionInstance>}
   */
  async connectSession(sessionId, options = {}) {
    const existingLock = this.connectionLocks.get(sessionId);
    if (existingLock) return existingLock;

    const connectPromise = this._connectSession(sessionId, options);
    this.connectionLocks.set(sessionId, connectPromise);

    try {
      return await connectPromise;
    } finally {
      if (this.connectionLocks.get(sessionId) === connectPromise) {
        this.connectionLocks.delete(sessionId);
      }
    }
  }

  /**
   * Internal connect implementation
   * @param {string} sessionId
   * @param {object} [options]
   * @returns {Promise<SessionInstance>}
   */
  async _connectSession(sessionId, options = {}) {
    const instance = this.getOrCreateInstance(sessionId);
    instance.isDestroying = false;
    this.cancelReconnect(sessionId);

    if (options.freshAuth) {
      await this.clearSessionAuth(sessionId);
    }

    if (instance.socket) {
      try {
        instance.socket.ev.removeAllListeners('connection.update');
        instance.socket.ev.removeAllListeners('creds.update');
        instance.socket.ev.removeAllListeners('messages.upsert');
        instance.socket.end(undefined);
      } catch {
        // ignore cleanup errors
      }
      instance.socket = null;
    }

    await this.updateSessionStatus(sessionId, 'connecting');
    this.emit('session.connecting', { sessionId, status: 'connecting' });

    await this.ensureAuthState(sessionId);

    const authPath = this.getSessionPath(sessionId);
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    instance.saveCreds = saveCreds;

    const version = await this.getWaVersion(options.freshAuth);
    const baileysLogger = pino({ level: 'silent' });
    const keysWithBackup = wrapKeyStoreWithBackup(state.keys, () =>
      this.scheduleAuthBackup(sessionId),
    );
    const msgRetryCounterCache = new NodeCache({
      stdTTL: 3600,
      useClones: false,
    });

    /** @type {import('@whiskeysockets/baileys').WASocket | null} */
    let socketRef = null;

    const socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(keysWithBackup, baileysLogger),
      },
      printQRInTerminal: false,
      browser: Browsers.macOS('Chrome'),
      syncFullHistory: false,
      emitOwnEvents: true,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      qrTimeout: 60000,
      logger: baileysLogger,
      msgRetryCounterCache,
      getMessage: async (key) => instance.messageStore.get(key),
      patchMessageBeforeSending: async (msg) => {
        if (socketRef) {
          await socketRef.uploadPreKeysToServerIfRequired();
        }
        return msg;
      },
    });

    socketRef = socket;
    instance.socket = socket;
    this.setupEventHandlers(sessionId, socket, saveCreds);

    return instance;
  }

  /**
   * Setup Baileys event handlers for a session
   * @param {string} sessionId
   * @param {import('@whiskeysockets/baileys').WASocket} socket
   * @param {Function} saveCreds
   */
  setupEventHandlers(sessionId, socket, saveCreds) {
    const instance = this.getOrCreateInstance(sessionId);

    socket.ev.on('creds.update', async () => {
      await saveCreds();
      await this.backupAuthToDb(sessionId);
    });

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update;

      if (isNewLogin) {
        logger.info('Pairing successful, saving credentials', { sessionId });
        await saveCreds();
        await this.backupAuthToDb(sessionId);
      }

      if (qr) {
        try {
          const { imageName, imageUrl } = await this.saveQrImage(sessionId, qr);
          await this.updateSessionStatus(sessionId, 'qr');
          this.emit('qr.updated', { sessionId, imageName, imageUrl });
          logger.info('QR code generated', { sessionId, imageUrl });
        } catch (error) {
          logger.error('QR generation failed', { sessionId, error: error.message });
        }
      }

      if (connection === 'open') {
        this.deleteQrImage(sessionId);
        instance.pairingCode = null;
        instance.reconnectAttempts = 0;
        this.reconnectQueue.delete(sessionId);

        const phone = socket.user?.id ? fromJid(socket.user.id) : null;
        const displayName = socket.user?.name || socket.user?.verifiedName || null;

        await this.updateSessionStatus(sessionId, 'connected', { phone, displayName });
        this.emit('session.connected', {
          sessionId,
          status: 'connected',
          phone,
          displayName,
        });

        logger.info('Session connected', { sessionId, phone });

        try {
          await socket.uploadPreKeysToServerIfRequired();
          await saveCreds();
          await this.backupAuthToDb(sessionId);
        } catch (error) {
          logger.warn('Post-connect auth sync failed', {
            sessionId,
            error: error.message,
          });
        }

        const dbSession = await SessionModel.findBySessionId(sessionId);
        if (dbSession?.webhook_url) {
          await webhookService.send(dbSession.webhook_url, 'session.connected', {
            sessionId,
            phone,
            displayName,
          });
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;

        if (statusCode === DisconnectReason.connectionReplaced) {
          logger.warn(
            'Session replaced by another WhatsApp connection. Run only one server instance per session.',
            { sessionId },
          );
        }

        if (instance.isDestroying) {
          await this.updateSessionStatus(sessionId, 'destroyed');
          return;
        }

        // After QR scan, WhatsApp sends 515 — must reconnect to finish login
        if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
          logger.info('Restart required after scan, reconnecting to complete login', {
            sessionId,
            statusCode,
          });
          try {
            await saveCreds();
            await this.backupAuthToDb(sessionId);
          } catch (error) {
            logger.error('Failed to save creds before restart', {
              sessionId,
              error: error.message,
            });
          }
          await this.updateSessionStatus(sessionId, 'connecting');
          this.emit('session.connecting', { sessionId, status: 'connecting' });
          setTimeout(() => this.reconnectSession(sessionId), 1500);
          return;
        }

        const isRegistered = socket.authState?.creds?.registered === true;
        const isConnectionFailure = [405, 403, 500, DisconnectReason.badSession].includes(
          statusCode,
        );

        // Unregistered session — real failure during QR / pairing login
        if (!isRegistered) {
          this.deleteQrImage(sessionId);
          this.cancelReconnect(sessionId);

          if (isConnectionFailure || statusCode === DisconnectReason.loggedOut) {
            logger.warn('Clearing auth after failed login attempt', { sessionId, statusCode });
            await this.clearSessionAuth(sessionId);
            if (statusCode === 405) {
              cachedWaVersion = null;
              versionFetchedAt = 0;
            }
          }

          await this.updateSessionStatus(sessionId, 'disconnected');
          this.emit('session.disconnected', {
            sessionId,
            status: 'disconnected',
            reason: statusCode,
          });

          logger.warn('Session disconnected during login', { sessionId, statusCode });
          return;
        }

        const shouldReconnect =
          !instance.isDestroying &&
          statusCode !== DisconnectReason.loggedOut &&
          statusCode !== 401;

        this.deleteQrImage(sessionId);

        await this.updateSessionStatus(sessionId, 'disconnected');
        this.emit('session.disconnected', {
          sessionId,
          status: 'disconnected',
          reason: statusCode,
        });

        logger.warn('Session disconnected', { sessionId, statusCode, shouldReconnect });

        const dbSession = await SessionModel.findBySessionId(sessionId);
        if (dbSession?.webhook_url) {
          await webhookService.send(dbSession.webhook_url, 'session.disconnected', {
            sessionId,
            reason: statusCode,
          });
        }

        if (shouldReconnect) {
          this.scheduleReconnect(sessionId);
        } else if (statusCode === DisconnectReason.loggedOut) {
          logger.info('Session logged out', { sessionId });
          await this.clearSessionAuth(sessionId);
        }
      }
    });

    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const msg of messages) {
        instance.messageStore.save(msg);
      }

      if (type !== 'notify') return;

      for (const msg of messages) {
        await this.handleIncomingMessage(sessionId, socket, msg);
      }
    });
  }

  /**
   * Handle incoming WhatsApp message
   * @param {string} sessionId
   * @param {import('@whiskeysockets/baileys').WASocket} socket
   * @param {object} msg
   */
  async handleIncomingMessage(sessionId, socket, msg) {
    try {
      const fromMe = isFromMe(msg);
      const direction = fromMe ? 'OUT' : 'IN';
      const { type: messageType, text: messageText } = parseMessageContent(msg);

      const sender = fromMe
        ? fromJid(socket.user?.id)
        : fromJid(msg.key.remoteJid);
      const receiver = fromMe
        ? fromJid(msg.key.remoteJid)
        : fromJid(socket.user?.id);

      const messageId = msg.key.id;

      let mediaUrl = null;
      if (['image', 'video', 'audio', 'document', 'sticker'].includes(messageType)) {
        try {
          const buffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger: pino({ level: 'silent' }), reuploadRequest: socket.updateMediaMessage },
          );
          mediaUrl = `data:application/octet-stream;base64,${buffer.toString('base64').slice(0, 100)}...`;
        } catch {
          mediaUrl = null;
        }
      }

      const payload = {
        sessionId,
        messageId,
        direction,
        sender,
        receiver,
        messageType,
        messageText,
        timestamp: msg.messageTimestamp,
        mediaUrl,
        raw: {
          remoteJid: msg.key.remoteJid,
          fromMe,
        },
      };

      const eventName = fromMe ? 'message.sent' : 'message.received';
      this.emit(eventName, payload);

      const dbSession = await SessionModel.findBySessionId(sessionId);
      if (dbSession?.webhook_url) {
        await webhookService.send(dbSession.webhook_url, eventName, payload);
      }
    } catch (error) {
      logger.error('Failed to handle incoming message', {
        sessionId,
        error: error.message,
      });
    }
  }

  /**
   * Schedule session reconnect with backoff
   * @param {string} sessionId
   */
  scheduleReconnect(sessionId) {
    const instance = this.getOrCreateInstance(sessionId);

    if (this.reconnectQueue.has(sessionId)) return;
    if (instance.reconnectAttempts >= env.reconnect.maxAttempts) {
      logger.error('Max reconnect attempts reached', { sessionId });
      return;
    }

    this.reconnectQueue.add(sessionId);
    instance.reconnectAttempts += 1;

    const delay = env.reconnect.delayMs * instance.reconnectAttempts;

    if (instance.reconnectTimer) {
      clearTimeout(instance.reconnectTimer);
    }

    instance.reconnectTimer = setTimeout(async () => {
      this.reconnectQueue.delete(sessionId);
      try {
        await this.reconnectSession(sessionId);
      } catch (error) {
        logger.error('Reconnect failed', { sessionId, error: error.message });
        this.scheduleReconnect(sessionId);
      }
    }, delay);

    logger.info('Reconnect scheduled', {
      sessionId,
      attempt: instance.reconnectAttempts,
      delayMs: delay,
    });
  }

  /**
   * Reconnect a session
   * @param {string} sessionId
   * @returns {Promise<SessionInstance>}
   */
  async reconnectSession(sessionId) {
    logger.info('Reconnecting session', { sessionId });
    return this.connectSession(sessionId);
  }

  /**
   * Request pairing code for session
   * @param {string} sessionId
   * @param {string} phone
   * @returns {Promise<string>}
   */
  async requestPairingCode(sessionId, phone) {
    let instance = this.sessions.get(sessionId);

    if (!instance?.socket) {
      await this.createSession(sessionId);
      instance = this.sessions.get(sessionId);
    }

    if (!instance?.socket) {
      throw new AppError('Failed to initialize session for pairing', 500);
    }

    if (instance.socket.authState.creds.registered) {
      throw new AppError('Session already registered', 400);
    }

    const code = await instance.socket.requestPairingCode(phone);
    instance.pairingCode = code;

    await SessionModel.updateStatus(sessionId, 'pairing', { phone });
    await this.updateSessionStatus(sessionId, 'pairing', { phone });

    this.emit('pairing.code', { sessionId, pairingCode: code, phone });
    logger.info('Pairing code generated', { sessionId, phone });

    return code;
  }

  /**
   * Get QR code for session
   * @param {string} sessionId
   * @returns {Promise<{ imageName: string, imageUrl: string } | null>}
   */
  async getQR(sessionId) {
    const instance = this.getOrCreateInstance(sessionId);

    if (instance.status === 'connected') {
      throw new AppError('Session already connected. QR is not required.', 400);
    }

    if (instance.qrImageUrl && fs.existsSync(this.getQrImagePath(sessionId))) {
      return { imageName: instance.qrImageName, imageUrl: instance.qrImageUrl };
    }

    this.cancelReconnect(sessionId);

    if (!instance.socket || instance.status === 'disconnected') {
      await this.connectSession(sessionId, { freshAuth: true });
    }

    let qrData = await this.waitForQR(sessionId, 45000);

    if (!qrData) {
      logger.info('QR not received, retrying with fresh auth', { sessionId });
      await this.connectSession(sessionId, { freshAuth: true });
      qrData = await this.waitForQR(sessionId, 45000);
    }

    return qrData;
  }

  /**
   * Send text message
   * @param {string} sessionId
   * @param {string} number
   * @param {string} message
   * @returns {Promise<object>}
   */
  async sendText(sessionId, number, message) {
    const instance = this.sessions.get(sessionId);
    const socket = this.getConnectedSocket(sessionId);
    const jid = await this.prepareForSend(socket, number);
    const result = await socket.sendMessage(jid, { text: message });
    this.storeSentMessage(instance, result);
    return result;
  }

  /**
   * Send image message
   * @param {string} sessionId
   * @param {string} number
   * @param {object} options
   * @returns {Promise<object>}
   */
  async sendImage(sessionId, number, { url, caption }) {
    const instance = this.sessions.get(sessionId);
    const socket = this.getConnectedSocket(sessionId);
    const jid = await this.prepareForSend(socket, number);
    const result = await socket.sendMessage(jid, { image: { url }, caption: caption || '' });
    this.storeSentMessage(instance, result);
    return result;
  }

  /**
   * Send document message
   * @param {string} sessionId
   * @param {string} number
   * @param {object} options
   * @returns {Promise<object>}
   */
  async sendDocument(sessionId, number, { url, fileName, mimetype, caption }) {
    const instance = this.sessions.get(sessionId);
    const socket = this.getConnectedSocket(sessionId);
    const jid = await this.prepareForSend(socket, number);
    const result = await socket.sendMessage(jid, {
      document: { url },
      fileName: fileName || 'document',
      mimetype: mimetype || 'application/pdf',
      caption: caption || '',
    });
    this.storeSentMessage(instance, result);
    return result;
  }

  /**
   * Send audio message
   * @param {string} sessionId
   * @param {string} number
   * @param {object} options
   * @returns {Promise<object>}
   */
  async sendAudio(sessionId, number, { url, ptt, mimetype }) {
    const instance = this.sessions.get(sessionId);
    const socket = this.getConnectedSocket(sessionId);
    const jid = await this.prepareForSend(socket, number);
    const result = await socket.sendMessage(jid, {
      audio: { url },
      mimetype: mimetype || 'audio/mpeg',
      ptt: ptt || false,
    });
    this.storeSentMessage(instance, result);
    return result;
  }

  /**
   * Send video message
   * @param {string} sessionId
   * @param {string} number
   * @param {object} options
   * @returns {Promise<object>}
   */
  async sendVideo(sessionId, number, { url, caption }) {
    const instance = this.sessions.get(sessionId);
    const socket = this.getConnectedSocket(sessionId);
    const jid = await this.prepareForSend(socket, number);
    const result = await socket.sendMessage(jid, { video: { url }, caption: caption || '' });
    this.storeSentMessage(instance, result);
    return result;
  }

  /**
   * Send location message
   * @param {string} sessionId
   * @param {string} number
   * @param {object} options
   * @returns {Promise<object>}
   */
  async sendLocation(sessionId, number, { latitude, longitude, name, address }) {
    const instance = this.sessions.get(sessionId);
    const socket = this.getConnectedSocket(sessionId);
    const jid = await this.prepareForSend(socket, number);
    const result = await socket.sendMessage(jid, {
      location: {
        degreesLatitude: latitude,
        degreesLongitude: longitude,
        name: name || '',
        address: address || '',
      },
    });
    this.storeSentMessage(instance, result);
    return result;
  }

  /**
   * Get connected socket or throw error
   * @param {string} sessionId
   * @returns {import('@whiskeysockets/baileys').WASocket}
   */
  getConnectedSocket(sessionId) {
    const instance = this.sessions.get(sessionId);
    if (!instance?.socket || instance.status !== 'connected') {
      throw new AppError('Session not connected', 400);
    }
    return instance.socket;
  }

  /**
   * Update session status in memory and database
   * @param {string} sessionId
   * @param {SessionStatus} status
   * @param {object} [extra]
   */
  async updateSessionStatus(sessionId, status, extra = {}) {
    const instance = this.getOrCreateInstance(sessionId);
    instance.status = status;
    await SessionModel.updateStatus(sessionId, status, extra);
  }

  /**
   * Destroy a session
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async destroySession(sessionId) {
    const instance = this.sessions.get(sessionId);
    if (!instance) return;

    instance.isDestroying = true;

    if (instance.reconnectTimer) {
      clearTimeout(instance.reconnectTimer);
      instance.reconnectTimer = null;
    }

    this.reconnectQueue.delete(sessionId);

    if (instance.socket) {
      try {
        await instance.socket.logout();
      } catch {
        try {
          instance.socket.end(undefined);
        } catch {
          // ignore
        }
      }
      instance.socket = null;
    }

    await this.clearSessionAuth(sessionId);
    this.deleteQrImage(sessionId);
    await SessionModel.delete(sessionId);
    this.sessions.delete(sessionId);

    logger.info('Session destroyed', { sessionId });
  }

  /**
   * Clear session auth data
   * @param {string} sessionId
   */
  async clearSessionAuth(sessionId) {
    const authDir = this.getSessionPath(sessionId);
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }
    await AuthModel.delete(sessionId);
  }

  /**
   * Restore all sessions from database on startup
   * @returns {Promise<void>}
   */
  async restoreSessions() {
    if (this.isRestoring) return;
    this.isRestoring = true;

    try {
      const sessions = await SessionModel.findRestorable();
      logger.info(`Restoring ${sessions.length} sessions from database`);

      for (const session of sessions) {
        try {
          const hasAuth = await this.ensureAuthState(session.session_id);

          if (hasAuth) {
            await this.connectSession(session.session_id);
            await new Promise((resolve) => setTimeout(resolve, 2000));
          } else {
            logger.info('No auth data found, skipping restore', {
              sessionId: session.session_id,
            });
          }
        } catch (error) {
          logger.error('Failed to restore session', {
            sessionId: session.session_id,
            error: error.message,
          });
        }
      }
    } finally {
      this.isRestoring = false;
    }
  }

  /**
   * Get all session statuses
   * @returns {object[]}
   */
  getAllSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.sessionId,
      status: s.status,
      hasQR: !!s.qrImageUrl,
      hasPairingCode: !!s.pairingCode,
      reconnectAttempts: s.reconnectAttempts,
    }));
  }

  /**
   * Get session statistics
   * @returns {object}
   */
  getStats() {
    const all = Array.from(this.sessions.values());
    return {
      total: all.length,
      connected: all.filter((s) => s.status === 'connected').length,
      connecting: all.filter((s) => s.status === 'connecting').length,
      disconnected: all.filter((s) => s.status === 'disconnected').length,
      qr: all.filter((s) => s.status === 'qr').length,
      pairing: all.filter((s) => s.status === 'pairing').length,
      reconnectQueue: this.reconnectQueue.size,
    };
  }

  /**
   * Graceful shutdown - close all sessions
   * @returns {Promise<void>}
   */
  async shutdown() {
    logger.info('Shutting down all sessions');
    const sessionIds = Array.from(this.sessions.keys());

    for (const sessionId of sessionIds) {
      const instance = this.sessions.get(sessionId);
      if (instance) {
        instance.isDestroying = true;
        if (instance.authBackupTimer) clearTimeout(instance.authBackupTimer);
        if (instance.reconnectTimer) clearTimeout(instance.reconnectTimer);
        if (instance.socket) {
          try {
            instance.socket.end(undefined);
          } catch {
            // ignore
          }
        }
        await this.backupAuthToDb(sessionId);
        await SessionModel.updateStatus(sessionId, 'disconnected');
      }
    }

    this.sessions.clear();
    this.reconnectQueue.clear();
  }
}

const sessionManager = new SessionManager();
export default sessionManager;
