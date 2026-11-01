const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pino = require('pino');

const sessionsPath = path.join(__dirname, 'sessions');
const qrStorePath = path.join(__dirname, 'qrs');

if (!fs.existsSync(sessionsPath)) fs.mkdirSync(sessionsPath, { recursive: true });
if (!fs.existsSync(qrStorePath)) fs.mkdirSync(qrStorePath, { recursive: true });

const CONNECT_TIMEOUT_MS = 45000;
const SEND_TIMEOUT_MS = 25000;
const IDLE_AFTER_SEND_MS = 20000;
const IDLE_AFTER_PROBE_MS = 3000;
const QR_WAIT_MS = 120000;
const RESTART_RECONNECT_DELAY_MS = 2000;
const MAX_RESTART_RECONNECTS = 2;

const sessions = {};
const sessionStatus = {};
const numberToSessionMap = {};
const lastActivity = {};
const lastUser = {};
const lastError = {};
const refCount = {};
const locks = {};
const waiters = {};
const idleTimers = {};
const qrTimers = {};
const restartAttempts = {};
const restartTimers = {};

let cachedBaileysVersion = null;
let cachedBaileysVersionAt = 0;

const logger = pino({
    level: 'error',
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: {
        level: (label) => {
            return { level: label };
        }
    }
});

function withTimeout(promise, ms, message) {
    let timer;
    return Promise.race([
        Promise.resolve(promise).finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), ms);
        })
    ]);
}

async function withLock(sessionId, fn) {
    const previous = locks[sessionId] || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    locks[sessionId] = previous.then(() => current, () => current);
    await previous.catch(() => {});
    try {
        return await fn();
    } finally {
        release();
        if (locks[sessionId] === current) delete locks[sessionId];
    }
}

function isSessionValid(sessionId) {
    const sessionPath = path.join(sessionsPath, sessionId);
    if (!fs.existsSync(sessionPath)) return false;

    try {
        const files = fs.readdirSync(sessionPath);
        if (!files.includes('creds.json')) return false;

        const credsPath = path.join(sessionPath, 'creds.json');
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
        return !!(creds && creds.noiseKey && creds.signedIdentityKey);
    } catch {
        return false;
    }
}

function sessionExists(sessionId) {
    if (!sessionId || sessionId === '.gitkeep') return false;
    if (sessions[sessionId] || sessionStatus[sessionId]) return true;

    const sessionPath = path.join(sessionsPath, sessionId);
    try {
        return fs.existsSync(sessionPath) && fs.statSync(sessionPath).isDirectory();
    } catch {
        return false;
    }
}

function generateSessionId(length = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const maxAttempts = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let id = '';
        for (let i = 0; i < length; i++) {
            id += chars[Math.floor(Math.random() * chars.length)];
        }
        if (!sessionExists(id)) return id;
    }

    throw new Error('Unable to generate a unique session id');
}

function listLinkedSessions() {
    if (!fs.existsSync(sessionsPath)) return [];
    return fs.readdirSync(sessionsPath).filter((dir) => isSessionValid(dir));
}

async function getBaileysVersion() {
    const now = Date.now();
    if (cachedBaileysVersion && now - cachedBaileysVersionAt < 60 * 60 * 1000) {
        return cachedBaileysVersion;
    }
    const { version } = await fetchLatestBaileysVersion();
    cachedBaileysVersion = version;
    cachedBaileysVersionAt = now;
    return version;
}

function clearIdleTimer(sessionId) {
    if (idleTimers[sessionId]) {
        clearTimeout(idleTimers[sessionId]);
        delete idleTimers[sessionId];
    }
}

function clearQrTimer(sessionId) {
    if (qrTimers[sessionId]) {
        clearTimeout(qrTimers[sessionId]);
        delete qrTimers[sessionId];
    }
}

