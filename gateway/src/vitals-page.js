'use strict';

const { escapeHtml } = require('./render');
const { renderShell } = require('./pages');
const {
  MEMORY_RED,
  clampPercent,
  formatPercent,
  renderMemoryChart,
} = require('./vitals-eval');

function levelLabel(level) {
  if (level === 'hot') {
    return 'Over the line';
  }
  if (level === 'warn') {
    return 'Watch';
  }
  if (level === 'ok') {
    return 'Room to spare';
  }
  return 'No data';
}

function meter(value, level) {
  const width = clampPercent(value);
  const fill = level === 'none' ? 'ok' : level;
  return `<div class="vital-meter">
    <div class="vital-track"><div class="vital-fill ${fill}" style="width:${width}%"></div></div>
    <i class="vital-limit" style="left:${MEMORY_RED}%" title="${MEMORY_RED}%"></i>
  </div>`;
}

function ageLabel(snapshot, error) {
  if (!snapshot?.fetchedAt) {
    return error || 'Waiting for the first Azure reading.';
  }
  const when = snapshot.fetchedAt.replace('T', ' ').slice(0, 19);
  return error
    ? `Last good reading ${when} UTC. Latest read failed: ${error}`
    : `Read at ${when} UTC. Refreshes every 5 minutes.`;
}

function planCard(plan) {
  const href = `/internal/vitals/plans/${encodeURIComponent(plan.resourceGroup)}/${encodeURIComponent(plan.name)}`;
  return `<a class="vital-card ${plan.memoryLevel}" href="${href}">
    <div class="vital-card-top">
      <div>
        <strong>${escapeHtml(plan.name)}</strong>
        <div class="muted">${escapeHtml(plan.location)} · ${escapeHtml(plan.sku || 'App Service')}</div>
      </div>
      <span class="vital-state ${plan.memoryLevel}">${escapeHtml(levelLabel(plan.memoryLevel))}</span>
    </div>
    <div class="vital-figure">${escapeHtml(formatPercent(plan.memoryHour))} <small>memory, last hour</small></div>
    ${meter(plan.memoryHour, plan.memoryLevel)}
    <div class="vital-cpu ${plan.cpuLevel}">CPU ${escapeHtml(formatPercent(plan.cpuHour))} <small>last hour</small></div>
  </a>`;
}

function sqlCard(server) {
  const href = `/internal/vitals/sql/${encodeURIComponent(server.resourceGroup)}/${encodeURIComponent(server.name)}`;
  const hottest = server.hottest;
  const level = hottest?.level || 'none';
  return `<a class="vital-card ${level}" href="${href}">
    <div class="vital-card-top">
      <div>
        <strong>${escapeHtml(server.name)}</strong>
        <div class="muted">${escapeHtml(server.location)} · SQL</div>
      </div>
      <span class="vital-state ${level}">${escapeHtml(levelLabel(level))}</span>
    </div>
    <div class="vital-figure">${escapeHtml(formatPercent(hottest?.hour))} <small>${escapeHtml(hottest?.metric || 'DTU')} on ${escapeHtml(hottest?.name || 'no database')}</small></div>
    ${meter(hottest?.hour, level)}
    <div class="muted">Busiest database on this server</div>
  </a>`;
}

function queryHref(path, params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      search.set(key, value);
    }
  });
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

function windowLinks(basePath, selected) {
  return ['24h', '7d']
    .map((key) => {
      const label = key === '7d' ? '7 days' : '24 hours';
      const cls = key === selected ? 'window active' : 'window';
      const joiner = basePath.includes('?') ? '&' : '?';
      return `<a class="${cls}" href="${escapeHtml(`${basePath}${joiner}window=${key}`)}">${label}</a>`;
    })
    .join('');
}

function renderVitalsPage({ email, snapshot, error }) {
  const data = snapshot || { plans: [], sqlServers: [] };
  const plans = (data.plans || []).map(planCard).join('')
    || '<p class="muted">No App Service plans returned.</p>';
  const sql = (data.sqlServers || []).map(sqlCard).join('')
    || '<p class="muted">No SQL servers returned.</p>';
  const body = `
    <div class="page-head">
      <div>
        <h1>Vitals</h1>
        <p class="lede">Memory is the early warning. The line on each bar is 85%. Amber starts at 70%. CPU turns red only when the last hour averages over 40%, or it stays above 80% for 15 minutes. ${escapeHtml(ageLabel(data.fetchedAt ? data : snapshot, error))}</p>
      </div>
    </div>
    ${error && !data.plans?.length ? `<p class="form-error">${escapeHtml(error)}</p>` : ''}
    <section class="panel">
      <div class="panel-head">
        <h2>App Service plans</h2>
        <p>One card per server. Open a card to see which apps are using the memory.</p>
      </div>
      <div class="vital-grid">${plans}</div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>SQL servers</h2>
        <p>The bar is the busiest database. Open a server to see every database.</p>
      </div>
      <div class="vital-grid">${sql}</div>
    </section>`;
  return renderShell({ title: 'Vitals', active: 'vitals', email, body, refreshSeconds: 300 });
}

