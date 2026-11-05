'use strict';

const { armTimespan, listAll, queryMetrics, subscriptionId } = require('./azure');
const { cpuLevel, mean, memoryLevel, parseMetricSeries } = require('./vitals-eval');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const SNAPSHOT_TTL = 5 * 60 * 1000;
const CATALOG_TTL = 30 * 60 * 1000;

let catalog = { at: 0, plans: [], sites: [], sqlServers: [] };
let cache = { at: 0, snapshot: null, error: '' };
let inflight = null;
let timer = null;

function placeName(location) {
  const known = {
    australiaeast: 'Australia East',
    australiacentral: 'Australia Central',
    canadacentral: 'Canada Central',
    centralus: 'Central US',
    uksouth: 'UK South',
    westeurope: 'West Europe',
  };
  const key = String(location || '').toLowerCase();
  return known[key] || location || '';
}

function resourceGroupOf(id) {
  const match = /\/resourceGroups\/([^/]+)\//i.exec(id || '');
  return match ? match[1] : '';
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  }
  const width = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: width }, () => run()));
  return results;
}

function fixtureSnapshot() {
  return {
    fetchedAt: new Date().toISOString(),
    error: '',
    plans: [
      {
        name: 'ASP-processproresourcegroup-87zx',
        resourceGroup: 'processpro-azure-au-resourcegroup',
        location: 'Australia East',
        sku: 'P2v4',
        memoryHour: 95,
        memoryLevel: 'hot',
        cpuHour: 8,
        cpuLevel: 'ok',
      },
      {
        name: 'ASP-processprocanada-95c5',
        resourceGroup: 'processpro-azure-ca-resourcegroup',
        location: 'Canada Central',
        sku: 'P1v3',
        memoryHour: 93,
        memoryLevel: 'hot',
        cpuHour: 8,
        cpuLevel: 'ok',
      },
      {
        name: 'ASP-processpro-demo-b6f5',
        resourceGroup: 'processpro-azure-demo-resourcegroup',
        location: 'Australia East',
        sku: 'P1v4',
        memoryHour: 91,
        memoryLevel: 'hot',
        cpuHour: 3,
        cpuLevel: 'ok',
      },
      {
        name: 'ASP-processprousaresourcegroup-9667',
        resourceGroup: 'processpro-azure-us-resourcegroup',
        location: 'Central US',
        sku: 'P2v3',
        memoryHour: 78,
        memoryLevel: 'warn',
        cpuHour: 1,
        cpuLevel: 'ok',
      },
      {
        name: 'ASP-processproweu',
        resourceGroup: 'processpro-azure-weu-resourcegroup',
        location: 'West Europe',
        sku: 'P1v4',
        memoryHour: 49,
        memoryLevel: 'ok',
        cpuHour: 1,
        cpuLevel: 'ok',
      },
      {
        name: 'ASP-processproazureeuresourcegroup-bcf0',
        resourceGroup: 'processpro-azure-eu-resourcegroup',
        location: 'UK South',
        sku: 'P1v3',
        memoryHour: 46,
        memoryLevel: 'ok',
        cpuHour: 2,
        cpuLevel: 'ok',
      },
    ],
    sqlServers: [
      {
        name: 'processpro-dbserver',
        resourceGroup: 'processpro-azure-au-resourcegroup',
        location: 'Australia East',
        hottest: { name: 'planner', metric: 'DTU', hour: 42, level: 'ok' },
      },
      {
        name: 'processpro-ca-dbserver',
        resourceGroup: 'processpro-azure-ca-resourcegroup',
        location: 'Canada Central',
        hottest: null,
      },
      {
        name: 'processpro-demo-dbserver',
        resourceGroup: 'processpro-azure-demo-resourcegroup',
        location: 'Australia East',
        hottest: null,
      },
      {
        name: 'processpro-us-dbserver',
        resourceGroup: 'processpro-azure-us-resourcegroup',
        location: 'Central US',
        hottest: null,
      },
      {
        name: 'processpro-eu-dbserver',
        resourceGroup: 'processpro-azure-eu-resourcegroup',
        location: 'UK South',
        hottest: null,
      },
      {
        name: 'processpro-weu-dbserver',
        resourceGroup: 'processpro-azure-weu-resourcegroup',
        location: 'West Europe',
        hottest: null,
      },
      {
        name: 'gfw-au-dbserver',
        resourceGroup: 'GFW-AU-Online',
        location: 'Australia East',
        hottest: null,
      },
      {
        name: 'processpro-global',
        resourceGroup: 'processpro-global',
        location: 'Australia East',
        hottest: null,
      },
    ],
  };
}

