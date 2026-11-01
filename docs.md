# WhatsApp Web V2 API — Integration Guide

Send-only WhatsApp API. Sessions stay linked on disk; WhatsApp sockets open only when needed, then disconnect. Incoming messages are not handled.

**Base URL:** `https://whatsappweb.onesaas.in`  
**Content-Type:** `application/json`  
**Response format:** JSON  
**Auth:** required header `x-api-key: YOUR_API_KEY` on every JSON API call  

After a QR scan, a brief disconnect with code **515** is normal. The server reconnects automatically to finish pairing; wait for the phone to show the linked device before creating another session.

QR image files under `/qrs/*.png` are public so they can load in an `<img>` tag without the API key.

---

## 1. Authentication

Every API request (except raw QR PNGs) must include the `x-api-key` header. Use the API key provided to you by the project admin (do not hardcode or publish it).

```http
x-api-key: YOUR_API_KEY
```

**Missing or wrong key — `401`**

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing x-api-key"
  }
}
```

---

## 2. How this server works (read this first)

### 2.1 On-demand sockets

| Event | WhatsApp socket |
|---|---|
| Server start / idle overnight | **Closed** (login files stay on disk) |
| `POST /sessions` (new device) | Opens for QR pairing; server **auto-generates** the session id |
| `GET /sessions/{id}` (status) | Opens, verifies login, closes after **~3s** |
| `POST .../messages` (send) | Opens, sends, closes after **~20s** idle |
| `DELETE /sessions/{id}` | Closes and **deletes login files** |

**Idle disconnect ≠ session removed.**  
Logs like `✅ Session connected` then `💤 Idle disconnect` mean the socket closed on purpose. The login under `sessions/{id}/` remains. The next send reconnects without a new QR.

### 2.2 What this API is for

- Create a session (server generates the id) and link via QR  
- Send text / media later on demand  
- Optionally probe “can this login still connect?”  
- Unlink / wipe a session  

**Not for:** receiving messages, always-online bots, status polling every second.

### 2.3 Session name (auto-generated)

On `POST /sessions` you **do not** send a session name.

The server generates a unique id:

- Length: **6**
- Characters: **A–Z** (uppercase) and **0–9**
- Example: `A7K2M9`
- If the id already exists, the server regenerates until unique

Store `data.session` from the create response. Use that value in all later URLs.

### 2.4 Socket vs login

| Term | Meaning |
|---|---|
| **Socket connected** | Temporary live WhatsApp connection (seconds) |
| **Linked / ready** | Valid files in `sessions/{id}/` — can send anytime |
| **Removed** | Login files deleted — need new QR |

---

## 3. Conventions

### 3.1 Success response

```json
{
  "success": true,
  "message": "Human-readable summary",
  "data": { }
}
```

### 3.2 Error response

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable explanation"
  }
}
```

Match on `error.code` in client code.

### 3.3 HTTP status codes

| Code | Meaning |
|---|---|
| `200` | OK |
| `201` | Session created |
| `400` | Missing / invalid body |
| `401` | Missing or invalid `x-api-key` |
| `404` | Unknown route, no session, QR missing, or needs QR |
| `408` | Whole HTTP request exceeded 55s |
| `500` | Server / WhatsApp error |
| `502` | Media URL download failed |
| `504` | WhatsApp connect or send timed out |

### 3.4 Error codes

| `error.code` | HTTP | When |
|---|---|---|
| `UNAUTHORIZED` | `401` | Missing or wrong `x-api-key` |
| `MISSING_PARAMETER` | `400` | Required JSON field missing |
| `SESSION_NOT_FOUND` | `404` | No saved login and no QR in progress |
| `NEEDS_QR` | `404` | Not linked; scan QR again |
| `QR_NOT_FOUND` | `404` | QR PNG not ready yet, or already linked |
| `NOT_FOUND` | `404` | Wrong path or method |
| `MEDIA_DOWNLOAD_FAILED` | `502` | Cannot download `file` URL |
| `CONNECT_TIMEOUT` | `504` | Connect or send timed out |
| `REQUEST_TIMEOUT` | `408` | HTTP request > 55s |
| `RECONNECT_FAILED` | `500` | Reconnect/probe failed hard |
| `INTERNAL_ERROR` | `500` | Unexpected exception |

