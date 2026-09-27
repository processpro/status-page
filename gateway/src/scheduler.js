'use strict';

const { probeUrl } = require('./apps');
const { recordSample } = require('./history');
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
  } catch (error) {
    console.error('Status check failed:', error.message);
  } finally {
    running = false;
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
