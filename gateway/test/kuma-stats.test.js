'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { series } = require('../src/history');

describe('kuma history windows', () => {
  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuma-stats-'));
    const file = path.join(dir, 'kuma.db');
    const db = new DatabaseSync(file);
    db.exec(`
      CREATE TABLE monitor (id INTEGER, url TEXT, active INTEGER);
      CREATE TABLE stat_minutely (monitor_id INTEGER, timestamp INTEGER, up INTEGER, down INTEGER, ping INTEGER);
      CREATE TABLE stat_hourly (monitor_id INTEGER, timestamp INTEGER, up INTEGER, down INTEGER, ping INTEGER);
    `);
    const now = Date.parse('2026-09-27T09:00:00Z');
    const minute = Math.floor(now / 1000 / 60) * 60;
    const insertMinute = db.prepare('INSERT INTO stat_minutely (monitor_id, timestamp, up, down, ping) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < 180; i += 1) {
      const down = i === 90 ? 1 : 0;
      insertMinute.run(2, minute - i * 60, down ? 0 : 1, down, 20);
    }
    const hour = Math.floor(now / 1000 / 3600) * 3600;
    const insertHour = db.prepare('INSERT INTO stat_hourly (monitor_id, timestamp, up, down, ping) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < 24 * 8; i += 1) {
      const down = i === 30 ? 4 : 0;
      insertHour.run(2, hour - i * 3600, down ? 10 : 60, down, 20);
    }
    db.prepare('INSERT INTO monitor (id, url, active) VALUES (?, ?, 1)').run(2, 'https://au.processpro.io/kuma');
    db.close();
    process.env.KUMA_DB_PATH = file;
    delete require.cache[require.resolve('../src/kuma-stats')];
  });

  it('uses a different span for 1 hour, 24 hours, and 7 days', () => {
    const { samplesForCatalog } = require('../src/kuma-stats');
    const monitors = [{ id: 'pub-au', url: 'https://au.processpro.io/kuma/' }];
    const now = Date.parse('2026-09-27T09:00:00Z');
    const hour = samplesForCatalog(monitors, '1h', now)['pub-au'];
    const day = samplesForCatalog(monitors, '24h', now)['pub-au'];
    const week = samplesForCatalog(monitors, '7d', now)['pub-au'];
    const hourView = series(hour, '1h', now);
    const dayView = series(day, '24h', now);
    const weekView = series(week, '7d', now);
    assert.equal(hourView.cells.filter((cell) => cell === 'up').length, 60);
    assert.equal(hourView.down, 0);
    assert.ok(dayView.down > 0);
    assert.ok(dayView.cells.includes('down'));
    assert.ok(weekView.cells.filter((cell) => cell !== 'empty').length > 24);
    assert.ok(weekView.cells.includes('down'));
  });
});