async function loadCatalog() {
  if (catalog.plans.length && Date.now() - catalog.at < CATALOG_TTL) {
    return catalog;
  }
  const sub = subscriptionId();
  const [plans, sites, servers] = await Promise.all([
    listAll(`/subscriptions/${sub}/providers/Microsoft.Web/serverfarms?api-version=2022-09-01`),
    listAll(`/subscriptions/${sub}/providers/Microsoft.Web/sites?api-version=2022-09-01`),
    listAll(`/subscriptions/${sub}/providers/Microsoft.Sql/servers?api-version=2021-11-01`),
  ]);
  const sqlServers = await mapPool(servers, 4, async (server) => {
    const databases = await listAll(`${server.id}/databases?api-version=2021-11-01`);
    return {
      id: server.id,
      name: server.name,
      resourceGroup: resourceGroupOf(server.id),
      location: placeName(server.location),
      databases: databases
        .filter((database) => database.name && database.name.toLowerCase() !== 'master')
        .map((database) => ({ id: database.id, name: database.name })),
    };
  });
  catalog = {
    at: Date.now(),
    plans: plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      resourceGroup: resourceGroupOf(plan.id),
      location: placeName(plan.location),
      sku: plan.sku?.name || '',
    })),
    sites: sites
      .filter((site) => !String(site.kind || '').includes('functionapp'))
      .map((site) => ({
        id: site.id,
        name: site.name,
        serverFarmId: String(site.properties?.serverFarmId || '').toLowerCase(),
      })),
    sqlServers,
  };
  return catalog;
}

async function metricMap(resourceId, names, durationMs, interval, aggregation) {
  const body = await queryMetrics(resourceId, names, {
    timespan: armTimespan(durationMs),
    interval,
    aggregation,
  });
  return parseMetricSeries(body);
}

function summarisePlan(plan, series) {
  const memory = (series.MemoryPercentage || []).map((point) => point.value);
  const cpu = (series.CpuPercentage || []).map((point) => point.value);
  const memoryHour = mean(memory);
  const cpuHour = mean(cpu);
  return {
    ...plan,
    memoryHour,
    memoryLevel: memoryLevel(memoryHour),
    cpuHour,
    cpuLevel: cpuLevel(cpuHour, cpu),
  };
}

function databasePressure(series) {
  const dtu = (series.dtu_consumption_percent || []).map((point) => point.value);
  const cpu = (series.cpu_percent || []).map((point) => point.value);
  if (dtu.some((value) => value != null)) {
    const hour = mean(dtu);
    return { metric: 'DTU', hour, level: memoryLevel(hour), samples: dtu };
  }
  const hour = mean(cpu);
  return { metric: 'CPU', hour, level: memoryLevel(hour), samples: cpu };
}

async function readSnapshot() {
  const current = await loadCatalog();
  const plans = await mapPool(current.plans, 4, async (plan) => {
    try {
      const series = await metricMap(plan.id, ['MemoryPercentage', 'CpuPercentage'], HOUR, 'PT5M');
      return summarisePlan(plan, series);
    } catch (error) {
      return { ...plan, memoryHour: null, memoryLevel: 'none', cpuHour: null, cpuLevel: 'none', error: error.message };
    }
  });
  const sqlServers = await mapPool(current.sqlServers, 2, async (server) => {
    const databases = await mapPool(server.databases, 6, async (database) => {
      try {
        const series = await metricMap(
          database.id,
          ['dtu_consumption_percent', 'cpu_percent'],
          HOUR,
          'PT5M'
        );
        const pressure = databasePressure(series);
        return { name: database.name, id: database.id, ...pressure };
      } catch (error) {
        return { name: database.name, id: database.id, metric: 'DTU', hour: null, level: 'none', error: error.message };
      }
    });
    const ranked = [...databases].sort((left, right) => (right.hour || 0) - (left.hour || 0));
    const hottest = ranked[0]
      ? { name: ranked[0].name, metric: ranked[0].metric, hour: ranked[0].hour, level: ranked[0].level }
      : null;
    return {
      name: server.name,
      resourceGroup: server.resourceGroup,
      location: server.location,
      hottest,
      databases: ranked.map(({ name, metric, hour, level }) => ({ name, metric, hour, level })),
    };
  });
  plans.sort((left, right) => (right.memoryHour || 0) - (left.memoryHour || 0));
  return {
    fetchedAt: new Date().toISOString(),
    error: '',
    plans,
    sqlServers,
  };
}

async function refreshSnapshot() {
  if (process.env.VITALS_FIXTURE === 'true') {
    cache = { at: Date.now(), snapshot: fixtureSnapshot(), error: '' };
    return cache;
  }
  try {
    const snapshot = await readSnapshot();
    cache = { at: Date.now(), snapshot, error: '' };
  } catch (error) {
    cache = {
      at: cache.at,
      snapshot: cache.snapshot,
      error: error.message,
    };
    console.error('Vitals refresh failed:', error.message);
  }
  return cache;
}

