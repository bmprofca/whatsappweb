const express = require('express');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const axios = require('axios');
const {
    startSession,
    removeSession,
    restoreAllSessions,
    reconnectSession,
    generateSessionId,
    probeSession,
    sendText,
    sendMedia,
    markRead,
    getRuntimeCounts
} = require('./sessionManager');

const app = express();
const PORT = Number(process.env.PORT) || 2580;
const API_KEY = process.env.API_KEY || 'onedevelopers';
const API_VERSION = '1.2.0';
const BAILEYS_VERSION = '7.0.0-rc.6';
const HTTP_TIMEOUT_MS = 120000;
const SESSION_ID_RE = /^[A-Z0-9]{6}$/;
const DEFAULT_PUBLIC_BASE_URL = 'https://whatsappweb.onesaas.in';

process.on('uncaughtException', (error) => {
    console.error('🟥 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🟥 Unhandled Rejection at:', promise, 'reason:', reason);
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    req.setTimeout(HTTP_TIMEOUT_MS, () => {
        if (!res.headersSent) {
            res.status(408).json({
                success: false,
                error: { code: 'REQUEST_TIMEOUT', message: 'Request timed out' }
            });
        }
        req.destroy();
    });
    res.setTimeout(HTTP_TIMEOUT_MS, () => {
        if (!res.headersSent) {
            res.status(408).json({
                success: false,
                error: { code: 'REQUEST_TIMEOUT', message: 'Request timed out' }
            });
        }
    });
    next();
});

function sendSuccess(res, statusCode, message, data = null) {
    const payload = { success: true, message };
    if (data !== null) payload.data = data;
    return res.status(statusCode).json(payload);
}

function sendError(res, statusCode, code, message) {
    return res.status(statusCode).json({
        success: false,
        error: { code, message }
    });
}

function parseSessionId(req, res) {
    const session = String(req.params.session || '').trim();
    if (!SESSION_ID_RE.test(session)) {
        sendError(res, 400, 'INVALID_SESSION', 'Session id must be 6 uppercase letters or digits');
        return null;
    }
    return session;
}

function toJid(phone) {
    const value = String(phone ?? '').trim();
    if (!value) return '';
    if (value.includes('@')) return value;
    const digits = value.replace(/[^\d]/g, '');
    return digits ? `${digits}@s.whatsapp.net` : '';
}

function publicBaseUrl(req) {
    const configured = process.env.PUBLIC_BASE_URL;
    if (configured) return configured.replace(/\/$/, '');
    const host = req.get('x-forwarded-host') || req.get('host');
    if (host) {
        const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
        return `${proto}://${host}`;
    }
    return DEFAULT_PUBLIC_BASE_URL;
}

function assertSafeMediaUrl(file) {
    let url;
    try {
        url = new URL(String(file || ''));
    } catch {
        const error = new Error('file must be a valid http or https URL');
        error.code = 'INVALID_PARAMETER';
        throw error;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        const error = new Error('file must be an http or https URL');
        error.code = 'INVALID_PARAMETER';
        throw error;
    }

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const blocked =
        hostname === 'localhost' ||
        hostname === '::1' ||
        hostname === '0.0.0.0' ||
        hostname.endsWith('.local') ||
        hostname === '169.254.169.254' ||
        hostname === 'metadata.google.internal' ||
        /^127\./.test(hostname) ||
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

    if (blocked) {
        const error = new Error('file URL must not point to a private or local address');
        error.code = 'INVALID_PARAMETER';
        throw error;
    }

    return url.toString();
}

function mapConnectError(err) {
    if (err.code === 'NEEDS_QR' || err.code === 'SESSION_NOT_FOUND') {
        return { status: 404, code: err.code, message: err.message };
    }
    const message = String(err.message || '').toLowerCase();
    if (message.includes('send timeout')) {
        return { status: 504, code: 'SEND_TIMEOUT', message: err.message };
    }
    if (message.includes('read timeout')) {
        return { status: 504, code: 'READ_TIMEOUT', message: err.message };
    }
    if (message.includes('timeout')) {
        return { status: 504, code: 'CONNECT_TIMEOUT', message: err.message };
    }
    return { status: 500, code: 'INTERNAL_ERROR', message: err.message };
}

