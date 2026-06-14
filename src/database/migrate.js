import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import mysql from 'mysql2/promise';

import env from '../config/env.js';
import logger from '../config/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

/**
 * Format database error for logging
 * @param {Error} error
 * @returns {object}
 */
export function formatDbError(error) {
  return {
    message: error.message || 'Unknown database error',
    code: error.code,
    errno: error.errno,
    sqlState: error.sqlState,
    sqlMessage: error.sqlMessage,
    host: env.db.host,
    port: env.db.port,
    database: env.db.database,
  };
}

/**
 * Run pending database migrations
 * @returns {Promise<void>}
 */
export async function runMigrations() {
  const connection = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
  });

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${env.db.database}\``);
    await connection.query(`USE \`${env.db.database}\``);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [executed] = await connection.query('SELECT name FROM migrations');
    const executedSet = new Set(executed.map((row) => row.name));

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (executedSet.has(file)) {
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      logger.info(`Running migration: ${file}`);

      await connection.query(sql);
      await connection.query('INSERT INTO migrations (name) VALUES (?)', [file]);

      logger.info(`Migration completed: ${file}`);
    }

    logger.info('Database migrations up to date');
  } finally {
    await connection.end();
  }
}

/**
 * Initialize database: create DB and run migrations
 * @returns {Promise<void>}
 */
export async function initializeDatabase() {
  try {
    await runMigrations();
  } catch (error) {
    const details = formatDbError(error);
    logger.error('Database initialization failed', details);

    const hint =
      error.code === 'ECONNREFUSED'
        ? `Cannot connect to MySQL at ${env.db.host}:${env.db.port}. Start MySQL and check your .env credentials.`
        : error.code === 'ER_ACCESS_DENIED_ERROR'
          ? `MySQL access denied for user "${env.db.user}". Check DB_USER and DB_PASSWORD in .env.`
          : 'Ensure MySQL is running and .env database settings are correct.';

    throw new Error(`${hint} (${details.message || error.code || 'connection failed'})`);
  }
}

// Allow running directly: node src/database/migrate.js
const isDirectRun = process.argv[1]?.includes('migrate.js');
if (isDirectRun) {
  initializeDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