function renderVitalsPlanPage({ email, detail, windowKey }) {
  const plan = detail.plan;
  const self = `/internal/vitals/plans/${encodeURIComponent(plan.resourceGroup)}/${encodeURIComponent(plan.name)}`;
  const chart = detail.chart || {
    unit: 'percent',
    title: 'Server memory',
    caption: 'Each point is the server’s memory. Time runs left to right. The dashed line is 85%.',
  };
  const choice = (label, params, active) => {
    const cls = active ? 'window active' : 'window';
    return `<a class="${cls}" href="${escapeHtml(queryHref(self, { window: windowKey, ...params }))}">${escapeHtml(label)}</a>`;
  };
  const rows = (detail.apps || [])
    .map((app) => {
      const memoryHref = queryHref(self, { window: windowKey, app: app.name, measure: 'memory' });
      const cpuHref = queryHref(self, { window: windowKey, app: app.name, measure: 'cpu' });
      const current = app.name === detail.selectedApp ? ' class="vital-current"' : '';
      return `<tr${current}><td><a href="${escapeHtml(memoryHref)}">${escapeHtml(app.name)}</a></td><td>${app.memoryMb == null ? '—' : `${escapeHtml(app.memoryMb)} MB`}</td><td><a href="${escapeHtml(cpuHref)}">CPU</a></td></tr>`;
    })
    .join('');
  const body = `
    <div class="page-head">
      <div>
        <p class="eyebrow"><a class="text-link" href="/internal/vitals">Back</a></p>
        <h1>${escapeHtml(plan.name)}</h1>
        <p class="lede">${escapeHtml(plan.location || '')} ${plan.sku ? `· ${escapeHtml(plan.sku)}` : ''} · memory last hour ${escapeHtml(formatPercent(plan.memoryHour))}.</p>
      </div>
      <nav class="windows">${windowLinks(queryHref(self, { app: detail.selectedApp, measure: detail.measure === 'cpu' ? 'cpu' : '' }), windowKey)}</nav>
    </div>
    <section class="panel">
      <div class="panel-head">
        <h2>${escapeHtml(chart.title)} · ${windowKey === '7d' ? '7 days' : '24 hours'}</h2>
        <p>${escapeHtml(chart.caption || '')}</p>
      </div>
      <nav class="windows">
        ${choice('Server memory', {}, !detail.selectedApp && detail.measure !== 'cpu')}
        ${choice('Server CPU', { measure: 'cpu' }, !detail.selectedApp && detail.measure === 'cpu')}
      </nav>
      ${renderMemoryChart(detail.series, { unit: chart.unit, span: windowKey, limit: chart.unit === 'percent' ? MEMORY_RED : null })}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Apps on this server</h2><p>Select an app to put its memory or CPU on the chart. The last-hour memory is listed beside the name.</p></div>
      <div class="table-wrap"><table><thead><tr><th>App</th><th>Memory, last hour</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="3">No apps on this plan.</td></tr>'}</tbody></table></div>
    </section>`;
  return renderShell({ title: plan.name, active: 'vitals', email, body });
}

function renderVitalsSqlPage({ email, detail, windowKey }) {
  const server = detail.server;
  const self = `/internal/vitals/sql/${encodeURIComponent(server.resourceGroup)}/${encodeURIComponent(server.name)}`;
  const rows = (detail.databases || [])
    .map((database) => {
      const href = `${self}?window=${windowKey}&db=${encodeURIComponent(database.name)}`;
      const current = database.name === detail.selected ? ' class="vital-current"' : '';
      return `<tr${current}><td><a href="${escapeHtml(href)}">${escapeHtml(database.name)}</a></td><td>${escapeHtml(database.metric)}</td><td>${escapeHtml(formatPercent(database.hour))}</td><td>${meter(database.hour, database.level)}</td></tr>`;
    })
    .join('');
  const chartBase = detail.selected ? `${self}?db=${encodeURIComponent(detail.selected)}` : self;
  const body = `
    <div class="page-head">
      <div>
        <p class="eyebrow"><a class="text-link" href="/internal/vitals">Back</a></p>
        <h1>${escapeHtml(server.name)}</h1>
        <p class="lede">${escapeHtml(server.location || '')} · ${escapeHtml(detail.selected || 'database')} · the line is ${MEMORY_RED}%.</p>
      </div>
      <nav class="windows">${windowLinks(chartBase, windowKey)}</nav>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>${escapeHtml(detail.selected || 'Database')} · ${windowKey === '7d' ? '7 days' : '24 hours'}</h2></div>
      <p class="muted">Each point is this database. Time runs left to right. The dashed line is 85%.</p>
      ${renderMemoryChart(detail.series, { span: windowKey })}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Databases</h2></div>
      <div class="table-wrap"><table><thead><tr><th>Database</th><th>Measure</th><th>Last hour</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4">No databases.</td></tr>'}</tbody></table></div>
    </section>`;
  return renderShell({ title: server.name, active: 'vitals', email, body });
}

module.exports = {
  renderVitalsPage,
  renderVitalsPlanPage,
  renderVitalsSqlPage,
};
