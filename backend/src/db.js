
import sql from 'mssql';
import { config } from './config.js';

const sqlConfig = {
  user: config.sql.user,
  password: config.sql.password,
  server: config.sql.server,
  port: 1433,
  database: config.sql.database,

  options: {
    encrypt: false,
    trustServerCertificate: true,
    tdsVersion: '7_3_B'
  },

  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },

  connectionTimeout: 15000,
  requestTimeout: 30000
};

let pool;

export async function getPool() {
  if (!pool) {
    pool = await sql.connect(sqlConfig);
  }

  return pool;
}

export { sql };
