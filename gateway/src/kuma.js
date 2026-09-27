'use strict';

const { config } = require('./config');

let cache = { at: 0, value: null };

function parseKumaTime(value) {
  if (!value) {
    return null;
  }
  const iso = String(value).replace(' ', 'T').replace(/Z$/, '') + 'Z';
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

async function fetchKumaSnapshot(now = Date.now()) {
  if (cache.value && now - cache.at < 20000) {
    return cache.value;
  }
  const base = config.kumaUpstream.replace(/\/$/, '');
  const [pageResponse, beatResponse] = await Promise.all([
    fetch(`${base}/api/status-page/default`, { signal: AbortSignal.timeout(8000) }),
    fetch(`${base}/api/status-page/heartbeat/default`, { signal: AbortSignal.timeout(8000) }),
  ]);
  if (!pageResponse.ok || !beatResponse.ok) {
    throw new Error('Uptime Kuma status API did not respond.');
  }
  const page = await pageResponse.json();
  const beats = await beatResponse.json();
  const monitors = [];
  for (const group of page.publicGroupList || []) {
    for (const monitor of group.monitorList || []) {
      const beatList = (beats.heartbeatList && beats.heartbeatList[monitor.id]) || [];
      const samples = beatList
        .map((beat) => ({
          t: parseKumaTime(beat.time),
          ok: beat.status === 1 ? 1 : 0,
          ms: beat.ping ?? null,
          code: null,
        }))
        .filter((sample) => sample.t);
      const uptimeKey = `${monitor.id}_24`;
      monitors.push({
        id: String(monitor.id),
        name: monitor.name,
        type: monitor.type,
        groupName: String(group.name || '').trim(),
        samples,
        uptime24: beats.uptimeList ? beats.uptimeList[uptimeKey] : null,
      });
    }
  }
  cache = { at: now, value: { monitors, fetchedAt: new Date(now).toISOString() } };
  return cache.value;
}

function kumaMonitor(snapshot, id) {
  if (!snapshot) {
    return null;
  }
  return snapshot.monitors.find((monitor) => monitor.id === String(id)) || null;
}

module.exports = {
  fetchKumaSnapshot,
  kumaMonitor,
  parseKumaTime,
};
