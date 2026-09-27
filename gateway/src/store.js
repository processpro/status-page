'use strict';

const fs = require('fs');
const path = require('path');
const { defaultSingleApps } = require('./config');
const { GROUPS, groupById } = require('./groups');
const { dropSamples } = require('./history');

const LOGIN_REDIRECT_IDS = new Set(['pub-conductor', 'pub-help', 'pub-lms']);

function dataDir() {
  if (process.env.STATUS_DATA_DIR) {
    return process.env.STATUS_DATA_DIR;
  }
  if (fs.existsSync('/app/data')) {
    return '/app/data/status-gateway';
  }
  return path.join(__dirname, '..', 'data');
}

function catalogPath() {
  return path.join(dataDir(), 'monitors.json');
}

function publicMonitor(id, name, url, group, expect = '2xx') {
  return {
    id,
    name,
    url,
    group,
    visibility: 'public',
    expect,
    enabled: true,
  };
}

function internalMonitor(name, group) {
  return {
    id: `int-${name}`,
    name,
    url: `https://${name}.processpro.io/Account/Login`,
    group,
    visibility: 'internal',
    expect: 'redirect-ok',
    enabled: true,
  };
}

function defaultMonitors() {
  return [
    publicMonitor('pub-au', 'Australia', 'https://au.processpro.io/kuma', 'regions'),
    publicMonitor('pub-eu', 'Europe', 'https://eu.processpro.io/kuma', 'regions'),
    publicMonitor('pub-us', 'United States', 'https://us.processpro.io/kuma', 'regions'),
    publicMonitor('pub-ca', 'Canada', 'https://ca.processpro.io/kuma', 'regions'),
    publicMonitor('pub-wayfinder', 'Wayfinder', 'https://wayfinder.processpro.io', 'products'),
    publicMonitor('pub-conductor', 'Conductor', 'https://conductor.processpro.io', 'products', 'redirect-ok'),
    publicMonitor('pub-help', 'Help', 'https://help.processpro.io', 'products', 'redirect-ok'),
    publicMonitor('pub-lms', 'Learning', 'https://processpro.tribalhabits.com', 'products', 'redirect-ok'),
    ...defaultSingleApps.map((name) => internalMonitor(name, 'australia')),
  ];
}

function readCatalog() {
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath(), 'utf8'));
    if (Array.isArray(parsed.monitors)) {
      return parsed.monitors;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  return null;
}

function writeCatalog(monitors) {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = catalogPath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ monitors }, null, 2));
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.copyFileSync(tmp, file);
    fs.rmSync(tmp, { force: true });
  }
}

function loadMonitors() {
  const existing = readCatalog();
  if (existing) {
    const repaired = [];
    for (const monitor of existing) {
      if (LOGIN_REDIRECT_IDS.has(monitor.id) && monitor.expect !== 'redirect-ok') {
        monitor.expect = 'redirect-ok';
        repaired.push(monitor.id);
      }
    }
    if (repaired.length) {
      writeCatalog(existing);
      for (const id of repaired) {
        dropSamples(dataDir(), id);
      }
    }
    return existing;
  }
  const seeded = defaultMonitors();
  writeCatalog(seeded);
  return seeded;
}

function slugId(name) {
  const base = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'monitor';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeMonitor(input, existingId) {
  const name = String(input.name || '').trim();
  const url = String(input.url || '').trim();
  const group = String(input.group || '').trim();
  const visibility = input.visibility === 'public' ? 'public' : 'internal';
  const expect = input.expect === 'redirect-ok' ? 'redirect-ok' : '2xx';
  const enabled = input.enabled === true || input.enabled === 'on' || input.enabled === 'true';

  if (!name || name.length > 80) {
    throw new Error('Name is required.');
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('URL must be a full https address.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('URL must start with https://');
  }
  if (!groupById(group)) {
    throw new Error('Choose a group.');
  }
  if (visibility !== 'public' && visibility !== 'internal') {
    throw new Error('Choose public or internal.');
  }

  return {
    id: existingId || slugId(name),
    name,
    url: parsed.href,
    group,
    visibility,
    expect,
    enabled,
  };
}

function createMonitor(input) {
  const monitors = loadMonitors();
  const monitor = normalizeMonitor(input);
  monitors.push(monitor);
  writeCatalog(monitors);
  return monitor;
}

function updateMonitor(id, input) {
  const monitors = loadMonitors();
  const index = monitors.findIndex((monitor) => monitor.id === id);
  if (index < 0) {
    return null;
  }
  monitors[index] = normalizeMonitor(input, id);
  writeCatalog(monitors);
  return monitors[index];
}

function deleteMonitor(id) {
  const monitors = loadMonitors();
  const next = monitors.filter((monitor) => monitor.id !== id);
  if (next.length === monitors.length) {
    return false;
  }
  writeCatalog(next);
  return true;
}

function getMonitor(id) {
  return loadMonitors().find((monitor) => monitor.id === id) || null;
}

function monitorsInGroup(groupId) {
  return loadMonitors().filter((monitor) => monitor.group === groupId);
}

module.exports = {
  GROUPS,
  createMonitor,
  dataDir,
  defaultMonitors,
  deleteMonitor,
  getMonitor,
  loadMonitors,
  monitorsInGroup,
  normalizeMonitor,
  updateMonitor,
};
