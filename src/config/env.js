import dotenv from 'dotenv';
import os from 'os';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

const env = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv,
  isProduction,
  isDevelopment: !isProduction,
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  serverId: process.env.SERVER_ID || process.env.BASE_URL || os.hostname(),
  apiKey: process.env.API_KEY || '',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'whatsapp_server',
  },
  webhook: {
    maxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES || '3', 10),
    retryDelayMs: parseInt(process.env.WEBHOOK_RETRY_DELAY_MS || '2000', 10),
  },
  reconnect: {
    delayMs: parseInt(process.env.RECONNECT_DELAY_MS || '5000', 10),
    maxAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS || '10', 10),
  },
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

/**
 * Validate required production environment variables
 */
function validateProductionEnv() {
  if (!isProduction) return;

  const missing = [];

  if (!env.apiKey || env.apiKey === 'your_api_key_here') {
    missing.push('API_KEY');
  }

  if (!env.baseUrl || env.baseUrl.includes('localhost')) {
    missing.push('BASE_URL (must be your live domain)');
  }

  if (!env.db.host || !env.db.user || !env.db.database) {
    missing.push('DB_HOST, DB_USER, DB_NAME');
  }

  if (missing.length > 0) {
    throw new Error(
      `Production environment misconfigured. Set these in .env: ${missing.join(', ')}`,
    );
  }
}

validateProductionEnv();

export default env;
