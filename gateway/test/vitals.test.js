'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  cpuLevel,
  formatPercent,
  mean,
  memoryLevel,
  parseMetricSeries,
  renderMemoryChart,
} = require('../src/vitals-eval');
const { renderVitalsPage } = require('../src/vitals-page');

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
});