function clearRestartTimer(sessionId) {
    if (restartTimers[sessionId]) {
        clearTimeout(restartTimers[sessionId]);
        delete restartTimers[sessionId];
    }
}

function settleWaiters(sessionId, error) {
    const list = waiters[sessionId] || [];
    delete waiters[sessionId];
    for (const waiter of list) {
        clearTimeout(waiter.timer);
        if (error) waiter.reject(error);
        else waiter.resolve(sessions[sessionId]);
    }
}

function waitUntilConnected(sessionId, timeoutMs) {
    if (sessionStatus[sessionId] === 'connected' && sessions[sessionId]) {
        return Promise.resolve(sessions[sessionId]);
    }

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const list = waiters[sessionId] || [];
            waiters[sessionId] = list.filter((item) => item.timer !== timer);
            reject(new Error('Connection timeout'));
        }, timeoutMs);

        waiters[sessionId] = waiters[sessionId] || [];
        waiters[sessionId].push({ resolve, reject, timer });
    });
}

function deleteQrFile(sessionId) {
    const qrPath = path.join(qrStorePath, `${sessionId}.png`);
    if (fs.existsSync(qrPath)) {
        try {
            fs.unlinkSync(qrPath);
        } catch (e) {
            console.warn(`Could not delete QR code for ${sessionId}:`, e.message);
        }
    }
}

function closeSocket(sessionId, { deleteFiles = false } = {}) {
    clearIdleTimer(sessionId);
    clearQrTimer(sessionId);
    clearRestartTimer(sessionId);
    delete restartAttempts[sessionId];

    const sock = sessions[sessionId];
    if (sock) {
        sock.__closedByUs = true;
        try {
            sock.ev.removeAllListeners();
        } catch (e) {
            // ignore
        }
        try {
            if (sock.ws) sock.ws.close();
        } catch (e) {
            // ignore
        }
        try {
            sock.end(new Error('Session closed'));
        } catch (e) {
            // ignore
        }
    }

    delete sessions[sessionId];
    refCount[sessionId] = 0;

    if (deleteFiles) {
        const sessionDir = path.join(sessionsPath, sessionId);
        deleteQrFile(sessionId);
        const numberEntry = Object.entries(numberToSessionMap).find(([, sid]) => sid === sessionId);
        if (numberEntry) delete numberToSessionMap[numberEntry[0]];
        delete lastUser[sessionId];
        delete sessionStatus[sessionId];
        delete lastActivity[sessionId];
        try {
            if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
            }
        } catch (fsError) {
            console.warn(`Error cleaning up files for session ${sessionId}:`, fsError);
        }
        settleWaiters(sessionId, new Error('Session removed'));
    } else {
        sessionStatus[sessionId] = isSessionValid(sessionId) ? 'idle' : (sessionStatus[sessionId] || 'idle');
        settleWaiters(sessionId, new Error('Session disconnected'));
    }
}

function scheduleIdleDisconnect(sessionId, delayMs) {
    clearIdleTimer(sessionId);
    if ((refCount[sessionId] || 0) > 0) return;
    if (!sessions[sessionId]) return;

    idleTimers[sessionId] = setTimeout(() => {
        delete idleTimers[sessionId];
        if ((refCount[sessionId] || 0) > 0) return;
        if (!sessions[sessionId]) return;
        console.log(`💤 Idle disconnect for session: ${sessionId}`);
        closeSocket(sessionId);
    }, delayMs);
}

function holdConnection(sessionId) {
    clearIdleTimer(sessionId);
    refCount[sessionId] = (refCount[sessionId] || 0) + 1;
}

function releaseConnection(sessionId, idleMs = IDLE_AFTER_SEND_MS) {
    refCount[sessionId] = Math.max(0, (refCount[sessionId] || 1) - 1);
    if (refCount[sessionId] === 0) {
        scheduleIdleDisconnect(sessionId, idleMs);
    }
}

