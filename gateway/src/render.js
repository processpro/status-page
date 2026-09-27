'use strict';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusBadge(ok) {
  return ok
    ? '<span class="badge badge-up">Up</span>'
    : '<span class="badge badge-down">Down</span>';
}

function renderAppRows(apps) {
  if (!apps.length) {
    return '<tr><td colspan="5">No single-app services configured.</td></tr>';
  }

  return apps
    .map((app) => {
      const detail = app.error
        ? escapeHtml(app.error)
        : app.statusCode
          ? `HTTP ${escapeHtml(app.statusCode)} · ${escapeHtml(app.elapsedMs)}ms`
          : '—';
      return `<tr>
  <td><a href="${escapeHtml(app.url)}" rel="noopener noreferrer">${escapeHtml(app.host)}</a></td>
  <td>${escapeHtml(app.environment)}</td>
  <td><code>${escapeHtml(app.azureSiteHint)}</code></td>
  <td>${statusBadge(app.ok)}</td>
  <td class="muted">${detail}</td>
</tr>`;
    })
    .join('\n');
}

function renderInternalPage({ summary, email, refreshSeconds = 60 }) {
  const production = summary.apps.filter((app) => app.environment === 'production');
  const demo = summary.apps.filter((app) => app.environment === 'demo');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="${escapeHtml(refreshSeconds)}" />
  <title>Internal app services · ProcessPro Status</title>
  <link rel="stylesheet" href="/internal/assets/internal.css" />
</head>
<body>
  <div class="page">
    <header class="top">
      <div>
        <p class="eyebrow">ProcessPro · Staff only</p>
        <h1>Internal app services</h1>
        <p class="lede">Single-tenant client apps are hidden from the public status page. This list is for @processpro.io and @processpro.com staff.</p>
      </div>
      <div class="top-actions">
        <a class="link" href="/">Public status</a>
        <a class="link" href="/internal/logout">Sign out</a>
      </div>
    </header>

    <section class="summary">
      <div class="stat">
        <strong>${escapeHtml(summary.up)}</strong>
        <span>Up</span>
      </div>
      <div class="stat">
        <strong>${escapeHtml(summary.down)}</strong>
        <span>Down</span>
      </div>
      <div class="stat">
        <strong>${escapeHtml(summary.total)}</strong>
        <span>Total</span>
      </div>
      <div class="stat wide">
        <strong>${escapeHtml(email || 'staff')}</strong>
        <span>Signed in · refreshed ${escapeHtml(summary.generatedAt)}</span>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>Production single-app services</h2>
        <p>Hosts like giltrapgroup.processpro.io and toyota.processpro.io</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Host</th>
              <th>Env</th>
              <th>Azure app</th>
              <th>Status</th>
              <th>Probe</th>
            </tr>
          </thead>
          <tbody>
            ${renderAppRows(production)}
          </tbody>
        </table>
      </div>
    </section>

    ${
      demo.length
        ? `<section class="panel">
      <div class="panel-head">
        <h2>Demo app services</h2>
        <p>Optional demo tenants configured via DEMO_APP_SERVICES</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Host</th>
              <th>Env</th>
              <th>Azure app</th>
              <th>Status</th>
              <th>Probe</th>
            </tr>
          </thead>
          <tbody>
            ${renderAppRows(demo)}
          </tbody>
        </table>
      </div>
    </section>`
        : ''
    }
  </div>
</body>
</html>`;
}

function renderAccessDeniedPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Access denied · ProcessPro Status</title>
  <link rel="stylesheet" href="/internal/assets/internal.css" />
</head>
<body>
  <div class="page narrow">
    <p class="eyebrow">ProcessPro · Staff only</p>
    <h1>Access denied</h1>
    <p class="lede">Staff sign-in must use an @processpro.io or @processpro.com account. Ask an administrator if your Entra user is in a different tenant.</p>
    <div class="top-actions">
      <a class="link" href="/internal/logout">Sign out</a>
      <a class="link" href="/">Public status</a>
    </div>
  </div>
</body>
</html>`;
}

function renderAuthNotConfiguredPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Auth not configured · ProcessPro Status</title>
  <link rel="stylesheet" href="/internal/assets/internal.css" />
</head>
<body>
  <div class="page narrow">
    <p class="eyebrow">ProcessPro · Staff only</p>
    <h1>Sign-in is not configured</h1>
    <p class="lede">Set AZURE_AD_TENANT_ID, AZURE_AD_CLIENT_ID, and AZURE_AD_CLIENT_SECRET on the App Service, then restart. Until then this page stays closed.</p>
    <div class="top-actions">
      <a class="link" href="/">Public status</a>
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  escapeHtml,
  renderAccessDeniedPage,
  renderAuthNotConfiguredPage,
  renderInternalPage,
};
