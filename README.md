# WhatsApp Multi-Session Server

Production-ready Node.js WhatsApp API server supporting multiple concurrent WhatsApp sessions using Express.js, Baileys, MySQL, and Socket.IO.

## Features

- **Multi-session support** — Run multiple WhatsApp accounts simultaneously
- **QR & Pairing Code login** — Two authentication methods
- **Auto reconnect** — Automatic reconnection with exponential backoff
- **Session persistence** — Survives server restarts via filesystem + MySQL backup
- **Webhooks** — Per-session webhook URLs with 3-retry delivery
- **Socket.IO** — Real-time events for frontend dashboards
- **Message APIs** — Send text, image, document, audio, video, location
- **Production ready** — Git deploy, graceful shutdown, health checks

## Tech Stack

- Node.js 20+ (LTS)
- Express.js
- [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)
- MySQL
- Socket.IO
- Winston Logger
- Joi Validation

## Quick Start

### Prerequisites

- Node.js 20+
- MySQL 8.0+

### Local Development

```bash
git clone https://github.com/bmprofca/whatsappweb.git
cd whatsappweb
npm install

cp .env.example .env
# Set NODE_ENV=development and your DB credentials in .env

npm start
```

For auto-reload during development:

```bash
npm run dev
```

### Production Deployment (Git)

On your live server, pull from git and run with `NODE_ENV=production`.

```bash
git clone https://github.com/bmprofca/whatsappweb.git
cd whatsappweb
npm install --production

cp .env.example .env
```

Edit `.env` on the **live server** (this file is not in git):

```env
NODE_ENV=production
PORT=3000
BASE_URL=https://whatsappweb.onesaasbackend.com

DB_HOST=your_db_host
DB_PORT=3306
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_db_name

API_KEY=your_strong_api_key
CORS_ORIGIN=https://your-frontend-domain.com
```

Start the server:

```bash
npm start
```

Database tables are created automatically on first start.

### Environment: Local vs Production

| Setting | Local (your machine) | Live server |
|---------|----------------------|-------------|
| `NODE_ENV` | `development` | `production` |
| `BASE_URL` | `http://localhost:5677` | `https://whatsappweb.onesaasbackend.com` |
| Console logs | Enabled | Disabled (file logs only) |
| API_KEY | Optional | **Required** |
| Migrations | Auto on startup | Auto on startup |

**Local `.env` example:**

```env
NODE_ENV=development
PORT=5677
BASE_URL=http://localhost:5677
```

**Production `.env` example:**

```env
NODE_ENV=production
BASE_URL=https://whatsappweb.onesaasbackend.com
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Runtime mode (`development` or `production`) | `development` |
| `PORT` | Server port | `5677` (local), `3000` (production) |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | MySQL user | `root` |
| `DB_PASSWORD` | MySQL password | — |
| `DB_NAME` | Database name | `whatsapp_server` |
| `API_KEY` | API authentication key | — |
| `BASE_URL` | Server base URL | `http://localhost:5677` |
| `CORS_ORIGIN` | CORS allowed origins | `*` |

## Authentication

All `/api/*` endpoints require the `X-API-Key` header:

```bash
curl -H "X-API-Key: your_api_key_here" http://localhost:5677/api/sessions
```

## API Overview

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sessions/create` | Create new session |
| GET | `/api/sessions` | List all sessions |
| GET | `/api/sessions/:id` | Get session details |
| GET | `/api/sessions/:id/qr` | Get QR code (base64 data URL) |
| POST | `/api/sessions/:id/pairing-code` | Request pairing code |
| DELETE | `/api/sessions/:id` | Delete session |
| PUT | `/api/sessions/:id/webhook` | Update webhook URL |

### Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/messages/send-text` | Send text message |
| POST | `/api/messages/send-image` | Send image |
| POST | `/api/messages/send-document` | Send document |
| POST | `/api/messages/send-audio` | Send audio |
| POST | `/api/messages/send-video` | Send video |
| POST | `/api/messages/send-location` | Send location |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health & session stats |

See [docs/API.md](docs/API.md) for full API documentation.

## Socket.IO Events

Connect to `ws://localhost:5677` (local) or `wss://whatsappweb.onesaasbackend.com` (production) for real-time events.

| Event | Description |
|-------|-------------|
| `qr.updated` | New QR code available |
| `pairing.code` | Pairing code generated |
| `session.connected` | Session connected |
| `session.disconnected` | Session disconnected |
| `session.connecting` | Session connecting |
| `message.received` | Incoming message |
| `message.sent` | Outgoing message |

See [docs/SOCKET.IO.md](docs/SOCKET.IO.md) for full Socket.IO documentation.

## Project Structure

```
server.js                   # Entry point
src/
├── app.js                  # Express app setup
├── config/                 # Environment, database, logger
├── routes/                 # API route definitions
├── controllers/            # Request handlers
├── services/               # Business logic
│   └── session.manager.js  # Centralized SessionManager (singleton)
├── sockets/                # Socket.IO handlers
├── middlewares/            # Auth, validation, error handling
├── validators/             # Joi schemas
├── database/               # Migrations and models
├── storage/sessions/       # Baileys auth state files
└── jobs/                   # Background jobs (reconnect)
```

## Webhooks

Configure a webhook URL per session. The server sends POST requests for:

- `message.received`
- `message.sent`
- `session.connected`
- `session.disconnected`

Failed webhooks are retried 3 times with exponential backoff. All deliveries are logged in `webhook_logs` table.

## License

MIT