async function createSocket(sessionId) {
    if (sessions[sessionId] && sessionStatus[sessionId] === 'connected') {
        return sessions[sessionId];
    }
    if (sessions[sessionId] && sessionStatus[sessionId] === 'connecting') {
        return sessions[sessionId];
    }

    if (sessions[sessionId]) {
        closeSocket(sessionId);
    }

    const sessionPath = path.join(sessionsPath, sessionId);
    if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const version = await getBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger,
        browser: Browsers.ubuntu('Chrome'),
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined
    });

    sessions[sessionId] = sock;
    sessionStatus[sessionId] = 'connecting';
    lastActivity[sessionId] = Date.now();
    lastError[sessionId] = null;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        try {
            if (sock.__closedByUs || sessions[sessionId] !== sock) {
                return;
            }

            const { connection, lastDisconnect, qr } = update;
            lastActivity[sessionId] = Date.now();

            if (qr) {
                console.log(`📸 Generating QR for session: ${sessionId}`);
                const qrImagePath = path.join(qrStorePath, `${sessionId}.png`);
                try {
                    await QRCode.toFile(qrImagePath, qr, {
                        errorCorrectionLevel: 'H',
                        width: 300
                    });
                    console.log(`✅ QR code saved for session: ${sessionId}`);
                } catch (qrError) {
                    console.error(`Error generating QR for ${sessionId}:`, qrError);
                }
            }

            if (connection === 'open') {
                console.log(`✅ Session connected: ${sessionId}`);
                clearQrTimer(sessionId);
                clearRestartTimer(sessionId);
                delete restartAttempts[sessionId];

                const currentNumber = sock.user?.id;
                if (currentNumber) {
                    const oldSessionId = numberToSessionMap[currentNumber];
                    if (oldSessionId && oldSessionId !== sessionId) {
                        console.log(`🔄 Removing duplicate session files: ${oldSessionId}`);
                        closeSocket(oldSessionId, { deleteFiles: true });
                    }
                    numberToSessionMap[currentNumber] = sessionId;
                    lastUser[sessionId] = {
                        id: sock.user.id,
                        name: sock.user.name || null
                    };
                }

                sessionStatus[sessionId] = 'connected';
                lastError[sessionId] = null;
                deleteQrFile(sessionId);
                settleWaiters(sessionId, null);

                if ((refCount[sessionId] || 0) === 0) {
                    scheduleIdleDisconnect(sessionId, IDLE_AFTER_SEND_MS);
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMessage = lastDisconnect?.error?.message || '';
                console.log(`🔌 Session disconnected: ${sessionId}, Code: ${statusCode}, Error: ${errorMessage}`);

                const loggedOut =
                    statusCode === DisconnectReason.loggedOut ||
                    errorMessage.includes('replaced') ||
                    errorMessage.includes('conflict');

                const restartRequired =
                    statusCode === DisconnectReason.restartRequired ||
                    statusCode === 515 ||
                    /restart required/i.test(errorMessage);

                if (loggedOut) {
                    lastError[sessionId] = 'logged_out';
                    console.log(`🚫 Session permanently logged out: ${sessionId}`);
                    closeSocket(sessionId, { deleteFiles: true });
                    return;
                }

                // After QR scan WhatsApp closes with 515 and expects an immediate reconnect.
                // Without this, the phone shows "internet may not be stable" and pairing fails.
                if (restartRequired) {
                    const attempts = (restartAttempts[sessionId] || 0) + 1;
                    restartAttempts[sessionId] = attempts;
                    delete sessions[sessionId];
                    clearIdleTimer(sessionId);
                    sessionStatus[sessionId] = 'connecting';
                    lastError[sessionId] = null;

                    if (attempts <= MAX_RESTART_RECONNECTS) {
                        console.log(`🔁 Restart required for ${sessionId} (attempt ${attempts}/${MAX_RESTART_RECONNECTS}). Reconnecting to finish pairing...`);
                        clearRestartTimer(sessionId);
                        restartTimers[sessionId] = setTimeout(() => {
                            delete restartTimers[sessionId];
                            withLock(sessionId, async () => {
                                if (sessions[sessionId]) return;
                                await createSocket(sessionId);
                            }).catch((err) => {
                                console.error(`Failed restart reconnect for ${sessionId}:`, err.message);
                                lastError[sessionId] = err.message;
                                sessionStatus[sessionId] = 'idle';
                                settleWaiters(sessionId, err);
                            });
                        }, RESTART_RECONNECT_DELAY_MS);
                        return;
                    }

                    console.warn(`❌ Restart reconnect attempts exhausted for ${sessionId}`);
                }

                lastError[sessionId] = errorMessage || 'disconnected';
                delete sessions[sessionId];
                clearIdleTimer(sessionId);
                refCount[sessionId] = 0;
                sessionStatus[sessionId] = 'idle';
                settleWaiters(sessionId, new Error(errorMessage || 'Session disconnected'));
            }
        } catch (updateError) {
            console.error(`Error in connection update for ${sessionId}:`, updateError);
        }
    });

    return sock;
}

