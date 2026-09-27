'use strict';

const fs = require('fs');
const path = require('path');

const RETENTION_MS = 8 * 24 * 60 * 60 * 1000;

const WINDOWS = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const BUCKETS = {
  '1h': 60,
  '24h': 96,
  '7d': 84,
};

function historyPath(dataDir) {
  return path.join(dataDir, 'history.json');
}

function loadHistory(dataDir) {
  const file = historyPath(dataDir);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  return {};
}

function saveHistory(dataDir, history) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = historyPath(dataDir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(history));
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.copyFileSync(tmp, file);
    fs.rmSync(tmp, { force: true });
  }
}

function prune(samples, now) {
  const cutoff = now - RETENTION_MS;
  return samples.filter((sample) => sample.t >= cutoff);
}

let writeQueue = Promise.resolve();

function recordSample(dataDir, monitorId, sample, now = Date.now()) {
  const job = writeQueue.then(() => {
    const history = loadHistory(dataDir);
    const existing = Array.isArray(history[monitorId]) ? history[monitorId] : [];
    existing.push({
      t: sample.t || now,
      ok: sample.ok ? 1 : 0,
      ms: sample.ms ?? null,
      code: sample.code ?? null,
    });
    history[monitorId] = prune(existing, now);
    saveHistory(dataDir, history);
    return history[monitorId];
  });
  writeQueue = job.then(
    () => {},
    () => {}
  );
  return job;
}

function recordMissing(dataDir, monitorId, samples, now = Date.now()) {
  const job = writeQueue.then(() => {
    const history = loadHistory(dataDir);
    const existing = Array.isArray(history[monitorId]) ? history[monitorId] : [];
    const seen = new Set(existing.map((sample) => sample.t));
    let added = 0;
    for (const sample of samples) {
      if (!sample || !sample.t || seen.has(sample.t)) {
        continue;
      }
      seen.add(sample.t);
      existing.push({
        t: sample.t,
        ok: sample.ok ? 1 : 0,
        ms: sample.ms ?? null,
        code: sample.code ?? null,
      });
      added += 1;
    }
    if (!added) {
      return existing;
    }
    existing.sort((left, right) => left.t - right.t);
    history[monitorId] = prune(existing, now);
    saveHistory(dataDir, history);
    return history[monitorId];
  });
  writeQueue = job.then(
    () => {},
    () => {}
  );
  return job;
}

function dropSamples(dataDir, monitorId) {
  const job = writeQueue.then(() => {
    const history = loadHistory(dataDir);
    if (!Object.prototype.hasOwnProperty.call(history, monitorId)) {
      return;
    }
    delete history[monitorId];
    saveHistory(dataDir, history);
  });
  writeQueue = job.then(
    () => {},
    () => {}
  );
  return job;
}

function samplesFor(dataDir, monitorId) {
  const history = loadHistory(dataDir);
  return Array.isArray(history[monitorId]) ? history[monitorId] : [];
}

function latestSample(dataDir, monitorId) {
  const samples = samplesFor(dataDir, monitorId);
  return samples.length ? samples[samples.length - 1] : null;
}

function normalizeWindow(value) {
  return WINDOWS[value] ? value : '24h';
}

function sampleCounts(sample) {
  if (sample.up != null || sample.down != null) {
    return {
      up: Number(sample.up) || 0,
      down: Number(sample.down) || 0,
    };
  }
  return sample.ok ? { up: 1, down: 0 } : { up: 0, down: 1 };
}

function series(samples, windowKey, now = Date.now()) {
  const key = normalizeWindow(windowKey);
  const span = WINDOWS[key];
  const bucketCount = BUCKETS[key];
  const start = now - span;
  const width = span / bucketCount;
  const cells = Array.from({ length: bucketCount }, () => ({ up: 0, down: 0 }));
  let up = 0;
  let down = 0;

  for (const sample of samples) {
    if (sample.t < start || sample.t > now) {
      continue;
    }
    const counts = sampleCounts(sample);
    up += counts.up;
    down += counts.down;
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((sample.t - start) / width)));
    cells[index].up += counts.up;
    cells[index].down += counts.down;
  }

  return {
    window: key,
    cells: cells.map((cell) => {
      if (cell.down > 0) {
        return 'down';
      }
      if (cell.up > 0) {
        return 'up';
      }
      return 'empty';
    }),
    up,
    down,
    percent: up + down === 0 ? null : up / (up + down),
  };
}

module.exports = {
  BUCKETS,
  RETENTION_MS,
  WINDOWS,
  dropSamples,
  latestSample,
  recordMissing,
  normalizeWindow,
  recordSample,
  samplesFor,
  series,
};
