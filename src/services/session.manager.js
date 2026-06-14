import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';

import env from '../config/env.js';
import { AuthModel } from '../database/models/auth.model.js';
import { MessageLogModel } from '../database/models/messageLog.model.js';
import { SessionModel } from '../database/models/session.model.js';
import { fromJid, isFromMe, parseMessageContent, sleep, toJid } from '../utils/helpers.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

import webhookService from './webhook.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, '../storage/sessions');

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
 * @property {string | null} pairingCode
 * @property {number} reconnectAttempts
 * @property {boolean} isDestroying
 * @property {NodeJS.Timeout | null} reconnectTimer
 * @property {Function | null} saveCreds
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
   * Fetch latest WhatsApp Web version (cached for 1 hour)
   * @param {boolean} [force]
   * @returns {Promise<[number, number, number]>}
   */
  async getWaVersion(force = false) {
    const now = Date.now();
    if (!force && cachedWaVersion && now - versionFetchedAt < VERSION_TTL_MS) {
      return cachedWaVersion;
    }

    try {
      const { version, isLatest } = await fetchLatestWaWebVersion({});
      cachedWaVersion = version;
      versionFetchedAt = now;
      logger.info('WhatsApp Web version resolved', { version, isLatest });
      return version;
    } catch (error) {
      logger.warn('fetchLatestWaWebVersion failed, falling back to Baileys version', {
        error: error.message,
      });
      const { version } = await fetchLatestBaileysVersion();
      cachedWaVersion = version;
      versionFetchedAt = now;
      return version;
    }
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
      if (instance.qr) return instance.qr;
      if (instance.status === 'connected') {
        throw new AppError('Session already connected. QR is not required.', 400);
      }
      await sleep(500);
    }

    return instance.qr || null;
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
        pairingCode: null,
        reconnectAttempts: 0,
        isDestroying: false,
        reconnectTimer: null,
        saveCreds: null,
      });
    }
    return this.sessions.get(sessionId);
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

    const authPath = this.getSessionPath(sessionId);
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    instance.saveCreds = saveCreds;

    const version = await this.getWaVersion(options.freshAuth);
    const baileysLogger = pino({ level: 'silent' });

    const socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      printQRInTerminal: false,
      browser: Browsers.ubuntu('WhatsApp API Server'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: true,
      connectTimeoutMs: 60000,
      qrTimeout: 60000,
      logger: baileysLogger,
      getMessage: async () => undefined,
    });

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
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr);
          instance.qr = qrDataUrl;
          await this.updateSessionStatus(sessionId, 'qr');
          this.emit('qr.updated', { sessionId, qr: qrDataUrl });
          logger.info('QR code generated', { sessionId });
        } catch (error) {
          logger.error('QR generation failed', { sessionId, error: error.message });
        }
      }

      if (connection === 'open') {
        instance.qr = null;
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
        const isRegistered = socket.authState?.creds?.registered === true;
        const isConnectionFailure = [405, 403, 500, DisconnectReason.badSession].includes(
          statusCode,
        );

        if (instance.isDestroying) {
          await this.updateSessionStatus(sessionId, 'destroyed');
          return;
        }

        // Unregistered session (QR / pairing login) — clear bad auth, do not auto-reconnect
        if (!isRegistered) {
          instance.qr = null;
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

        instance.qr = null;

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

        if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
          logger.info('Restart required, reconnecting', { sessionId });
          setTimeout(() => this.reconnectSession(sessionId), 2000);
          return;
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

      await MessageLogModel.create({
        sessionId,
        messageId,
        direction,
        sender,
        receiver,
        messageType,
        messageText,
      });

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

      logger.info('Message processed', { sessionId, messageId, direction, messageType });

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
   * @returns {Promise<string | null>}
   */
  async getQR(sessionId) {
    const instance = this.getOrCreateInstance(sessionId);

    if (instance.status === 'connected') {
      throw new AppError('Session already connected. QR is not required.', 400);
    }

    if (instance.qr) return instance.qr;

    this.cancelReconnect(sessionId);

    if (!instance.socket || instance.status === 'disconnected') {
      await this.connectSession(sessionId, { freshAuth: true });
    }

    let qr = await this.waitForQR(sessionId, 45000);

    if (!qr) {
      logger.info('QR not received, retrying with fresh auth', { sessionId });
      await this.connectSession(sessionId, { freshAuth: true });
      qr = await this.waitForQR(sessionId, 45000);
    }

    return qr;
  }

  /**
   * Send text message
   * @param {string} sessionId
   * @param {string} number
   * @param {string} message
   * @returns {Promise<object>}
   */
  async sendText(sessionId, number, message) {
    const socket = this.getConnectedSocket(sessionId);
    const jid = toJid(number);
    const result = await socket.sendMessage(jid, { text: message });
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
    const socket = this.getConnectedSocket(sessionId);
    const jid = toJid(number);
    return socket.sendMessage(jid, { image: { url }, caption: caption || '' });
  }

  /**
   * Send document message
   * @param {string} sessionId
   * @param {string} number
   * @param {object} options
   * @returns {Promise<object>}
   */
  async sendDocument(sessionId, number, { url, fileName, mimetype, caption }) {
    const socket = this.getConnectedSocket(sessionId);
    const jid = toJid(number);
    return socket.sendMessage(jid, {
      document: { url },
      fileName: fileName || 'document',
      mimetype: mimetype || 'application/pdf',
      caption: caption || '',
    });
  }

  /**
   * Send audio message
   * @param {string} sessionId
   * @param {string} number
   * @param {object} options
   * @returns {Promise<object>}
   */
  async sendAudio(sessionId, number, { url, ptt, mimetype }) {
    const socket = this.getConnectedSocket(sessionId);
    const jid = toJid(number);
    return socket.sendMessage(jid, {
      audio: { url },
      mimetype: mimetype || 'audio/mpeg',
      ptt: ptt || false,
    });
  }

  /**
   * Send video message
   * @param {string} sessionId
   * @param {string} number
   * @param {object} options
   * @returns {Promise<object>}
   */
  async sendVideo(sessionId, number, { url, caption }) {
    const socket = this.getConnectedSocket(sessionId);
    const jid = toJid(number);
    return socket.sendMessage(jid, { video: { url }, caption: caption || '' });
  }

  /**
   * Send location message
   * @param {string} sessionId
   * @param {string} number
   * @param {object} options
   * @returns {Promise<object>}
   */
  async sendLocation(sessionId, number, { latitude, longitude, name, address }) {
    const socket = this.getConnectedSocket(sessionId);
    const jid = toJid(number);
    return socket.sendMessage(jid, {
      location: {
        degreesLatitude: latitude,
        degreesLongitude: longitude,
        name: name || '',
        address: address || '',
      },
    });
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
          const hasAuth =
            fs.existsSync(this.getSessionPath(session.session_id)) ||
            (await this.restoreAuthFromDb(session.session_id));

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
      hasQR: !!s.qr,
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