async function getSnapshot() {
  if (process.env.VITALS_FIXTURE === 'true') {
    return { at: Date.now(), snapshot: fixtureSnapshot(), error: '' };
  }
  if (cache.snapshot && Date.now() - cache.at < SNAPSHOT_TTL) {
    return cache;
  }
  if (!inflight) {
    inflight = refreshSnapshot().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

function findPlan(name, resourceGroup) {
  return (catalog.plans || []).find(
    (plan) => plan.name === name && plan.resourceGroup.toLowerCase() === String(resourceGroup).toLowerCase()
  );
}

function findSql(name, resourceGroup) {
  return (catalog.sqlServers || []).find(
    (server) => server.name === name && server.resourceGroup.toLowerCase() === String(resourceGroup).toLowerCase()
  );
}

const FIXTURE_APPS = {
  'ASP-processproresourcegroup-87zx': [
    { name: 'pp-au-townsville', memoryMb: 383 },
    { name: 'pp-au-toyota', memoryMb: 210 },
  ],
  'ASP-processprocanada-95c5': [
    { name: 'pp-ca-londonpolice', memoryMb: null },
    { name: 'processpro-canada', memoryMb: null },
  ],
  'ASP-processpro-demo-b6f5': [
    { name: 'pp-demo-development', memoryMb: 959 },
    { name: 'pp-demo-airline', memoryMb: 774 },
    { name: 'pp-demo-main', memoryMb: 665 },
  ],
  'ASP-processprousaresourcegroup-9667': [
    { name: 'processpro-us', memoryMb: null },
  ],
  'ASP-processproweu': [
    { name: 'pp-weu-nexperia', memoryMb: null },
    { name: 'pp-weu-wizzair', memoryMb: null },
  ],
  'ASP-processproazureeuresourcegroup-bcf0': [
    { name: 'processpro-eu', memoryMb: null },
  ],
};

function fixtureSeries(base, windowKey, spread) {
  const count = windowKey === '7d' ? 28 : 24;
  const step = windowKey === '7d' ? 6 * HOUR : HOUR;
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index / 2.5) * spread + (index / count) * spread * 0.4;
    return {
      t: new Date(now - (count - 1 - index) * step).toISOString(),
      value: Math.round((base + wave) * 10) / 10,
    };
  });
}