async function startSession(sessionId) {
    return withLock(sessionId, async () => {
        if (sessions[sessionId] && sessionStatus[sessionId] === 'connected') {
            console.log(`Session ${sessionId} is already connected`);
            return sessions[sessionId];
        }
        if (sessions[sessionId] && sessionStatus[sessionId] === 'connecting') {
            console.log(`Session ${sessionId} is already connecting`);
            return sessions[sessionId];
        }
        if (isSessionValid(sessionId) && !sessions[sessionId]) {
            sessionStatus[sessionId] = 'idle';
            console.log(`Session ${sessionId} is already linked. Socket will open on send or status check.`);
            return null;
        }

        console.log(`▶️ Starting session socket (QR or login): ${sessionId}`);
        const sock = await createSocket(sessionId);

        clearQrTimer(sessionId);
        qrTimers[sessionId] = setTimeout(() => {
            if (sessionStatus[sessionId] === 'connecting') {
                console.log(`⌛ QR wait expired, closing socket: ${sessionId}`);
                closeSocket(sessionId);
            }
        }, QR_WAIT_MS);

        return sock;
    });
}

async function ensureConnected(sessionId, timeoutMs = CONNECT_TIMEOUT_MS) {
    await withLock(sessionId, async () => {
        if (sessions[sessionId] && sessionStatus[sessionId] === 'connected') {
            return sessions[sessionId];
        }

        if (!sessions[sessionId]) {
            if (!isSessionValid(sessionId) && sessionStatus[sessionId] !== 'connecting') {
                const error = new Error('Session is not linked. Start a session and scan QR.');
                error.code = 'NEEDS_QR';
                throw error;
            }
            await createSocket(sessionId);
        }
    });

    try {
        return await waitUntilConnected(sessionId, timeoutMs);
    } catch (err) {
        if (sessions[sessionId] && sessionStatus[sessionId] !== 'connected') {
            closeSocket(sessionId);
        }
        const timeoutError = new Error(err.message || 'Connection timeout');
        timeoutError.code = err.code || 'CONNECT_TIMEOUT';
        throw timeoutError;
    }
}

