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
const { probeAllApps } = require('./apps');
const {
  renderAccessDeniedPage,
  renderAuthNotConfiguredPage,
  renderInternalPage,
} = require('./render');

function createKumaProxy() {
  return createProxyMiddleware({
    target: config.kumaUpstream,
    changeOrigin: true,
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
    mountInternalRoutes(app, { enforceAuth: false });
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
    mountInternalRoutes(app, { enforceAuth: true });
  } else {
    app.get(['/internal', '/internal/'], (_req, res) => {
      res.status(503).type('html').send(renderAuthNotConfiguredPage());
    });
    app.get('/internal/*', (_req, res) => {
      res.status(503).type('html').send(renderAuthNotConfiguredPage());
    });
  }

  if (kumaProxy) {
    app.use((req, res, next) => {
      if (req.path === '/health' || req.path.startsWith('/internal')) {
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

function mountInternalRoutes(app, { enforceAuth }) {
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

  app.get(['/internal', '/internal/'], guard, ensureStaff, async (req, res) => {
    try {
      const summary = await probeAllApps();
      res.type('html').send(
        renderInternalPage({
          summary,
          email: req.staffEmail,
        })
      );
    } catch (error) {
      res.status(500).type('text').send(`Failed to load internal status: ${error.message}`);
    }
  });

  app.get('/internal/api/apps', guard, ensureStaff, async (_req, res) => {
    try {
      const summary = await probeAllApps();
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

function start() {
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
