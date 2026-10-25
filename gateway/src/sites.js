'use strict';

const { groupById, GROUPS } = require('./groups');
const { createMonitor, deleteMonitor, loadMonitors, updateMonitor } = require('./store');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._()'-]{0,79}$/;

function resolveRegion(region) {
  const value = String(region || '').trim();
  if (!value || value.length > 80) {
    return null;
  }
  const lower = value.toLowerCase();
  return GROUPS.find((group) => group.id === lower || group.label.toLowerCase() === lower) || null;
}

function normalizeSiteInput(input) {
  const name = String(input?.name || '').trim();
  if (!NAME_RE.test(name)) {
    return { error: 'Site name can use letters, numbers, spaces, dots, underscores, and hyphens.' };
  }
  const group = resolveRegion(input?.region);
  if (!group) {
    const names = GROUPS.map((item) => item.label).join(', ');
    return { error: `Region must be one of: ${names}.` };
  }
  let parsed;
  try {
    parsed = new URL(String(input?.url || '').trim());
  } catch {
    return { error: 'URL must be an absolute https address.' };
  }
  if (parsed.protocol !== 'https:' || parsed.href.length > 400) {
    return { error: 'URL must be an absolute https address.' };
  }
  return {
    value: {
      name,
      region: group.label,
      groupId: group.id,
      url: parsed.href,
      visibility: group.visibility,
    },
  };
}

function sameName(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function fromCatalog(monitor) {
  const group = groupById(monitor.group);
  return {
    name: monitor.name,
    region: group ? group.label : monitor.group,
    url: monitor.url,
  };
}

function fromKuma(monitor) {
  return {
    name: monitor.name,
    region: monitor.groupName || monitor.region || '',
    url: monitor.url || '',
  };
}

function listSites(kumaMonitors = []) {
  const sites = loadMonitors()
    .filter((monitor) => monitor.enabled !== false)
    .map(fromCatalog);
  const seen = new Set(sites.map((site) => site.name.toLowerCase()));
  for (const monitor of kumaMonitors) {
    const name = String(monitor.name || '').trim();
    if (!name || seen.has(name.toLowerCase())) {
      continue;
    }
    seen.add(name.toLowerCase());
    sites.push(fromKuma(monitor));
  }
  sites.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return sites;
}

function addSite(input, kumaMonitors = []) {
  const normalized = normalizeSiteInput(input);
  if (normalized.error) {
    return { status: 'invalid', title: normalized.error };
  }
  const { value } = normalized;
  const existing = loadMonitors().find((monitor) => monitor.enabled !== false && sameName(monitor.name, value.name));
  if (existing) {
    return {
      status: 'conflict',
      title: 'This site is already being monitored.',
      site: fromCatalog(existing),
    };
  }
  const kuma = (kumaMonitors || []).find((monitor) => sameName(monitor.name, value.name));
  if (kuma) {
    return {
      status: 'conflict',
      title: 'This site is already being monitored.',
      site: fromKuma(kuma),
    };
  }

  const disabled = loadMonitors().find((monitor) => monitor.enabled === false && sameName(monitor.name, value.name));
  const fields = {
    name: value.name,
    url: value.url,
    group: value.groupId,
    visibility: value.visibility,
    expect: value.visibility === 'public' ? '2xx' : 'redirect-ok',
    enabled: 'on',
  };
  const monitor = disabled
    ? updateMonitor(disabled.id, fields)
    : createMonitor(fields);
  return { status: 'created', site: fromCatalog(monitor) };
}

function removeSite(name, kumaMonitors = []) {
  const normalized = normalizeSiteInput({ name, region: 'Australia', url: 'https://example.com' });
  if (!NAME_RE.test(String(name || '').trim()) || normalized.error?.startsWith('Site name')) {
    return { status: 'invalid', title: 'Site name can use letters, numbers, spaces, dots, underscores, and hyphens.' };
  }
  const siteName = String(name || '').trim();
  const matches = loadMonitors().filter((monitor) => monitor.enabled !== false && sameName(monitor.name, siteName));
  if (matches.length) {
    for (const monitor of matches) {
      deleteMonitor(monitor.id);
    }
    return { status: 'removed' };
  }
  const kuma = (kumaMonitors || []).find((monitor) => sameName(monitor.name, siteName));
  if (kuma) {
    return {
      status: 'kuma',
      title: 'That site is monitored by Uptime Kuma. Remove it from the Kuma dashboard.',
      site: fromKuma(kuma),
    };
  }
  return { status: 'missing', title: 'Site was not found.' };
}

module.exports = {
  addSite,
  listSites,
  normalizeSiteInput,
  removeSite,
  resolveRegion,
};
