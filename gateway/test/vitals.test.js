'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  chartTimeLabel,
  cpuLevel,
  formatMegabytes,
  formatPercent,
  mean,
  memoryLevel,
  memoryMbFromCapabilities,
  parseMetricSeries,
  planMemory,
  renderMemoryChart,
  sumSeries,
  usagePercent,
  workerCount,
} = require('../src/vitals-eval');
const { renderVitalsPage, renderVitalsPlanPage } = require('../src/vitals-page');
const { vitalsWindow } = require('../src/vitals');

describe('vitals thresholds', () => {
  it('turns memory amber at 70 and red at 85', () => {
    assert.equal(memoryLevel(69.9), 'ok');
    assert.equal(memoryLevel(70), 'warn');
    assert.equal(memoryLevel(84.9), 'warn');
    assert.equal(memoryLevel(85), 'hot');
    assert.equal(memoryLevel(95), 'hot');
    assert.equal(memoryLevel(null), 'none');
  });

  it('ignores a short CPU spike and flags a high hour or a 15 minute run', () => {
    assert.equal(cpuLevel(8, [10, 100, 12]), 'ok');
    assert.equal(cpuLevel(8, [90, 88, 81]), 'hot');
    assert.equal(cpuLevel(41, [10, 12, 11]), 'hot');
    assert.equal(cpuLevel(null, []), 'none');
  });

  it('averages metric series across instances', () => {
    const parsed = parseMetricSeries({
      value: [
        {
          name: { value: 'MemoryPercentage' },
          timeseries: [
            { data: [{ timeStamp: '2026-11-05T00:00:00Z', average: 90 }, { timeStamp: '2026-11-05T00:05:00Z', average: 100 }] },
            { data: [{ timeStamp: '2026-11-05T00:00:00Z', average: 80 }, { timeStamp: '2026-11-05T00:05:00Z', average: null }] },
          ],
        },
      ],
    });
    assert.equal(parsed.MemoryPercentage[0].value, 85);
    assert.equal(parsed.MemoryPercentage[1].value, 100);
    assert.equal(mean(parsed.MemoryPercentage.map((point) => point.value)), 92.5);
  });

  it('draws the 85 percent line and a red card when app memory is over it', () => {
    const chart = renderMemoryChart([
      { t: '2026-11-05T00:00:00Z', value: 60 },
      { t: '2026-11-05T01:00:00Z', value: 95 },
    ]);
    assert.match(chart, /85%/);
    assert.match(chart, /vital-chart-limit/);

    const full = planMemory({
      memoryMb: 10240,
      appBytes: 9728 * 1024 * 1024,
      cacheValues: [92.1],
      incomplete: false,
    });
    const page = renderVitalsPage({
      email: 'dev@processpro.io',
      snapshot: {
        fetchedAt: '2026-11-05T01:00:00.000Z',
        plans: [
          {
            name: 'au-plan',
            resourceGroup: 'au',
            location: 'Australia East',
            sku: 'P3v4',
            memoryMb: 10240,
            workers: 1,
            ...full,
            cpuHour: 8,
            cpuLevel: 'ok',
          },
        ],
        sqlServers: [],
      },
    });
    assert.match(page, /vital-card hot/);
    assert.match(page, /vital-limit/);
    assert.match(page, /9\.5 GB of 8 GB for apps/);
    assert.match(page, /1\.5 GB over the app limit/);
    assert.match(page, /2 GB reserved for the operating system/);
    assert.match(page, /Including cache 92\.1%/);
    assert.match(page, /href="\/internal\/vitals"/);
    assert.equal(formatPercent(full.memoryHour), '118.8%');
  });

  it('uses Azure plan memory and app working set, and leaves cache out of the percentage', () => {
    assert.equal(memoryMbFromCapabilities([{ name: 'CPU', value: '8' }, { name: 'Memory', value: '32768' }]), 32768);
    assert.equal(memoryMbFromCapabilities([{ name: 'Memory', value: '32768 MB' }]), null);
    assert.equal(memoryMbFromCapabilities([]), null);
    assert.equal(workerCount({
      properties: { currentNumberOfWorkers: 2, numberOfWorkers: 4 },
      sku: { capacity: 1 },
    }), 2);
    const bytes = 11776 * 1024 * 1024;
    assert.equal(usagePercent(bytes, null), null);
    assert.equal(formatMegabytes(11776), '11.5 GB');
    assert.equal(formatMegabytes(32768), '32 GB');
    const usage = planMemory({
      memoryMb: 32768,
      appBytes: bytes,
      cacheValues: [92.1, 92.1],
      incomplete: false,
    });
    assert.equal(usage.osReserveMb, 2048);
    assert.equal(usage.appCapacityMb, 30720);
    assert.equal(usage.memoryLevel, 'ok');
    assert.equal(formatPercent(usage.memoryHour), '38.3%');
    assert.equal(usage.cacheHour, 92.1);
    const summed = sumSeries([
      [{ t: '2026-11-05T00:00:00Z', value: 100 }, { t: '2026-11-05T00:05:00Z', value: 50 }],
      [{ t: '2026-11-05T00:00:00Z', value: 40 }],
    ]);
    assert.equal(summed[0].value, 140);
    assert.equal(summed[1].value, 50);

    const page = renderVitalsPage({
      email: 'dev@processpro.io',
      snapshot: {
        fetchedAt: '2026-11-05T01:00:00.000Z',
        plans: [
          {
            name: 'au-plan',
            resourceGroup: 'au',
            location: 'Australia East',
            sku: 'P3v4',
            memoryMb: 32768,
            workers: 2,
            ...usage,
            cpuHour: 4,
            cpuLevel: 'ok',
          },
        ],
        sqlServers: [],
      },
    });
    assert.match(page, /vital-card ok/);
    assert.match(page, /11\.5 GB of 30 GB for apps · 18\.5 GB free for apps on each of 2 instances/);
    assert.match(page, /2 GB reserved for the operating system · 32 GB plan from Azure/);
    assert.match(page, /Including cache 92\.1%/);
    assert.doesNotMatch(page, /vital-card hot/);
  });

  it('offers a 30 day line and labels that chart by day', () => {
    assert.equal(chartTimeLabel('2026-10-06T00:00:00.000Z', '30d'), '6 Oct');
    assert.equal(chartTimeLabel('2026-11-05T01:05:00.000Z', '24h'), '01:05');
    assert.equal(vitalsWindow('30d'), '30d');
    assert.equal(vitalsWindow('later'), '24h');
    const page = renderVitalsPlanPage({
      email: 'dev@processpro.io',
      windowKey: '30d',
      detail: {
        plan: { name: 'plan', resourceGroup: 'rg', location: 'Australia East', sku: 'P2v4', memoryHour: 40 },
        apps: [],
        series: [
          { t: '2026-10-06T00:00:00.000Z', value: 40 },
          { t: '2026-11-05T00:00:00.000Z', value: 50 },
        ],
        selectedApp: '',
        measure: 'memory',
        chart: { unit: 'percent', title: 'Server memory', caption: 'Each point is the server’s memory.' },
      },
    });
    assert.match(page, /30 days/);
    assert.match(page, /window=30d/);
    assert.match(page, /6 Oct/);
  });
});
