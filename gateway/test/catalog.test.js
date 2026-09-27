'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

describe('monitor catalog and history', () => {
  beforeEach(() => {
    process.env.STATUS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'status-gateway-'));
  });

  it('seeds public regions and the Australia single-app list', () => {
    const { loadMonitors } = require('../src/store');
    const monitors = loadMonitors();
    assert.ok(monitors.some((monitor) => monitor.id === 'pub-au' && monitor.visibility === 'public'));
    assert.ok(monitors.some((monitor) => monitor.id === 'int-giltrapgroup' && monitor.group === 'australia'));
    assert.equal(monitors.filter((monitor) => monitor.group === 'demo').length, 0);
  });

  it('treats Conductor, Help, and Learning redirects as healthy', async () => {
    const dir = process.env.STATUS_DATA_DIR;
    const { recordSample, samplesFor } = require('../src/history');
    await recordSample(dir, 'pub-conductor', { t: Date.now(), ok: 0, ms: 10, code: 302 });
    fs.writeFileSync(
      path.join(dir, 'monitors.json'),
      JSON.stringify({
        monitors: [{
          id: 'pub-conductor',
          name: 'Conductor',
          url: 'https://conductor.processpro.io/',
          group: 'products',
          visibility: 'public',
          expect: '2xx',
          enabled: true,
        }],
      })
    );
    const { loadMonitors } = require('../src/store');
    assert.equal(loadMonitors().find((monitor) => monitor.id === 'pub-conductor').expect, 'redirect-ok');
    await recordSample(dir, 'other', { t: Date.now(), ok: 1, ms: 10, code: 200 });
    assert.equal(samplesFor(dir, 'pub-conductor').length, 0);
  });

  it('adds, edits, and removes a monitor', () => {
    const { createMonitor, updateMonitor, deleteMonitor, getMonitor, loadMonitors } = require('../src/store');
    loadMonitors();
    const created = createMonitor({
      name: 'Demo core',
      url: 'https://demo.example.com/Account/Login',
      group: 'demo',
      visibility: 'internal',
      expect: 'redirect-ok',
      enabled: 'on',
    });
    assert.equal(getMonitor(created.id).group, 'demo');
    updateMonitor(created.id, {
      name: 'Demo core',
      url: 'https://demo.example.com/health',
      group: 'europe',
      visibility: 'internal',
      expect: '2xx',
      enabled: 'on',
    });
    assert.equal(getMonitor(created.id).group, 'europe');
    assert.equal(deleteMonitor(created.id), true);
    assert.equal(getMonitor(created.id), null);
  });

  it('keeps new database checks and ignores duplicates', async () => {
    const dir = process.env.STATUS_DATA_DIR;
    const { recordMissing, samplesFor } = require('../src/history');
    const first = Date.parse('2026-09-27T20:00:00Z');
    const second = first + 60 * 1000;
    await recordMissing(dir, 'kuma-11', [
      { t: first, ok: 1, ms: 20 },
      { t: second, ok: 1, ms: 21 },
    ]);
    await recordMissing(dir, 'kuma-11', [
      { t: second, ok: 1, ms: 21 },
      { t: second + 60 * 1000, ok: 0, ms: 30 },
    ]);
    const samples = samplesFor(dir, 'kuma-11');
    assert.deepEqual(samples.map((sample) => sample.t), [first, second, second + 60 * 1000]);
    assert.equal(samples[2].ok, 0);
  });

  it('keeps checks and only changes the visible window', async () => {
    const { recordSample, series } = require('../src/history');
    const dir = process.env.STATUS_DATA_DIR;
    const now = Date.parse('2026-09-27T00:00:00Z');
    await recordSample(dir, 'pub-au', { t: now - 30 * 60 * 1000, ok: 1, ms: 20, code: 200 }, now);
    await recordSample(dir, 'pub-au', { t: now - 3 * 60 * 60 * 1000, ok: 0, ms: 20, code: 500 }, now);
    await recordSample(dir, 'pub-au', { t: now - 3 * 24 * 60 * 60 * 1000, ok: 1, ms: 20, code: 200 }, now);
    const hour = series(
      [{ t: now - 30 * 60 * 1000, ok: 1 }, { t: now - 3 * 60 * 60 * 1000, ok: 0 }, { t: now - 3 * 24 * 60 * 60 * 1000, ok: 1 }],
      '1h',
      now
    );
    const week = series(
      [{ t: now - 30 * 60 * 1000, ok: 1 }, { t: now - 3 * 60 * 60 * 1000, ok: 0 }, { t: now - 3 * 24 * 60 * 60 * 1000, ok: 1 }],
      '7d',
      now
    );
    assert.equal(hour.up, 1);
    assert.equal(hour.down, 0);
    assert.equal(week.up, 2);
    assert.equal(week.down, 1);
    assert.ok(hour.cells.includes('up'));
    assert.ok(week.cells.includes('down'));
  });
});