### 3.5 Timeouts and idle

| Limit | Value |
|---|---|
| JSON body | 1 MB |
| HTTP request | 55s |
| WhatsApp connect | 20s |
| WhatsApp send | 25s |
| Media download | 30s / 50 MB |
| Idle close after **send** | 20s |
| Idle close after **status probe** | 3s |
| QR pairing socket max | 90s |

### 3.6 Phone numbers

- Digits + country code, no `+` / spaces. Example: `919876543210`  
- Or full JID: `919876543210@s.whatsapp.net`  

### 3.7 Status probe values (`GET /sessions/{id}`)

| `data.status` | Meaning |
|---|---|
| `ready` | Live connect succeeded — login works |
| `connecting` | QR pairing still in progress |
| `needs_qr` | Not linked / logged out — show QR |
| `unreachable` | Files exist but WhatsApp did not connect in time |

| `data.socket` | Meaning |
|---|---|
| `idle` | No socket open (normal most of the time) |
| `connecting` | Opening |
| `connected` | Open right now (probe or send) |

**Do not poll status.** Each call opens a WhatsApp socket for ~3s. Use only when the user taps “Check connection”.

---

## 4. When a session is removed

### Socket closes (login kept)

- After send (~20s idle)  
- After status (~3s idle)  
- After QR wait with no activity (~90s)  
- Temporary WhatsApp drop  

Next send/status reconnects **without** QR.

### Login deleted (need new QR)

| Cause | How you see it |
|---|---|
| `DELETE /sessions/{id}` | Log: `🗑️ Removing session` |
| WhatsApp logged out / unlinked device | Log: `🚫 Session permanently logged out` |
| Replaced / conflict | Same logout cleanup |
| Same phone linked under another session ID | Old session files removed |

**Long inactivity does not delete the session.**

---

## 5. Recommended client flows

### 5.1 First-time link (QR)

```text
1. POST /sessions   (empty body or {})
   Headers: x-api-key: YOUR_API_KEY
2. Save data.session from the response (e.g. A7K2M9)
3. Poll GET /sessions/{session}/qr every 1–2s (same header)
4. Show data.qr image (add ?t=timestamp to avoid cache)
5. User scans in WhatsApp → Linked devices
6. After scan, WhatsApp may briefly disconnect with code **515 (restart required)**. The server reconnects automatically to finish pairing. Wait until the phone shows the device as linked (can take a few seconds). Do not create a new session while that is happening.
7. When QR returns 404 after a successful link → stop; device is linked
8. Do NOT poll GET /sessions/{session} during QR
```

### 5.2 Send message

```text
POST /sessions/{savedSession}/messages
Headers: x-api-key: YOUR_API_KEY
{ "phone": "919876543210", "message": "Hello" }
```

No status check first. Server connects → sends → disconnects.

### 5.3 Check connection (optional)

```text
User taps "Check connection"
→ GET /sessions/{savedSession}
→ data.status === "ready" → OK
```

### 5.4 Unlink

```text
DELETE /sessions/{savedSession}
```

---

## 6. Endpoints

All examples include the API key header.

### 6.1 Server info — `GET /`

```bash
curl -X GET "https://whatsappweb.onesaas.in/" \
  -H "x-api-key: YOUR_API_KEY"
```

```json
{
  "success": true,
  "message": "WhatsApp API Server is running",
  "data": {
    "version": "1.2.0",
    "mode": "on-demand",
    "baileys": "6.7.18",
    "timestamp": "2026-08-13T16:00:00.000Z"
  }
}
```

---

### 6.2 Health — `GET /health`

```bash
curl -X GET "https://whatsappweb.onesaas.in/health" \
  -H "x-api-key: YOUR_API_KEY"
```

```json
{
  "success": true,
  "message": "Service is healthy",
  "data": {
    "status": "ok",
    "timestamp": "2026-08-13T16:00:00.000Z",
    "sessions": {
      "linked": 12,
      "sockets": 0,
      "connected": 0,
      "connecting": 0,
      "idle": 12
    }
  }
}
```

---

### 6.3 Create session — `POST /sessions`

Creates a new session. **Do not send `session` in the body.** The server generates a unique 6-character id and returns it.

