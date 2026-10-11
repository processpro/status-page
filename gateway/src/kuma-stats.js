'use strict';

const fs = require('fs');
const { normalizeWindow, WINDOWS } = require('./history');

const TABLE_BY_WINDOW = {
  '1h': 'stat_minutely',
  '24h': 'stat_minutely',
  '7d': 'stat_hourly',
};

let statCache = { key: '', value: null };
let monitorCache = { at: 0, value: null };
let mysqlPool = null;

function dbPath() {
  if (process.env.KUMA_DB_PATH) {
    return process.env.KUMA_DB_PATH;
  }
  // Prefer MySQL whenever it is configured. Never probe kuma.db on Azure Files
  // in production — existsSync/sqlite on that share blocks the event loop.
  if (process.env.UPTIME_KUMA_DB_HOSTNAME) {
    return null;
  }
  if (fs.existsSync('/app/data/kuma.db')) {
    return '/app/data/kuma.db';
  }
  return null;
}

function loadMysql() {
  const paths = ['mysql2/promise', '/app/node_modules/mysql2/promise'];
  for (const candidate of paths) {
    try {
      return require(candidate);
    } catch {
      // Try the next location. Production uses Kuma's bundled mysql2.
    }
  }
  return null;
}

function mysqlSettings() {
  const fromEnv = process.env.UPTIME_KUMA_DB_HOSTNAME;
  if (fromEnv) {
    const ssl = String(process.env.UPTIME_KUMA_DB_SSL || '').toLowerCase() === 'true';
    const caFile = process.env.UPTIME_KUMA_DB_CA_FILE;
    const settings = {
      host: fromEnv,
      port: Number(process.env.UPTIME_KUMA_DB_PORT || 3306),
      user: process.env.UPTIME_KUMA_DB_USERNAME,
      password: process.env.UPTIME_KUMA_DB_PASSWORD,
      database: process.env.UPTIME_KUMA_DB_NAME || 'kuma',
    };
    if (ssl) {
      settings.ssl = { rejectUnauthorized: true };
      if (caFile && fs.existsSync(caFile)) {
        settings.ssl.ca = fs.readFileSync(caFile, 'utf8');
      }
    }
    return settings;
  }
  const configPath = '/app/data/db-config.json';
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.type !== 'mariadb' || !config.hostname) {
      return null;
    }
    const settings = {
      host: config.hostname,
      port: Number(config.port || 3306),
      user: config.username,
      password: config.password,
      database: config.dbName || config.database || 'kuma',
    };
    if (config.ssl) {
      settings.ssl = { rejectUnauthorized: true };
      if (config.ca) {
        settings.ssl.ca = config.ca;
      }
    }
    return settings;
  } catch {
    return null;
  }
}

async function getMysqlPool() {
  if (mysqlPool) {
    return mysqlPool;
  }
  const mysql = loadMysql();
  const settings = mysqlSettings();
  if (!mysql || !settings) {
    return null;
  }
  mysqlPool = mysql.createPool({
    ...settings,
    waitForConnections: true,
    connectionLimit: 2,
    enableKeepAlive: true,
    connectTimeout: 4000,
  });
  return mysqlPool;
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

async function queryMysql(sql, params = []) {
  const pool = await getMysqlPool();
  if (!pool) {
    return [];
  }
  const [rows] = await withTimeout(pool.query(sql, params), 4000, 'MySQL query');
  return rows || [];
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '';
    }
    const pathname = url.pathname.replace(/\/$/, '');
    return `${url.hostname.toLowerCase()}${pathname}`;
  } catch {
    return '';
  }
}

function queryWithKuma(file, sql) {
  const { execFileSync } = require('child_process');
  const code = [
    "const sqlite3 = require('/app/node_modules/@louislam/sqlite3');",
    'const db = new sqlite3.Database(process.argv[1], sqlite3.OPEN_READONLY);',
    'db.all(process.argv[2], (err, rows) => {',
    '  if (err) { console.error(err.message); process.exit(1); }',
    '  process.stdout.write(JSON.stringify(rows || []));',
    '  db.close();',
    '});',
  ].join('\n');
  const output = execFileSync(process.execPath, ['-e', code, file, sql], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 20000,
  });
  return output.trim() ? JSON.parse(output) : [];
}

