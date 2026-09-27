'use strict';

const { config } = require('./config');

function buildAppEntries(names, environment) {
  return names.map((name) => {
    const host = `${name}.processpro.io`;
    return {
      name,
      environment,
      host,
      url: `https://${host}`,
      azureSiteHint:
        environment === 'production' ? `pp-au-${name}` : `pp-demo-${name}`,
    };
  });
}

function listMonitoredApps() {
  return [
    ...buildAppEntries(config.singleApps, 'production'),
    ...buildAppEntries(config.demoApps, 'demo'),
  ];
}

async function probeApp(app) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.probeTimeoutMs);
  const started = Date.now();
  const probeUrl = `${app.url}${config.probePath}`;

  try {
    const response = await fetch(probeUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'ProcessPro-Status-Internal/1.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    const elapsedMs = Date.now() - started;
    const ok =
      response.status === 200 ||
      response.status === 302 ||
      response.status === 303 ||
      response.status === 307 ||
      response.status === 308;

    return {
      ...app,
      ok,
      statusCode: response.status,
      elapsedMs,
      probedAt: new Date().toISOString(),
      probeUrl,
      error: null,
    };
  } catch (error) {
    return {
      ...app,
      ok: false,
      statusCode: null,
      elapsedMs: Date.now() - started,
      probedAt: new Date().toISOString(),
      probeUrl,
      error: error.name === 'AbortError' ? 'timeout' : error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeAllApps() {
  const apps = listMonitoredApps();
  const results = await Promise.all(apps.map((app) => probeApp(app)));
  const up = results.filter((item) => item.ok).length;
  return {
    generatedAt: new Date().toISOString(),
    total: results.length,
    up,
    down: results.length - up,
    apps: results.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

module.exports = {
  buildAppEntries,
  listMonitoredApps,
  probeAllApps,
  probeApp,
};