**Headers:** `x-api-key: YOUR_API_KEY`  
**Body:** none required (`{}` is fine)

```bash
curl -X POST "https://whatsappweb.onesaas.in/sessions" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d "{}"
```

**Success — `201`**

```json
{
  "success": true,
  "message": "Session started",
  "data": {
    "session": "A7K2M9",
    "linked": false,
    "qrEndpoint": "/sessions/A7K2M9/qr"
  }
}
```

| Field | Description |
|---|---|
| `data.session` | **Store this.** Use in all later API paths |
| `data.linked` | Always `false` for a brand-new id |
| `data.qrEndpoint` | Relative path to fetch QR |

| HTTP | Code |
|---|---|
| `401` | `UNAUTHORIZED` |
| `500` | `INTERNAL_ERROR` |

---

### 6.4 Get QR — `GET /sessions/{session}/qr`

Poll during pairing only. Use the session id returned from create.

```bash
curl -X GET "https://whatsappweb.onesaas.in/sessions/A7K2M9/qr" \
  -H "x-api-key: YOUR_API_KEY"
```

**Success — `200`**

```json
{
  "success": true,
  "message": "Scan this QR code within 60 seconds",
  "data": {
    "session": "A7K2M9",
    "qr": "https://whatsappweb.onesaas.in/qrs/A7K2M9.png"
  }
}
```

The PNG URL itself does **not** need `x-api-key` (for `<img src>`).

| HTTP | Code |
|---|---|
| `401` | `UNAUTHORIZED` |
| `404` | `QR_NOT_FOUND` |

---

### 6.5 Get session status — `GET /sessions/{session}`

Live probe. Do not poll.

```bash
curl -X GET "https://whatsappweb.onesaas.in/sessions/A7K2M9" \
  -H "x-api-key: YOUR_API_KEY"
```

**Success — `200`**

```json
{
  "success": true,
  "message": "Session can connect to WhatsApp",
  "data": {
    "session": "A7K2M9",
    "status": "ready",
    "linked": true,
    "hasValidFiles": true,
    "socket": "connected",
    "user": {
      "id": "917364076458:60@s.whatsapp.net",
      "name": null
    },
    "lastError": null
  }
}
```

---

### 6.6 Reconnect — `POST /sessions/{session}/reconnect`

Same as status probe. Prefer `GET /sessions/{session}`.

```bash
curl -X POST "https://whatsappweb.onesaas.in/sessions/A7K2M9/reconnect" \
  -H "x-api-key: YOUR_API_KEY"
```

---

### 6.7 Remove session — `DELETE /sessions/{session}`

```bash
curl -X DELETE "https://whatsappweb.onesaas.in/sessions/A7K2M9" \
  -H "x-api-key: YOUR_API_KEY"
```

```json
{
  "success": true,
  "message": "Session removed",
  "data": { "session": "A7K2M9" }
}
```

---

### 6.8 Send text — `POST /sessions/{session}/messages`

```bash
curl -X POST "https://whatsappweb.onesaas.in/sessions/A7K2M9/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d "{\"phone\":\"919876543210\",\"message\":\"Hello\"}"
```

**Body:** `phone`, `message` (required)

**Success — `200`**

```json
{
  "success": true,
  "message": "Message sent",
  "data": {
    "session": "A7K2M9",
    "phone": "919876543210",
    "messageId": "3EB0XXXXXXXXXXXX",
    "timestamp": "2026-08-13T16:00:00.000Z"
  }
}
```

| HTTP | Code |
|---|---|
| `400` | `MISSING_PARAMETER` |
| `401` | `UNAUTHORIZED` |
| `404` | `NEEDS_QR` / `SESSION_NOT_FOUND` |
| `504` | `CONNECT_TIMEOUT` |
| `500` | `INTERNAL_ERROR` |

---

### 6.9 Send media — `POST /sessions/{session}/messages/media`

**Body**

| Field | Required | Notes |
|---|---|---|
| `phone` | Yes | |
| `file` | Yes | Public URL the API server can download |
| `caption` | No | |
| `message` | No | Alias for caption |
| `fileName` | No | |
| `file_name` | No | Alias for fileName |