function queryCli(file, sql, columns) {
  const { execFileSync } = require('child_process');
  const output = execFileSync('sqlite3', ['-readonly', file, sql], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 20000,
  });
  if (!output.trim()) {
    return [];
  }
  return output.trim().split('\n').map((line) => {
    const parts = line.split('|');
    const row = {};
    columns.forEach((name, index) => {
      row[name] = parts[index] === '' ? null : parts[index];
    });
    return row;
  });
}

function queryRows(file, sql, columns) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  } catch (error) {
    if (error.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') {
      throw error;
    }
  }
  return [];
}

function heartbeatRows(file, ids, startSec) {
  const startIso = new Date(startSec * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const list = ids.join(',');
  let raw = [];
  try {
    raw = queryRows(
      file,
      `SELECT monitor_id, time, status, ping FROM heartbeat WHERE monitor_id IN (${list}) AND time >= '${startIso}' ORDER BY time`,
      ['monitor_id', 'time', 'status', 'ping']
    );
  } catch {
    return [];
  }
  return raw.flatMap((row) => {
    const parsed = Date.parse(`${String(row.time).replace(' ', 'T').replace(/Z$/, '')}Z`);
    if (Number.isNaN(parsed)) {
      return [];
    }
    const up = row.status === 1 || row.status === 3 ? 1 : 0;
    const down = row.status === 0 ? 1 : 0;
    if (!up && !down) {
      return [];
    }
    return [{
      monitor_id: Number(row.monitor_id),
      timestamp: Math.floor(parsed / 1000),
      up,
      down,
      ping: row.ping,
    }];
  });
}

function indexMonitorUrls(rows) {
  const index = new Map();
  for (const row of rows) {
    const key = normalizeUrl(row.url);
    if (key && !index.has(key)) {
      index.set(key, Number(row.id));
    }
  }
  return index;
}

async function monitorUrls(now = Date.now()) {
  if (monitorCache.value && now - monitorCache.at < 60000) {
    return monitorCache.value;
  }
  const file = dbPath();
  let rows = [];
  if (file) {
    rows = queryRows(
      file,
      "SELECT id, url FROM monitor WHERE active = 1 AND url LIKE 'http%'",
      ['id', 'url']
    );
  } else {
    try {
      rows = await queryMysql(
        "SELECT id, url FROM monitor WHERE active = 1 AND url LIKE 'http%'"
      );
    } catch (error) {
      console.error('Kuma MySQL monitor lookup failed:', error.message);
      rows = [];
    }
  }
  const index = indexMonitorUrls(rows);
  monitorCache = { at: now, value: index };
  return index;
}

function groupStatRows(ids, rows) {
  const grouped = {};
  for (const id of ids) {
    grouped[id] = [];
  }
  for (const row of rows) {
    const up = Number(row.up) || 0;
    const down = Number(row.down) || 0;
    const monitorId = Number(row.monitor_id);
    if (!grouped[monitorId]) {
      grouped[monitorId] = [];
    }
    grouped[monitorId].push({
      t: Number(row.timestamp) > 1e12 ? Number(row.timestamp) : Number(row.timestamp) * 1000,
      up,
      down,
      ok: down > 0 ? 0 : up > 0 ? 1 : 0,
      ms: row.ping == null ? null : Number(row.ping),
      code: null,
    });
  }
  return grouped;
}

async function mysqlHeartbeatRows(ids, startSec) {
  const startIso = new Date(startSec * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const placeholders = ids.map(() => '?').join(',');
  const raw = await queryMysql(
    `SELECT monitor_id, time, status, ping FROM heartbeat WHERE monitor_id IN (${placeholders}) AND time >= ? ORDER BY time`,
    [...ids, startIso]
  );
  return raw.flatMap((row) => {
    const parsed = Date.parse(`${String(row.time).replace(' ', 'T').replace(/Z$/, '')}Z`);
    if (Number.isNaN(parsed)) {
      return [];
    }
    const up = row.status === 1 || row.status === 3 ? 1 : 0;
    const down = row.status === 0 ? 1 : 0;
    if (!up && !down) {
      return [];
    }
    return [{
      monitor_id: Number(row.monitor_id),
      timestamp: Math.floor(parsed / 1000),
      up,
      down,
      ping: row.ping,
    }];
  });
}

async function samplesByKumaId(monitorIds, windowKey, now = Date.now()) {
  const key = normalizeWindow(windowKey);
  const ids = [...new Set(monitorIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) {
    return {};
  }
  const file = dbPath();
  const source = file || process.env.UPTIME_KUMA_DB_HOSTNAME || 'mysql';
  const cacheKey = `${source}|${key}|${ids.slice().sort((a, b) => a - b).join(',')}|${Math.floor(now / 20000)}`;
  if (statCache.key === cacheKey && statCache.value) {
    return statCache.value;
  }
  const table = TABLE_BY_WINDOW[key];
  if (!table) {
    return {};
  }
  const start = Math.floor((now - WINDOWS[key]) / 1000);
  let rows = [];
  if (file) {
    const list = ids.join(',');
    rows = queryRows(
      file,
      `SELECT monitor_id, timestamp, up, down, ping FROM ${table} WHERE monitor_id IN (${list}) AND timestamp >= ${start} ORDER BY timestamp`,
      ['monitor_id', 'timestamp', 'up', 'down', 'ping']
    );
    if (!rows.length) {
      rows = heartbeatRows(file, ids, start);
    }
  } else {
    try {
      const placeholders = ids.map(() => '?').join(',');
      rows = await queryMysql(
        `SELECT monitor_id, timestamp, up, down, ping FROM ${table} WHERE monitor_id IN (${placeholders}) AND timestamp >= ? ORDER BY timestamp`,
        [...ids, start]
      );
      if (!rows.length) {
        rows = await mysqlHeartbeatRows(ids, start);
      }
    } catch (error) {
      console.error('Kuma MySQL history unavailable:', error.message);
      rows = [];
    }
  }
  const grouped = groupStatRows(ids, rows);
  statCache = { key: cacheKey, value: grouped };
  return grouped;
}

function describeKumaHistory() {
  const file = dbPath();
  if (!file) {
    console.error('Kuma database was not found');
    return;
  }
  const rows = queryRows(
    file,
    'SELECT (SELECT COUNT(*) FROM stat_minutely) AS minutely, (SELECT COUNT(*) FROM stat_hourly) AS hourly, (SELECT MIN(timestamp) FROM stat_minutely) AS minute_min, (SELECT MAX(timestamp) FROM stat_minutely) AS minute_max',
    ['minutely', 'hourly', 'minute_min', 'minute_max']
  );
  const row = rows[0] || {};
  console.log(`Kuma history tables: minutely ${row.minutely}, hourly ${row.hourly}, minute range ${row.minute_min} to ${row.minute_max}`);
}

async function samplesForCatalog(monitors, windowKey, now = Date.now()) {
  const index = await monitorUrls(now);
  const pairs = [];
  for (const monitor of monitors) {
    const kumaId = index.get(normalizeUrl(monitor.url));
    if (kumaId) {
      pairs.push([monitor.id, kumaId]);
    }
  }
  const stats = await samplesByKumaId(pairs.map((pair) => pair[1]), windowKey, now);
  const result = {};
  for (const [catalogId, kumaId] of pairs) {
    result[catalogId] = stats[kumaId] || [];
  }
  return result;
}

async function applyKumaSamples(monitors, windowKey, now = Date.now()) {
  const stats = await samplesByKumaId(monitors.map((monitor) => monitor.id), windowKey, now);
  for (const monitor of monitors) {
    const samples = stats[Number(monitor.id)];
    if (samples && samples.length) {
      monitor.samples = samples;
    }
  }
  return monitors;
}

module.exports = {
  applyKumaSamples,
  describeKumaHistory,
  normalizeUrl,
  samplesByKumaId,
  samplesForCatalog,
};