async function probeSession(sessionId) {
    const valid = isSessionValid(sessionId);
    const currentStatus = sessionStatus[sessionId];
    const socketState = sessions[sessionId]
        ? (sessionStatus[sessionId] === 'connected' ? 'connected' : 'connecting')
        : 'idle';

    if (currentStatus === 'connecting' && sessions[sessionId] && !valid) {
        return {
            session: sessionId,
            status: 'connecting',
            linked: false,
            hasValidFiles: false,
            socket: 'connecting',
            user: lastUser[sessionId] || null,
            lastError: lastError[sessionId] || null
        };
    }

    if (!valid && socketState === 'idle') {
        const error = new Error('Session not started or QR not scanned yet');
        error.code = 'SESSION_NOT_FOUND';
        throw error;
    }

    holdConnection(sessionId);
    try {
        const sock = await ensureConnected(sessionId, CONNECT_TIMEOUT_MS);
        lastActivity[sessionId] = Date.now();
        return {
            session: sessionId,
            status: 'ready',
            linked: true,
            hasValidFiles: true,
            socket: 'connected',
            user: sock?.user ? { id: sock.user.id, name: sock.user.name || null } : (lastUser[sessionId] || null),
            lastError: null
        };
    } catch (err) {
        const needsQr = err.code === 'NEEDS_QR' || !isSessionValid(sessionId);
        return {
            session: sessionId,
            status: needsQr ? 'needs_qr' : 'unreachable',
            linked: isSessionValid(sessionId),
            hasValidFiles: isSessionValid(sessionId),
            socket: 'idle',
            user: lastUser[sessionId] || null,
            lastError: err.message
        };
    } finally {
        releaseConnection(sessionId, IDLE_AFTER_PROBE_MS);
    }
}

async function runWithSession(sessionId, fn, idleMs = IDLE_AFTER_SEND_MS) {
    holdConnection(sessionId);
    try {
        const sock = await ensureConnected(sessionId, CONNECT_TIMEOUT_MS);
        lastActivity[sessionId] = Date.now();
        return await fn(sock);
    } finally {
        releaseConnection(sessionId, idleMs);
    }
}

async function sendText(sessionId, jid, text) {
    return runWithSession(sessionId, (sock) => {
        return withTimeout(sock.sendMessage(jid, { text }), SEND_TIMEOUT_MS, 'Send timeout');
    });
}

async function sendMedia(sessionId, jid, mediaPayload) {
    return runWithSession(sessionId, (sock) => {
        return withTimeout(sock.sendMessage(jid, mediaPayload), SEND_TIMEOUT_MS, 'Send timeout');
    });
}

async function markRead(sessionId, keys) {
    return runWithSession(sessionId, (sock) => {
        return withTimeout(sock.readMessages(keys), SEND_TIMEOUT_MS, 'Read timeout');
    });
}

function getSession(sessionId) {
    const sock = sessions[sessionId];
    if (sock && sessionStatus[sessionId] === 'connected') {
        lastActivity[sessionId] = Date.now();
        return sock;
    }
    return null;
}

function getQRBase64(sessionId) {
    const file = path.join(qrStorePath, `${sessionId}.png`);
    if (!fs.existsSync(file)) return null;
    try {
        return fs.readFileSync(file).toString('base64');
    } catch {
        return null;
    }
}

function removeSession(sessionId) {
    console.log(`🗑️ Removing session: ${sessionId}`);
    closeSocket(sessionId, { deleteFiles: true });
}

async function reconnectSession(sessionId) {
    return probeSession(sessionId);
}

async function restoreAllSessions() {
    const linked = listLinkedSessions();
    console.log(`📁 ${linked.length} linked session(s) on disk. Sockets will open only on send or status check.`);
}

function getRuntimeCounts() {
    const statuses = Object.values(sessionStatus);
    const connected = statuses.filter((status) => status === 'connected').length;
    const connecting = statuses.filter((status) => status === 'connecting').length;
    return {
        linked: listLinkedSessions().length,
        sockets: Object.keys(sessions).length,
        connected,
        connecting,
        idle: Math.max(0, listLinkedSessions().length - connected - connecting)
    };
}

module.exports = {
    startSession,
    getSession,
    getQRBase64,
    sessionStatus,
    removeSession,
    restoreAllSessions,
    reconnectSession,
    isSessionValid,
    sessionExists,
    generateSessionId,
    probeSession,
    sendText,
    sendMedia,
    markRead,
    getRuntimeCounts,
    CONNECT_TIMEOUT_MS,
    SEND_TIMEOUT_MS
};
