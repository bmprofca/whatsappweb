import { getPool } from '../../config/database.js';

/**
 * Run a database query
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<import('mysql2/promise').RowDataPacket[]>}
 */
export async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

/**
 * Run a database query and return first row
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<object | null>}
 */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/**
 * Run an insert/update/delete query
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<import('mysql2/promise').ResultSetHeader>}
 */
export async function execute(sql, params = []) {
  const [result] = await getPool().execute(sql, params);
  return result;
}