app.use('/qrs', express.static(path.join(__dirname, 'qrs')));

app.use((req, res, next) => {
    if (req.path.startsWith('/qrs')) return next();

    const apiKey = req.header('x-api-key');
    if (apiKey !== API_KEY) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Invalid or missing x-api-key');
    }
    return next();
});

app.get('/', (req, res) => {
    return sendSuccess(res, 200, 'WhatsApp API Server is running', {
        version: API_VERSION,
        mode: 'on-demand',
        baileys: BAILEYS_VERSION,
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    const counts = getRuntimeCounts();
    return sendSuccess(res, 200, 'Service is healthy', {
        status: 'ok',
        timestamp: new Date().toISOString(),
        sessions: counts
    });
});

app.post('/sessions', async (req, res) => {
    let session;
    try {
        session = generateSessionId(6);
        await startSession(session);
        return sendSuccess(res, 201, 'Session started', {
            session,
            linked: false,
            qrEndpoint: `/sessions/${encodeURIComponent(session)}/qr`
        });
    } catch (err) {
        console.error(`Error starting session ${session || '(id not generated)'}:`, err);
        return sendError(res, 500, 'INTERNAL_ERROR', err.message);
    }
});

app.get('/sessions/:session', async (req, res) => {
    const session = parseSessionId(req, res);
    if (!session) return;

    try {
        const data = await probeSession(session);
        const message = data.status === 'ready'
            ? 'Session can connect to WhatsApp'
            : data.status === 'connecting'
                ? 'Session is connecting'
                : data.status === 'needs_qr'
                    ? 'Session is not linked'
                    : 'Session could not connect to WhatsApp';
        return sendSuccess(res, 200, message, data);
    } catch (err) {
        if (err.code === 'SESSION_NOT_FOUND') {
            return sendError(res, 404, 'SESSION_NOT_FOUND', err.message);
        }
        console.error(`Error checking status for session ${session}:`, err);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
});

app.get('/sessions/:session/qr', async (req, res) => {
    const session = parseSessionId(req, res);
    if (!session) return;

    try {
        const imagePath = path.join(__dirname, 'qrs', `${session}.png`);
        if (!fs.existsSync(imagePath)) {
            return sendError(res, 404, 'QR_NOT_FOUND', 'QR not found. Session may be connected or QR not generated yet.');
        }

        return sendSuccess(res, 200, 'Scan this QR code within 60 seconds', {
            session,
            qr: `${publicBaseUrl(req)}/qrs/${session}.png`
        });
    } catch (err) {
        console.error(`Error getting QR for session ${session}:`, err);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
});

app.delete('/sessions/:session', (req, res) => {
    const session = parseSessionId(req, res);
    if (!session) return;

    try {
        removeSession(session);
        return sendSuccess(res, 200, 'Session removed', { session });
    } catch (err) {
        console.error(`Error removing session ${session}:`, err);
        return sendError(res, 500, 'INTERNAL_ERROR', err.message);
    }
});

app.post('/sessions/:session/reconnect', async (req, res) => {
    const session = parseSessionId(req, res);
    if (!session) return;

    try {
        const data = await reconnectSession(session);
        return sendSuccess(res, 200, data.status === 'ready' ? 'Session reconnection verified' : 'Session reconnection result', data);
    } catch (err) {
        if (err.code === 'SESSION_NOT_FOUND') {
            return sendError(res, 404, 'SESSION_NOT_FOUND', err.message);
        }
        console.error(`Error in reconnect for session ${session}:`, err);
        return sendError(res, 500, 'RECONNECT_FAILED', err.message || 'Reconnection failed');
    }
});

app.post('/sessions/:session/messages', async (req, res) => {
    const session = parseSessionId(req, res);
    if (!session) return;
    const { phone, message } = req.body || {};
    const jid = toJid(phone);

    if (!jid || message === undefined || message === null || String(message) === '') {
        return sendError(res, 400, 'MISSING_PARAMETER', 'phone and message are required');
    }

    try {
        const sentMsg = await sendText(session, jid, String(message));

        console.log(`✅ Message sent to ${phone} with ID: ${sentMsg?.key?.id}`);

        return sendSuccess(res, 200, 'Message sent', {
            session,
            phone,
            messageId: sentMsg?.key?.id,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error(`Error sending message via session ${session}:`, err);
        const mapped = mapConnectError(err);
        return sendError(res, mapped.status, mapped.code, mapped.message);
    }
});

app.post('/sessions/:session/messages/media', async (req, res) => {
    const session = parseSessionId(req, res);
    if (!session) return;
    const { phone, file, caption, message, fileName, file_name } = req.body || {};
    const jid = toJid(phone);
    const mediaCaption = caption || message || '';
    const mediaFileName = fileName || file_name;

    if (!jid || !file) {
        return sendError(res, 400, 'MISSING_PARAMETER', 'phone and file are required');
    }

    let fileUrl;
    try {
        fileUrl = assertSafeMediaUrl(file);
    } catch (err) {
        return sendError(res, 400, 'INVALID_PARAMETER', err.message);
    }

    try {
        let response;
        try {
            response = await axios.get(fileUrl, {
                responseType: 'arraybuffer',
                timeout: 30000,
                maxContentLength: 50 * 1024 * 1024
            });
        } catch (downloadErr) {
            console.error(`Error downloading media for session ${session}:`, downloadErr);
            return sendError(res, 502, 'MEDIA_DOWNLOAD_FAILED', downloadErr.message);
        }

        const buffer = Buffer.from(response.data);
        const mimeType = String(response.headers['content-type'] || mime.lookup(fileUrl) || 'application/octet-stream').split(';')[0].trim();

        const mediaPayload = {
            mimetype: mimeType,
            caption: mediaCaption,
            fileName: mediaFileName || `file_${Date.now()}`
        };

        if (mimeType.startsWith('image/')) {
            mediaPayload.image = buffer;
        } else if (mimeType.startsWith('video/')) {
            mediaPayload.video = buffer;
        } else if (mimeType.startsWith('audio/')) {
            mediaPayload.audio = buffer;
        } else {
            mediaPayload.document = buffer;
            mediaPayload.fileName = mediaFileName || `document_${Date.now()}.${mime.extension(mimeType) || 'bin'}`;
        }

        const sentMsg = await sendMedia(session, jid, mediaPayload);

        console.log(`✅ Media sent to ${phone} with ID: ${sentMsg?.key?.id}`);

        return sendSuccess(res, 200, 'Media sent', {
            session,
            phone,
            messageId: sentMsg?.key?.id,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error(`Error sending media via session ${session}:`, err);
        const mapped = mapConnectError(err);
        return sendError(res, mapped.status, mapped.code, mapped.message);
    }
});

app.post('/sessions/:session/messages/read', async (req, res) => {
    const session = parseSessionId(req, res);
    if (!session) return;
    const { messageId, phone } = req.body || {};
    const jid = toJid(phone);

    if (!messageId || !jid) {
        return sendError(res, 400, 'MISSING_PARAMETER', 'messageId and phone are required');
    }

    try {
        await markRead(session, [{ id: String(messageId), remoteJid: jid, fromMe: false }]);

        return sendSuccess(res, 200, 'Message marked as read', {
            session,
            phone,
            messageId,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('Error marking message as read:', err);
        const mapped = mapConnectError(err);
        return sendError(res, mapped.status, mapped.code, mapped.message);
    }
});

app.use((req, res) => {
    return sendError(res, 404, 'NOT_FOUND', `Cannot ${req.method} ${req.path}`);
});

app.use((err, req, res, next) => {
    console.error('🟥 Unhandled route error:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
});

async function startServer() {
    try {
        console.log('🔄 Starting WhatsApp API Server...');
        console.log('📁 On-demand mode: sockets open only for send or status check');

        await restoreAllSessions();

        app.listen(PORT, () => {
            console.log(`✅ API server running at http://localhost:${PORT}`);
            console.log(`🔌 Sessions stay idle on disk until send or status probe`);
            console.log(`🔒 Incoming message handlers disabled`);
            console.log(`🔄 Using Baileys version ${BAILEYS_VERSION}`);
        });
    } catch (err) {
        console.error('❌ Failed to start server:', err);
        process.exit(1);
    }
}

startServer();
