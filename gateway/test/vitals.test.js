'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  chartTimeLabel,
  cpuLevel,
  formatPercent,
  mean,
  memoryLevel,
  parseMetricSeries,
  renderMemoryChart,
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

  it('draws the 85 percent line and a red card when the hour is over it', () => {
    const chart = renderMemoryChart([
      { t: '2026-11-05T00:00:00Z', value: 60 },
      { t: '2026-11-05T01:00:00Z', value: 95 },
    ]);
    assert.match(chart, /85%/);
    assert.match(chart, /vital-chart-limit/);

    const page = renderVitalsPage({
      email: 'dev@processpro.io',
      snapshot: {
        fetchedAt: '2026-11-05T01:00:00.000Z',
        plans: [
          {
            name: 'au-plan',
            resourceGroup: 'au',
            location: 'Australia East',
            sku: 'P2v4',
            memoryHour: 95,
            memoryLevel: 'hot',
            cpuHour: 8,
            cpuLevel: 'ok',
          },
        ],
        sqlServers: [],
      },
    });
    assert.match(page, /vital-card hot/);
    assert.match(page, /vital-limit/);
    assert.match(page, /href="\/internal\/vitals"/);
    assert.equal(formatPercent(95), '95%');
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
