'use strict';

const { probeUrl } = require('./apps');
const { recordMissing, recordSample } = require('./history');
const { fetchKumaSnapshot } = require('./kuma');
const { dataDir, loadMonitors } = require('./store');

let timer = null;
let running = false;

async function checkAll() {
  if (running) {
    return;
  }
  running = true;
  const now = Date.now();
  try {
    const monitors = loadMonitors().filter((monitor) => monitor.enabled);
    await Promise.all(
      monitors.map(async (monitor) => {
        const result = await probeUrl(monitor.url, { expect: monitor.expect });
        await recordSample(dataDir(), monitor.id, {
          t: now,
          ok: result.ok,
          ms: result.elapsedMs,
          code: result.statusCode,
        });
      })
    );
    await recordDatabaseHeartbeats(now);
  } catch (error) {
    console.error('Status check failed:', error.message);
  } finally {
    running = false;
  }
}

async function recordDatabaseHeartbeats(now) {
  const snapshot = await fetchKumaSnapshot(now);
  const databases = snapshot.monitors.filter((monitor) => monitor.type === 'sqlserver');
  for (const monitor of databases) {
    await recordMissing(dataDir(), `kuma-${monitor.id}`, monitor.samples || [], now);
  }
}

function startScheduler() {
  if (timer) {
    return;
  }
  checkAll();
  timer = setInterval(checkAll, 60 * 1000);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  checkAll,
  startScheduler,
  stopScheduler,
};