```bash
curl -X POST "https://whatsappweb.onesaas.in/sessions/A7K2M9/messages/media" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d "{\"phone\":\"919876543210\",\"file\":\"https://cdn.example.com/a.jpg\",\"caption\":\"Photo\"}"
```

---

### 6.10 Mark as read — `POST /sessions/{session}/messages/read`

**Body:** `messageId`, `phone`

```bash
curl -X POST "https://whatsappweb.onesaas.in/sessions/A7K2M9/messages/read" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d "{\"messageId\":\"3EB0XXXXXXXXXXXX\",\"phone\":\"919876543210\"}"
```

---

## 7. Endpoint summary

| Method | Path | Auth | Opens WhatsApp? | Purpose |
|---|---|---|---|---|
| `GET` | `/` | `x-api-key` | No | Server info |
| `GET` | `/health` | `x-api-key` | No | Health |
| `POST` | `/sessions` | `x-api-key` | Yes (QR) | Create session (auto id) |
| `GET` | `/sessions/{id}/qr` | `x-api-key` | No | QR JSON URL |
| `GET` | `/sessions/{id}` | `x-api-key` | Yes (~3s) | Status probe |
| `POST` | `/sessions/{id}/reconnect` | `x-api-key` | Yes (~3s) | Status probe |
| `DELETE` | `/sessions/{id}` | `x-api-key` | Closes + deletes | Remove login |
| `POST` | `/sessions/{id}/messages` | `x-api-key` | Yes (~20s) | Send text |
| `POST` | `/sessions/{id}/messages/media` | `x-api-key` | Yes (~20s) | Send media |
| `POST` | `/sessions/{id}/messages/read` | `x-api-key` | Yes (~20s) | Mark read |
| `GET` | `/qrs/{id}.png` | **None** | No | Raw QR image |

---

## 8. Client rules

1. Always send `x-api-key: YOUR_API_KEY` on API calls.  
2. Always send `Content-Type: application/json` on POST with a body.  
3. On create, **do not** send `session` — save `data.session` from the response.  
4. Session id is 6 chars: uppercase letters + digits.  
5. Send anytime for a linked session — no status first.  
6. Poll QR only during pairing — never poll status in that loop.  
7. Status = user button only, not a timer.  
8. Idle disconnect is normal; it does not expire the login.  
9. Do not wipe `sessions/` on deploy.  

---

## 9. Worked example

```bash
BASE=https://whatsappweb.onesaas.in
KEY="x-api-key: YOUR_API_KEY"

# Create (server returns session id)
CREATE=$(curl -s -X POST "$BASE/sessions" -H "Content-Type: application/json" -H "$KEY" -d "{}")
echo "$CREATE"
# { "data": { "session": "A7K2M9", ... } }

SESSION=A7K2M9   # use the value from CREATE

# QR
curl -s -X GET "$BASE/sessions/$SESSION/qr" -H "$KEY"

# Send
curl -s -X POST "$BASE/sessions/$SESSION/messages" \
  -H "Content-Type: application/json" -H "$KEY" \
  -d '{"phone":"919876543210","message":"Test message"}'

# Optional check
curl -s -X GET "$BASE/sessions/$SESSION" -H "$KEY"

# Unlink
curl -s -X DELETE "$BASE/sessions/$SESSION" -H "$KEY"
```

---

## 10. Troubleshooting

| Situation | Action |
|---|---|
| `401 UNAUTHORIZED` | Send header `x-api-key: YOUR_API_KEY` |
| QR `404` right after create | Wait 1–2s and poll QR again |
| Phone says internet unstable after scan | Normal during pairing: wait for server log `🔁 Restart required` then `✅ Session connected`. Do not create a new session. |
| Log `515` / `restart required` | Expected after scan; server auto-reconnects to finish login |
| QR `404` after successful link | Linked — stop QR UI |
| Send `NEEDS_QR` | Create a new session and scan QR |
| Forgot session id | Cannot recover from API — store `data.session` when creating |
| Status then idle in logs | Normal on-demand behaviour |

---

## 11. Breaking changes

- `POST /sessions` no longer accepts `session` in the body. The server generates it.  
- All JSON APIs require `x-api-key: YOUR_API_KEY`.  
- Old query-string GET APIs are removed.  
- Always-on restore-on-boot is removed.
