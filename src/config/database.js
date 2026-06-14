import mysql from 'mysql2/promise';

import { formatDbError, initializeDatabase } from '../database/migrate.js';

import env from './env.js';
import logger from './logger.js';

/** @type {mysql.Pool | null} */
let pool = null;

/**
 * Get or create MySQL connection pool
 * @returns {mysql.Pool}
 */
export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      database: env.db.database,
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });
  }
  return pool;
}

/**
 * Test database connection
 * @returns {Promise<boolean>}
 */
export async function testConnection() {
  try {
    const connection = await getPool().getConnection();
    await connection.ping();
    connection.release();
    logger.info('Database connection established');
    return true;
  } catch (error) {
    logger.error('Database connection failed', formatDbError(error));
    throw error;
  }
}

/**
 * Close database pool
 * @returns {Promise<void>}
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database pool closed');
  }
}

export { initializeDatabase };
export default { getPool, testConnection, closePool, initializeDatabase };
