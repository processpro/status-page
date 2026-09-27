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

function dbPath() {
  if (process.env.KUMA_DB_PATH) {
    return process.env.KUMA_DB_PATH;
  }
  if (fs.existsSync('/app/data/kuma.db')) {
    return '/app/data/kuma.db';
  }
  return null;
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

function monitorUrls(now = Date.now()) {
  if (monitorCache.value && now - monitorCache.at < 60000) {
    return monitorCache.value;
  }
  const file = dbPath();
  if (!file) {
    return new Map();
  }
  const rows = queryRows(
    file,
    "SELECT id, url FROM monitor WHERE active = 1 AND url LIKE 'http%'",
    ['id', 'url']
  );
    const index = new Map();
    for (const row of rows) {
      const key = normalizeUrl(row.url);
      if (key && !index.has(key)) {
        index.set(key, Number(row.id));
      }
    }
  monitorCache = { at: now, value: index };
  return index;
}

function samplesByKumaId(monitorIds, windowKey, now = Date.now()) {
  const key = normalizeWindow(windowKey);
  const ids = [...new Set(monitorIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) {
    return {};
  }
  const file = dbPath();
  if (!file) {
    return {};
  }
  const cacheKey = `${file}|${key}|${ids.slice().sort((a, b) => a - b).join(',')}|${Math.floor(now / 20000)}`;
  if (statCache.key === cacheKey && statCache.value) {
    return statCache.value;
  }
  const table = TABLE_BY_WINDOW[key];
  const start = Math.floor((now - WINDOWS[key]) / 1000);
  const list = ids.join(',');
  let rows = queryRows(
    file,
    `SELECT monitor_id, timestamp, up, down, ping FROM ${table} WHERE monitor_id IN (${list}) AND timestamp >= ${start} ORDER BY timestamp`,
    ['monitor_id', 'timestamp', 'up', 'down', 'ping']
  );
  if (!rows.length) {
    rows = heartbeatRows(file, ids, start);
  }
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

function samplesForCatalog(monitors, windowKey, now = Date.now()) {
  const index = monitorUrls(now);
  const pairs = [];
  for (const monitor of monitors) {
    const kumaId = index.get(normalizeUrl(monitor.url));
    if (kumaId) {
      pairs.push([monitor.id, kumaId]);
    }
  }
  const stats = samplesByKumaId(pairs.map((pair) => pair[1]), windowKey, now);
  const result = {};
  for (const [catalogId, kumaId] of pairs) {
    result[catalogId] = stats[kumaId] || [];
  }
  return result;
}

function applyKumaSamples(monitors, windowKey, now = Date.now()) {
  const stats = samplesByKumaId(monitors.map((monitor) => monitor.id), windowKey, now);
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
