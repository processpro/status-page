'use strict';

const path = require('path');
const express = require('express');
const { auth, requiresAuth } = require('express-openid-connect');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { config, isAuthConfigured } = require('./config');
const {
  isAllowedStaffEmail,
  staffEmailFromOidcUser,
} = require('./auth');
const {
  renderAccessDeniedPage,
  renderAuthNotConfiguredPage,
} = require('./render');
const {
  renderAdminPage,
  renderHistoryPage,
  renderInternalPage,
  renderKumaHistoryPage,
  renderMonitorEditor,
} = require('./pages');
const { fetchKumaSnapshot, kumaMonitor } = require('./kuma');
const { samplesForCatalog } = require('./kuma-stats');
const { normalizeWindow, samplesFor } = require('./history');
const { startScheduler } = require('./scheduler');
const {
  createMonitor,
  dataDir,
  deleteMonitor,
  getMonitor,
  loadMonitors,
  updateMonitor,
} = require('./store');

function createKumaProxy() {
  return createProxyMiddleware({
    target: config.kumaUpstream,
    // Keep the inbound Host so Kuma can map status.processpro.io to the public page.
    changeOrigin: false,
    ws: true,
    xfwd: true,
    on: {
      error(err, _req, res) {
        if (res && !res.headersSent && typeof res.writeHead === 'function') {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end(`Uptime Kuma upstream unavailable: ${err.message}`);
          return;
        }
        if (res && typeof res.end === 'function') {
          res.end();
        }
      },
    },
  });
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  const kumaProxy = config.internalOnly ? null : createKumaProxy();

  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      app: 'processpro-status-gateway',
      internalAuthConfigured: isAuthConfigured() || config.authDisabled,
    });
  });

  app.use(
    '/internal/assets',
    express.static(path.join(__dirname, '..', 'public'), {
      maxAge: '1h',
      index: false,
    })
  );

  if (config.authDisabled) {
    mountStaffRoutes(app, { enforceAuth: false });
  } else if (isAuthConfigured()) {
    app.use(
      auth({
        authRequired: false,
        auth0Logout: false,
        idpLogout: true,
        secret: config.sessionSecret,
        baseURL: config.baseUrl,
        clientID: config.azureAd.clientId,
        clientSecret: config.azureAd.clientSecret,
        issuerBaseURL: `https://login.microsoftonline.com/${config.azureAd.tenantId}/v2.0`,
        routes: {
          login: '/internal/login',
          logout: '/internal/logout',
          callback: '/internal/callback',
        },
        authorizationParams: {
          response_type: 'code',
          scope: 'openid profile email',
        },
      })
    );
    mountStaffRoutes(app, { enforceAuth: true });
  } else {
    app.get(['/internal', '/internal/', '/admin', '/admin/*'], (_req, res) => {
      res.status(503).type('html').send(renderAuthNotConfiguredPage());
    });
  }

  if (kumaProxy) {
    app.use((req, res, next) => {
      if (
        req.path === '/health' ||
        req.path.startsWith('/internal') ||
        req.path.startsWith('/admin')
      ) {
        return next();
      }
      return kumaProxy(req, res, next);
    });
  } else {
    app.get('/', (_req, res) => {
      res.type('html').send(
        '<p>Internal-only mode. Visit <a href="/internal">/internal</a>.</p>'
      );
    });
  }

  app.locals.kumaProxy = kumaProxy;
  return app;
}

function samplesByMonitor(monitors, windowKey) {
  const dir = dataDir();
  const samplesById = {};
  for (const monitor of monitors) {
    samplesById[monitor.id] = samplesFor(dir, monitor.id);
  }
  try {
    const fromKuma = samplesForCatalog(monitors, windowKey);
    for (const [id, samples] of Object.entries(fromKuma)) {
      if (samples.length) {
        samplesById[id] = samples;
      }
    }
  } catch (error) {
    console.error('Kuma history unavailable:', error.message);
  }
  return samplesById;
}

async function databaseMonitors(windowKey) {
  try {
    const snapshot = await fetchKumaSnapshot();
    const databases = snapshot.monitors.filter((monitor) => monitor.type === 'sqlserver');
    const dir = dataDir();
    for (const monitor of databases) {
      const merged = new Map();
      for (const sample of samplesFor(dir, `kuma-${monitor.id}`)) {
        if (sample.t) {
          merged.set(sample.t, sample);
        }
      }
      for (const sample of monitor.samples || []) {
        if (sample.t) {
          merged.set(sample.t, sample);
        }
      }
      monitor.samples = [...merged.values()].sort((left, right) => left.t - right.t);
    }
    return { snapshot, databases };
  } catch {
    return { snapshot: { monitors: [] }, databases: [] };
  }
}

