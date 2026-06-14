# API Documentation

Base URL (local): `http://localhost:5677`  
Base URL (production): `https://whatsappweb.onesaasbackend.com`

All `/api/*` endpoints require the `X-API-Key` header unless `API_KEY` is not set in environment.

## Response Format

### Success

```json
{
  "success": true,
  "message": "Description",
  "data": {}
}
```

### Error

```json
{
  "success": false,
  "message": "Error description",
  "details": []
}
```

---

## Health

### GET /health

No authentication required.

**Response:**

```json
{
  "success": true,
  "message": "Server is healthy",
  "data": {
    "status": "ok",
    "uptime": "1h 23m 45s",
    "memory": {
      "rss": "120MB",
      "heapTotal": "80MB",
      "heapUsed": "45MB",
      "external": "2MB"
    },
    "sessions": 10,
    "connected": 8,
    "connecting": 1,
    "disconnected": 1,
    "reconnectQueue": 0,
    "timestamp": "2026-06-14T10:00:00.000Z"
  }
}
```

---

## Sessions

### POST /api/sessions/create

Create a new WhatsApp session.

**Headers:**
- `X-API-Key: your_api_key`
- `Content-Type: application/json`

**Body:**

```json
{
  "sessionId": "session1",
  "webhookUrl": "https://your-server.com/webhook",
  "pairingCodeEnabled": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| sessionId | string | Yes | Unique alphanumeric session identifier (3-100 chars) |
| webhookUrl | string | No | Webhook URL for session events |
| pairingCodeEnabled | boolean | No | Enable pairing code login (default: false) |

**Response (201):**

```json
{
  "success": true,
  "message": "Session created successfully",
  "data": {
    "sessionId": "session1",
    "status": "connecting",
    "webhookUrl": "https://your-server.com/webhook",
    "pairingCodeEnabled": false
  }
}
```

---

### GET /api/sessions

List all sessions with statistics.

**Response:**

```json
{
  "success": true,
  "message": "Sessions retrieved",
  "data": {
    "sessions": [
      {
        "sessionId": "session1",
        "phone": "919999999999",
        "displayName": "John",
        "status": "connected",
        "webhookUrl": "https://your-server.com/webhook",
        "pairingCodeEnabled": false,
        "reconnectAttempts": 0,
        "createdAt": "2026-06-14T10:00:00.000Z",
        "updatedAt": "2026-06-14T10:05:00.000Z"
      }
    ],
    "stats": {
      "total": 1,
      "connected": 1,
      "connecting": 0,
      "disconnected": 0,
      "qr": 0,
      "pairing": 0,
      "reconnectQueue": 0
    }
  }
}
```

**Session Status Values:** `disconnected`, `connecting`, `qr`, `pairing`, `connected`, `destroyed`

---

### GET /api/sessions/:id

Get session details by ID.

---

### GET /api/sessions/:id/qr

Get QR code for session authentication.

Returns a base64 data URL suitable for displaying in an `<img>` tag.

**Response:**

```json
{
  "success": true,
  "message": "QR code retrieved",
  "data": {
    "sessionId": "session1",
    "qr": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
  }
}
```

**Note:** QR codes expire. Listen to Socket.IO `qr.updated` event for real-time updates.

---

### POST /api/sessions/:id/pairing-code

Request a pairing code for phone number login.

**Body:**

```json
{
  "phone": "919999999999"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| phone | string | Yes | Phone number with country code, digits only (10-15 digits) |

**Response:**

```json
{
  "success": true,
  "message": "Pairing code generated",
  "data": {
    "sessionId": "session1",
    "pairingCode": "ABCD-EFGH",
    "phone": "919999999999"
  }
}
```

**Usage:** Open WhatsApp → Linked Devices → Link with phone number → Enter the pairing code.

---

### DELETE /api/sessions/:id

Delete a session, logout from WhatsApp, and clear auth data.

---

### PUT /api/sessions/:id/webhook

Update webhook URL for a session.

**Body:**

```json
{
  "webhookUrl": "https://your-server.com/webhook"
}
```

---

### GET /api/sessions/:id/messages

Get message logs for a session.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| limit | number | 50 | Max messages to return |

---

## Messages

All message endpoints require an active (connected) session.

### POST /api/messages/send-text

**Body:**

```json
{
  "sessionId": "session1",
  "number": "919999999999",
  "message": "Hello from API!"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Message sent",
  "data": {
    "messageId": "3EB0XXXX",
    "remoteJid": "919999999999@s.whatsapp.net",
    "status": 1,
    "timestamp": 1718361600
  }
}
```

---

### POST /api/messages/send-image

**Body:**

```json
{
  "sessionId": "session1",
  "number": "919999999999",
  "url": "https://example.com/image.jpg",
  "caption": "Check this out!"
}
```

---

### POST /api/messages/send-document

**Body:**

```json
{
  "sessionId": "session1",
  "number": "919999999999",
  "url": "https://example.com/file.pdf",
  "fileName": "document.pdf",
  "mimetype": "application/pdf",
  "caption": "Here is the document"
}
```

---

### POST /api/messages/send-audio

**Body:**

```json
{
  "sessionId": "session1",
  "number": "919999999999",
  "url": "https://example.com/audio.mp3",
  "ptt": false,
  "mimetype": "audio/mpeg"
}
```

| Field | Type | Description |
|-------|------|-------------|
| ptt | boolean | Send as voice note (push-to-talk) |

---

### POST /api/messages/send-video

**Body:**

```json
{
  "sessionId": "session1",
  "number": "919999999999",
  "url": "https://example.com/video.mp4",
  "caption": "Watch this video"
}
```

---

### POST /api/messages/send-location

**Body:**

```json
{
  "sessionId": "session1",
  "number": "919999999999",
  "latitude": 28.6139,
  "longitude": 77.2090,
  "name": "New Delhi",
  "address": "India Gate, New Delhi"
}
```

---

## Webhooks

### PUT /api/webhooks/:id

Update webhook URL (alias for session webhook update).

### GET /api/webhooks/:id/logs

Get webhook delivery logs for a session.

**Query Parameters:**

| Param | Type | Default |
|-------|------|---------|
| limit | number | 50 |

---

## Webhook Payload Format

When events occur, the server POSTs to the session's webhook URL:

```json
{
  "event": "message.received",
  "timestamp": "2026-06-14T10:00:00.000Z",
  "data": {
    "sessionId": "session1",
    "messageId": "3EB0XXXX",
    "direction": "IN",
    "sender": "919999999999",
    "receiver": "918888888888",
    "messageType": "text",
    "messageText": "Hello!",
    "timestamp": 1718361600,
    "raw": {
      "remoteJid": "919999999999@s.whatsapp.net",
      "fromMe": false
    }
  }
}
```

**Webhook Events:**

| Event | Trigger |
|-------|---------|
| `message.received` | Incoming message |
| `message.sent` | Outgoing message (including from phone) |
| `session.connected` | Session connected to WhatsApp |
| `session.disconnected` | Session disconnected |

**Retry Policy:** Failed deliveries are retried 3 times with increasing delay.

---

## Error Codes

| Status | Description |
|--------|-------------|
| 400 | Bad request / validation error / session not connected |
| 401 | Invalid or missing API key |
| 404 | Session not found |
| 409 | Session already exists or connected |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

---

## Example: Full Session Flow

```bash
# 1. Create session
curl -X POST http://localhost:5677/api/sessions/create \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "session1", "webhookUrl": "https://your-server.com/hook"}'

# 2. Get QR code (or use Socket.IO qr.updated event)
curl http://localhost:5677/api/sessions/session1/qr \
  -H "X-API-Key: your_api_key"

# 3. After scanning QR, session connects automatically

# 4. Send a message
curl -X POST http://localhost:5677/api/messages/send-text \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "session1", "number": "919999999999", "message": "Hello!"}'
```

### Pairing Code Flow

```bash
# 1. Create session
curl -X POST http://localhost:5677/api/sessions/create \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "session2", "pairingCodeEnabled": true}'

# 2. Request pairing code
curl -X POST http://localhost:5677/api/sessions/session2/pairing-code \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"phone": "919999999999"}'
```