async function getPlanDetail(resourceGroup, name, windowKey, selection = {}) {
  const measure = selection.measure === 'cpu' ? 'cpu' : 'memory';
  if (process.env.VITALS_FIXTURE === 'true') {
    const plan = fixtureSnapshot().plans.find((item) => item.name === name) || fixtureSnapshot().plans[0];
    const apps = FIXTURE_APPS[plan.name] || [];
    const selectedApp = apps.find((app) => app.name === selection.app) || null;
    let series;
    let chart;
    if (selectedApp && measure === 'cpu') {
      series = fixtureSeries(4, windowKey, 2);
      chart = { unit: 'seconds', title: `${selectedApp.name} CPU time`, caption: 'Each point is that app’s CPU time, in seconds. A higher line means the app was busier. This is not a percentage of the server.' };
    } else if (selectedApp) {
      series = fixtureSeries(selectedApp.memoryMb || 300, windowKey, 40);
      chart = { unit: 'mb', title: `${selectedApp.name} memory`, caption: 'Each point is that app’s memory in megabytes. This is not the percent of the server. The 85% line is only on the server memory chart.' };
    } else if (measure === 'cpu') {
      series = fixtureSeries(plan.cpuHour || 8, windowKey, 6);
      chart = { unit: 'percent', title: 'Server CPU', caption: 'Each point is the server’s CPU. Time runs left to right. A short spike is normal. A line that stays high is the warning.' };
    } else {
      series = fixtureSeries(plan.memoryHour, windowKey, 4);
      chart = { unit: 'percent', title: 'Server memory', caption: 'Each point is the server’s memory. Time runs left to right. The dashed line is 85%. A line climbing toward it is the early warning.' };
    }
    return { plan, apps, series, selectedApp: selectedApp?.name || '', measure, chart };
  }
  await getSnapshot();
  const plan = findPlan(name, resourceGroup);
  if (!plan) {
    return null;
  }
  const duration = windowKey === '7d' ? WEEK : DAY;
  const interval = windowKey === '7d' ? 'PT1H' : 'PT15M';
  const apps = catalog.sites.filter((site) => site.serverFarmId === plan.id.toLowerCase());
  const measured = await mapPool(apps, 6, async (site) => {
    try {
      const siteSeries = await metricMap(site.id, ['AverageMemoryWorkingSet'], HOUR, 'PT5M');
      const bytes = mean((siteSeries.AverageMemoryWorkingSet || []).map((point) => point.value));
      return { name: site.name, id: site.id, memoryMb: bytes == null ? null : Math.round(bytes / (1024 * 1024)) };
    } catch {
      return { name: site.name, id: site.id, memoryMb: null };
    }
  });
  measured.sort((left, right) => (right.memoryMb || 0) - (left.memoryMb || 0));
  const selected = measured.find((app) => app.name === selection.app) || null;
  let series = [];
  let chart;
  if (selected && measure === 'cpu') {
    const siteSeries = await metricMap(selected.id, ['CpuTime'], duration, interval, 'Total');
    series = siteSeries.CpuTime || [];
    chart = { unit: 'seconds', title: `${selected.name} CPU time`, caption: 'Each point is that app’s CPU time, in seconds. A higher line means the app was busier. This is not a percentage of the server.' };
  } else if (selected) {
    const siteSeries = await metricMap(selected.id, ['AverageMemoryWorkingSet'], duration, interval);
    series = (siteSeries.AverageMemoryWorkingSet || []).map((point) => ({
      t: point.t,
      value: point.value == null ? null : point.value / (1024 * 1024),
    }));
    chart = { unit: 'mb', title: `${selected.name} memory`, caption: 'Each point is that app’s memory in megabytes. This is not the percent of the server. The 85% line is only on the server memory chart.' };
  } else if (measure === 'cpu') {
    const seriesMap = await metricMap(plan.id, ['CpuPercentage'], duration, interval);
    series = seriesMap.CpuPercentage || [];
    chart = { unit: 'percent', title: 'Server CPU', caption: 'Each point is the server’s CPU. Time runs left to right. A short spike is normal. A line that stays high is the warning.' };
  } else {
    const seriesMap = await metricMap(plan.id, ['MemoryPercentage'], duration, interval);
    series = seriesMap.MemoryPercentage || [];
    chart = { unit: 'percent', title: 'Server memory', caption: 'Each point is the server’s memory. Time runs left to right. The dashed line is 85%. A line climbing toward it is the early warning.' };
  }
  const card = (cache.snapshot?.plans || []).find((item) => item.name === plan.name && item.resourceGroup === plan.resourceGroup);
  return {
    plan: card || plan,
    apps: measured,
    series,
    selectedApp: selected?.name || '',
    measure,
    chart,
  };
}

async function getSqlDetail(resourceGroup, name, windowKey, databaseName) {
  if (process.env.VITALS_FIXTURE === 'true') {
    const server = fixtureSnapshot().sqlServers.find((item) => item.name === name)
      || fixtureSnapshot().sqlServers[0];
    const hottest = server.hottest;
    return {
      server,
      databases: hottest
        ? [{ name: hottest.name, metric: hottest.metric, hour: hottest.hour, level: hottest.level }]
        : [],
      selected: hottest?.name || '',
      series: hottest ? fixtureSeries(hottest.hour, windowKey, 8) : [],
    };
  }
  await getSnapshot();
  const server = findSql(name, resourceGroup);
  if (!server) {
    return null;
  }
  const cached = (cache.snapshot?.sqlServers || []).find(
    (item) => item.name === server.name && item.resourceGroup === server.resourceGroup
  );
  const databases = cached?.databases || [];
  const selected = databases.find((database) => database.name === databaseName) || databases[0];
  const source = server.databases.find((database) => database.name === selected?.name);
  let series = [];
  if (source) {
    const duration = windowKey === '7d' ? WEEK : DAY;
    const interval = windowKey === '7d' ? 'PT1H' : 'PT15M';
    const names = selected?.metric === 'CPU' ? ['cpu_percent'] : ['dtu_consumption_percent', 'cpu_percent'];
    const seriesMap = await metricMap(source.id, names, duration, interval);
    series = seriesMap.dtu_consumption_percent?.length
      ? seriesMap.dtu_consumption_percent
      : seriesMap.cpu_percent || [];
  }
  return { server: cached || server, databases, selected: selected?.name || '', series };
}

function startVitals() {
  if (timer || process.env.VITALS_FIXTURE === 'true') {
    return;
  }
  refreshSnapshot().catch((error) => console.error('Vitals refresh failed:', error.message));
  timer = setInterval(() => {
    refreshSnapshot().catch((error) => console.error('Vitals refresh failed:', error.message));
  }, SNAPSHOT_TTL);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

module.exports = {
  getPlanDetail,
  getSnapshot,
  getSqlDetail,
  startVitals,
};
