# Socket.IO Documentation

Connect to the server via Socket.IO for real-time WhatsApp session and message updates.

## Connection

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:5677', {
  transports: ['websocket', 'polling'],
});
```

### React Example

```jsx
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

function WhatsAppDashboard() {
  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState('disconnected');
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const socket = io('http://localhost:5677');

    socket.on('connect', () => {
      console.log('Connected to server');
      socket.emit('join:session', 'session1');
    });

    socket.on('qr.updated', (data) => {
      if (data.sessionId === 'session1') setQr(data.qr);
    });

    socket.on('session.connected', (data) => {
      if (data.sessionId === 'session1') {
        setStatus('connected');
        setQr(null);
      }
    });

    socket.on('session.disconnected', (data) => {
      if (data.sessionId === 'session1') setStatus('disconnected');
    });

    socket.on('message.received', (data) => {
      setMessages((prev) => [data, ...prev]);
    });

    return () => socket.disconnect();
  }, []);

  return (
    <div>
      <p>Status: {status}</p>
      {qr && <img src={qr} alt="QR Code" width={256} />}
      <ul>
        {messages.map((m) => (
          <li key={m.messageId}>{m.messageText}</li>
        ))}
      </ul>
    </div>
  );
}
```

---

## Client → Server Events

### join:session

Join a session room to receive session-specific events.

```javascript
socket.emit('join:session', 'session1');
```

**Response:** `session.joined`

```json
{ "sessionId": "session1" }
```

---

### leave:session

Leave a session room.

```javascript
socket.emit('leave:session', 'session1');
```

---

### sessions:stats

Request current session statistics.

```javascript
socket.emit('sessions:stats');
```

**Response:** `sessions.stats`

```json
{
  "total": 5,
  "connected": 3,
  "connecting": 1,
  "disconnected": 1,
  "qr": 0,
  "pairing": 0,
  "reconnectQueue": 0
}
```

---

## Server → Client Events

### qr.updated

Emitted when a new QR code is generated for a session.

```json
{
  "sessionId": "session1",
  "qr": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

**Usage:** Display the `qr` value directly in an `<img src={qr} />` element.

QR codes expire periodically. A new `qr.updated` event is emitted when refreshed.

---

### pairing.code

Emitted when a pairing code is generated.

```json
{
  "sessionId": "session1",
  "pairingCode": "ABCD-EFGH",
  "phone": "919999999999"
}
```

---

### session.connecting

Emitted when a session begins connecting.

```json
{
  "sessionId": "session1",
  "status": "connecting"
}
```

---

### session.connected

Emitted when a session successfully connects to WhatsApp.

```json
{
  "sessionId": "session1",
  "status": "connected",
  "phone": "919999999999",
  "displayName": "John Doe"
}
```

---

### session.disconnected

Emitted when a session disconnects.

```json
{
  "sessionId": "session1",
  "status": "disconnected",
  "reason": 428
}
```

| reason | Description |
|--------|-------------|
| 401 | Logged out |
| 428 | Connection closed |
| 515 | Restart required (auto-reconnects) |

---

### message.received

Emitted when an incoming message is received.

```json
{
  "sessionId": "session1",
  "messageId": "3EB0XXXX",
  "direction": "IN",
  "sender": "919999999999",
  "receiver": "918888888888",
  "messageType": "text",
  "messageText": "Hello!",
  "timestamp": 1718361600,
  "mediaUrl": null,
  "raw": {
    "remoteJid": "919999999999@s.whatsapp.net",
    "fromMe": false
  }
}
```

**Message Types:** `text`, `image`, `video`, `audio`, `document`, `sticker`, `contact`, `location`

---

### message.sent

Emitted when an outgoing message is sent (via API or from linked phone).

```json
{
  "sessionId": "session1",
  "messageId": "3EB0YYYY",
  "direction": "OUT",
  "sender": "918888888888",
  "receiver": "919999999999",
  "messageType": "text",
  "messageText": "Hello from API!",
  "timestamp": 1718361700,
  "mediaUrl": null,
  "raw": {
    "remoteJid": "919999999999@s.whatsapp.net",
    "fromMe": true
  }
}
```

---

### session.joined

Confirmation that client joined a session room.

```json
{ "sessionId": "session1" }
```

---

### sessions.stats

Response to `sessions:stats` request (see above).

---

## Room-Based Filtering

Events are broadcast globally AND to session-specific rooms.

- **Global broadcast:** All connected clients receive all events
- **Room broadcast:** Clients that joined `session:session1` also receive events in that room

**Best practice:** Always `join:session` for the sessions you care about, then filter by `sessionId` in your handler.

```javascript
socket.emit('join:session', 'session1');

socket.on('message.received', (data) => {
  if (data.sessionId !== 'session1') return;
  console.log('New message:', data.messageText);
});
```

---

## Connection Lifecycle Example

```javascript
const socket = io('http://localhost:5677');
const SESSION_ID = 'session1';

socket.on('connect', () => {
  socket.emit('join:session', SESSION_ID);
});

// Step 1: Session created via API → session.connecting
socket.on('session.connecting', (data) => {
  console.log('Connecting...', data.sessionId);
});

// Step 2: QR generated → display to user
socket.on('qr.updated', (data) => {
  document.getElementById('qr').src = data.qr;
});

// Step 3: User scans QR → connected
socket.on('session.connected', (data) => {
  document.getElementById('qr').style.display = 'none';
  console.log('Connected as', data.phone);
});

// Step 4: Handle messages
socket.on('message.received', (data) => {
  console.log(`[${data.messageType}] ${data.sender}: ${data.messageText}`);
});

// Handle disconnection
socket.on('session.disconnected', (data) => {
  console.log('Disconnected, reason:', data.reason);
  // Server auto-reconnects unless logged out
});
```

---

## CORS Configuration

Socket.IO CORS is configured via the `CORS_ORIGIN` environment variable.

```env
# Allow all origins
CORS_ORIGIN=*

# Allow specific origins (comma-separated)
CORS_ORIGIN=http://localhost:3001,https://myapp.com
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Not receiving events | Ensure you've called `join:session` with correct session ID |
| QR not updating | Listen to `qr.updated` instead of polling `/api/sessions/:id/qr` |
| Connection drops | Server auto-reconnects; watch `session.disconnected` → `session.connected` |
| CORS errors | Set `CORS_ORIGIN` to your frontend URL |