function mountStaffRoutes(app, { enforceAuth }) {
  const guard = enforceAuth ? requiresAuth() : (_req, _res, next) => next();

  async function ensureStaff(req, res, next) {
    if (!enforceAuth) {
      req.staffEmail = 'dev@processpro.io';
      return next();
    }

    const email = staffEmailFromOidcUser(req.oidc?.user);
    if (!isAllowedStaffEmail(email)) {
      return res.status(403).type('html').send(renderAccessDeniedPage());
    }

    req.staffEmail = email;
    return next();
  }

  const staff = [guard, ensureStaff];

  app.get(['/internal', '/internal/'], ...staff, (req, res) => {
    const monitors = loadMonitors();
    const windowKey = normalizeWindow(req.query.window);
    res.type('html').send(
      renderInternalPage({
        email: req.staffEmail,
        monitors,
        samplesById: samplesByMonitor(monitors, windowKey),
        windowKey,
      })
    );
  });

  app.get('/internal/monitors/:id', ...staff, (req, res) => {
    const monitor = getMonitor(req.params.id);
    if (!monitor) {
      return res.status(404).type('text').send('Monitor not found');
    }
    const windowKey = normalizeWindow(req.query.window);
    return res.type('html').send(
      renderHistoryPage({
        email: req.staffEmail,
        monitor,
        samples: samplesByMonitor([monitor], windowKey)[monitor.id] || [],
        windowKey,
        mode: 'internal',
      })
    );
  });

  app.get(['/admin', '/admin/'], ...staff, async (req, res) => {
    const monitors = loadMonitors();
    const windowKey = normalizeWindow(req.query.window);
    const { databases } = await databaseMonitors(windowKey);
    res.type('html').send(
      renderAdminPage({
        email: req.staffEmail,
        monitors,
        samplesById: samplesByMonitor(monitors, windowKey),
        databases,
        windowKey,
        notice: req.query.notice || '',
      })
    );
  });

  app.get('/admin/monitors/new', ...staff, (req, res) => {
    res.type('html').send(renderMonitorEditor({ email: req.staffEmail, monitor: null, error: '' }));
  });

  app.post('/admin/monitors', ...staff, (req, res) => {
    try {
      createMonitor(req.body);
      return res.redirect('/admin?notice=Monitor%20added');
    } catch (error) {
      return res.status(400).type('html').send(
        renderMonitorEditor({ email: req.staffEmail, monitor: req.body, error: error.message })
      );
    }
  });

  app.get('/admin/monitors/:id', ...staff, (req, res) => {
    const monitor = getMonitor(req.params.id);
    if (!monitor) {
      return res.status(404).type('text').send('Monitor not found');
    }
    const windowKey = normalizeWindow(req.query.window);
    return res.type('html').send(
      renderHistoryPage({
        email: req.staffEmail,
        monitor,
        samples: samplesByMonitor([monitor], windowKey)[monitor.id] || [],
        windowKey,
        mode: 'admin',
      })
    );
  });

  app.post('/admin/monitors/:id', ...staff, (req, res) => {
    try {
      const updated = updateMonitor(req.params.id, req.body);
      if (!updated) {
        return res.status(404).type('text').send('Monitor not found');
      }
      return res.redirect(`/admin/monitors/${encodeURIComponent(updated.id)}?notice=Saved`);
    } catch (error) {
      return res.status(400).type('html').send(
        renderMonitorEditor({
          email: req.staffEmail,
          monitor: { ...req.body, id: req.params.id },
          error: error.message,
        })
      );
    }
  });

  app.post('/admin/monitors/:id/delete', ...staff, (req, res) => {
    deleteMonitor(req.params.id);
    return res.redirect('/admin?notice=Monitor%20removed');
  });

  app.get('/admin/kuma/:id', ...staff, async (req, res) => {
    const windowKey = normalizeWindow(req.query.window);
    const { snapshot } = await databaseMonitors(windowKey);
    const monitor = kumaMonitor(snapshot, req.params.id);
    if (!monitor) {
      return res.status(404).type('text').send('Monitor not found');
    }
    return res.type('html').send(
      renderKumaHistoryPage({
        email: req.staffEmail,
        monitor,
        windowKey: normalizeWindow(req.query.window),
      })
    );
  });
}

function start() {
  loadMonitors();
  startScheduler();
  const app = createApp();
  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `Status gateway listening on ${config.port} (internalOnly=${config.internalOnly}, authDisabled=${config.authDisabled})`
    );
  });

  const kumaProxy = app.locals.kumaProxy;
  if (kumaProxy && typeof kumaProxy.upgrade === 'function') {
    server.on('upgrade', (req, socket, head) => {
      if (req.url && req.url.startsWith('/internal')) {
        socket.destroy();
        return;
      }
      kumaProxy.upgrade(req, socket, head);
    });
  }
}

if (require.main === module) {
  start();
}

module.exports = {
  createApp,
};
