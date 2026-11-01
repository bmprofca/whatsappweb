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
const PORT = 2580;
const API_KEY = 'onedevelopers';

process.on('uncaughtException', (error) => {
    console.error('🟥 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🟥 Unhandled Rejection at:', promise, 'reason:', reason);
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    const ms = 55000;
    req.setTimeout(ms, () => {
        if (!res.headersSent) {
            res.status(408).json({
                success: false,
                error: { code: 'REQUEST_TIMEOUT', message: 'Request timed out' }
            });
        }
        req.destroy();
    });
    res.setTimeout(ms, () => {
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

function toJid(phone) {
    return phone.includes('@s.whatsapp.net') ? phone : `${phone}@s.whatsapp.net`;
}

function mapConnectError(err) {
    if (err.code === 'NEEDS_QR' || err.code === 'SESSION_NOT_FOUND') {
        return { status: 404, code: err.code === 'NEEDS_QR' ? 'NEEDS_QR' : 'SESSION_NOT_FOUND', message: err.message };
    }
    if (err.message && err.message.toLowerCase().includes('timeout')) {
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
        version: '1.2.0',
        mode: 'on-demand',
        baileys: '6.7.18',
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
    const { session } = req.params;

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
    const { session } = req.params;

    try {
        const imagePath = path.join(__dirname, 'qrs', `${session}.png`);
        if (!fs.existsSync(imagePath)) {
            return sendError(res, 404, 'QR_NOT_FOUND', 'QR not found. Session may be connected or QR not generated yet.');
        }

        return sendSuccess(res, 200, 'Scan this QR code within 60 seconds', {
            session,
            qr: `https://whatsappweb.onesaas.in/qrs/${session}.png`
        });
    } catch (err) {
        console.error(`Error getting QR for session ${session}:`, err);
        return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
});

app.delete('/sessions/:session', (req, res) => {
    const { session } = req.params;

    try {
        removeSession(session);
        return sendSuccess(res, 200, 'Session removed', { session });
    } catch (err) {
        console.error(`Error removing session ${session}:`, err);
        return sendError(res, 500, 'INTERNAL_ERROR', err.message);
    }
});

app.post('/sessions/:session/reconnect', async (req, res) => {
    const { session } = req.params;

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
    const { session } = req.params;
    const { phone, message } = req.body || {};

    if (!phone || !message) {
        return sendError(res, 400, 'MISSING_PARAMETER', 'phone and message are required');
    }

    try {
        const sentMsg = await sendText(session, toJid(phone), message);

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
    const { session } = req.params;
    const { phone, file, caption, message, fileName, file_name } = req.body || {};
    const mediaCaption = caption || message || '';
    const mediaFileName = fileName || file_name;

    if (!phone || !file) {
        return sendError(res, 400, 'MISSING_PARAMETER', 'phone and file are required');
    }

    try {
        let response;
        try {
            response = await axios.get(file, {
                responseType: 'arraybuffer',
                timeout: 30000,
                maxContentLength: 50 * 1024 * 1024
            });
        } catch (downloadErr) {
            console.error(`Error downloading media for session ${session}:`, downloadErr);
            return sendError(res, 502, 'MEDIA_DOWNLOAD_FAILED', downloadErr.message);
        }

        const buffer = Buffer.from(response.data);
        const mimeType = response.headers['content-type'] || mime.lookup(file) || 'application/octet-stream';

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

        const sentMsg = await sendMedia(session, toJid(phone), mediaPayload);

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
    const { session } = req.params;
    const { messageId, phone } = req.body || {};

    if (!messageId || !phone) {
        return sendError(res, 400, 'MISSING_PARAMETER', 'messageId and phone are required');
    }

    try {
        await markRead(session, [{ id: messageId, remoteJid: toJid(phone), fromMe: false }]);

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
            console.log(`🔄 Using Baileys version 6.7.18`);
        });
    } catch (err) {
        console.error('❌ Failed to start server:', err);
        process.exit(1);
    }
}

startServer();
