'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildAppEntries, listMonitoredApps } = require('../src/apps');
const { defaultSingleApps } = require('../src/config');

describe('monitored app list', () => {
  it('builds processpro.io hosts for production apps', () => {
    const apps = buildAppEntries(['giltrapgroup', 'toyota'], 'production');
    assert.deepEqual(apps[0], {
      name: 'giltrapgroup',
      environment: 'production',
      host: 'giltrapgroup.processpro.io',
      url: 'https://giltrapgroup.processpro.io',
      azureSiteHint: 'pp-au-giltrapgroup',
    });
    assert.equal(apps[1].azureSiteHint, 'pp-au-toyota');
  });

  it('includes the default single-app services', () => {
    const names = listMonitoredApps().map((app) => app.name);
    for (const expected of defaultSingleApps) {
      assert.ok(names.includes(expected), `missing ${expected}`);
    }
  });
});
