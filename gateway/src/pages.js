'use strict';

const { escapeHtml } = require('./render');
const { GROUPS, groupById } = require('./groups');
const { normalizeWindow, series } = require('./history');

const WINDOW_LABELS = [
  ['1h', '1 hour'],
  ['24h', '24 hours'],
  ['7d', '7 days'],
];

function percentLabel(value) {
  if (value == null) {
    return 'No checks yet';
  }
  return `${Math.round(value * 1000) / 10}% up`;
}

function renderBars(view) {
  const title = view.cells
    .map((cell) => (cell === 'empty' ? 'no data' : cell))
    .join(', ');
  const cells = view.cells
    .map((cell) => `<i class="beat beat-${cell}"></i>`)
    .join('');
  return `<div class="beats" title="${escapeHtml(title)}" aria-hidden="true">${cells}</div>`;
}

function windowCaption(windowKey) {
  const key = normalizeWindow(windowKey);
  if (key === '1h') {
    return '1 hour is one block per minute, and the page refreshes each minute so the bar moves on.';
  }
  if (key === '7d') {
    return '7 days uses the hourly history already kept for regional sites and databases.';
  }
  return '24 hours uses the minute history already kept for regional sites and databases.';
}

function windowLinks(basePath, selected) {
  const key = normalizeWindow(selected);
  return `<nav class="windows">${WINDOW_LABELS.map(([id, label]) => {
    const href = `${basePath}${basePath.includes('?') ? '&' : '?'}window=${id}`;
    const cls = id === key ? 'window active' : 'window';
    return `<a class="${cls}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  }).join('')}</nav>`;
}

function statusPill(ok, pending) {
  if (pending) {
    return '<span class="badge badge-wait">Waiting</span>';
  }
  return ok
    ? '<span class="badge badge-up">Up</span>'
    : '<span class="badge badge-down">Down</span>';
}

function renderShell({ title, active, email, body, refreshSeconds }) {
  const item = (id, href, label, icon) => {
    const cls = active === id ? 'pp-nav-item active' : 'pp-nav-item';
    return `<a class="${cls}" href="${href}">${icon}<span>${label}</span></a>`;
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · ProcessPro Status</title>
  ${refreshSeconds ? `<meta http-equiv="refresh" content="${Number(refreshSeconds)}" />` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/internal/assets/internal.css" />
</head>
<body>
  <div class="pp-app">
    <aside class="pp-sidebar">
      <div class="pp-brand">
        <div class="pp-brand-mark">P</div>
        <div class="pp-brand-copy">
          <strong>Status</strong>
          <small>ProcessPro</small>
        </div>
      </div>
      <nav class="pp-navigation">
        <span class="pp-nav-label">Views</span>
        ${item('public', '/', 'Public status', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>')}
        ${item('internal', '/internal', 'Internal', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/></svg>')}
        ${item('admin', '/admin', 'Admin', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 4v5c0 5-3.4 7.6-8 9-4.6-1.4-8-4-8-9V7l8-4z"/></svg>')}
      </nav>
      <div class="pp-sidebar-footer">
        <a class="pp-button pp-button-ghost pp-full" href="/internal/logout">Sign out</a>
      </div>
    </aside>
    <div class="pp-shell">
      <header class="pp-topbar">
        <div class="pp-breadcrumbs">
          <span>ProcessPro</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
          <span class="pp-breadcrumb-current">${escapeHtml(title)}</span>
        </div>
        <div class="pp-user-copy">
          <strong>${escapeHtml(email || 'Staff')}</strong>
          <small>Staff</small>
        </div>
      </header>
      <main class="pp-content">
        <div class="pp-page">
          ${body}
        </div>
      </main>
    </div>
  </div>
</body>
</html>`;
}

function monitorRow(monitor, view, href) {
  const latest = view.latest;
  const pending = !latest;
  const detail = pending
    ? 'First check is still running'
    : latest.code
      ? `HTTP ${latest.code}${latest.ms != null ? ` · ${latest.ms}ms` : ''}`
      : 'No response';
  return `<tr>
    <td><a href="${escapeHtml(href)}">${escapeHtml(monitor.name)}</a><div class="muted">${escapeHtml(monitor.url)}</div></td>
    <td>${statusPill(latest && latest.ok, pending)}</td>
    <td>${renderBars(view.series)}<div class="muted">${escapeHtml(percentLabel(view.series.percent))}</div></td>
    <td class="muted">${escapeHtml(detail)}</td>
  </tr>`;
}

function renderGroupSection(title, hint, rows, empty) {
  return `<section class="panel">
    <div class="panel-head">
      <h2>${escapeHtml(title)}</h2>
      ${hint ? `<p>${escapeHtml(hint)}</p>` : ''}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Monitor</th><th>Status</th><th>History</th><th>Latest</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4">${escapeHtml(empty)}</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function viewFor(monitor, samples, windowKey, now) {
  const list = samples || [];
  const latest = list.length ? list[list.length - 1] : null;
  return {
    latest,
    series: series(list, windowKey, now),
  };
}

function renderInternalPage({ email, monitors, samplesById, windowKey }) {
  const now = Date.now();
  const sections = GROUPS.filter((group) => group.visibility === 'internal')
    .map((group) => {
      const rows = monitors
        .filter((monitor) => monitor.group === group.id && monitor.enabled)
        .map((monitor) =>
          monitorRow(
            monitor,
            viewFor(monitor, samplesById[monitor.id], windowKey, now),
            `/internal/monitors/${encodeURIComponent(monitor.id)}?window=${normalizeWindow(windowKey)}`
          )
        )
        .join('');
      return renderGroupSection(group.label, group.hint, rows, 'Nothing in this group yet.');
    })
    .join('');

  const body = `
    <div class="page-head">
      <div>
        <h1>Internal instances</h1>
        <p class="lede">Single-app services stay off the public page. ${escapeHtml(windowCaption(windowKey))}</p>
      </div>
      ${windowLinks('/internal', windowKey)}
    </div>
    ${sections}`;
  return renderShell({ title: 'Internal', active: 'internal', email, body, refreshSeconds: 60 });
}

function renderAdminPage({ email, monitors, samplesById, databases, windowKey, notice }) {
  const now = Date.now();
  const key = normalizeWindow(windowKey);
  const ourSections = GROUPS.map((group) => {
    const rows = monitors
      .filter((monitor) => monitor.group === group.id)
      .map((monitor) => {
        const view = viewFor(monitor, samplesById[monitor.id], key, now);
        const href = `/admin/monitors/${encodeURIComponent(monitor.id)}?window=${key}`;
        return monitorRow(monitor, view, href).replace(
          '</tr>',
          `<td><a class="text-link" href="${escapeHtml(href)}">Details</a></td></tr>`
        );
      })
      .join('');
    return renderGroupSection(
      `${group.label}${group.hint ? ` · ${group.hint}` : ''}`,
      group.visibility === 'public' ? 'Shown on the public page' : 'Staff only',
      rows ? rows.replace(/<th>Latest<\/th>/, '<th>Latest</th>') : '',
      'No monitors in this group.'
    ).replace(
      '<th>Latest</th></tr>',
      '<th>Latest</th><th></th></tr>'
    );
  }).join('');

  const dbRows = (databases || [])
    .map((monitor) => {
      const view = series(monitor.samples || [], key, now);
      const latest = (monitor.samples || []).at(-1);
      const href = `/admin/kuma/${encodeURIComponent(monitor.id)}?window=${key}`;
      const detail = !latest
        ? 'No checks yet'
        : `${latest.ms != null ? `${latest.ms}ms` : 'Checked'} · ${escapeHtml(new Date(latest.t).toISOString().slice(11, 19))} UTC`;
      return `<tr>
        <td><a href="${escapeHtml(href)}">${escapeHtml(monitor.name)}</a><div class="muted">${escapeHtml(monitor.groupName)} · Uptime Kuma</div></td>
        <td>${statusPill(latest ? Boolean(latest.ok) : false, !latest)}</td>
        <td>${renderBars(view)}<div class="muted">${escapeHtml(percentLabel(view.percent))}</div></td>
        <td class="muted">${detail}</td>
        <td><a class="text-link" href="${escapeHtml(href)}">Details</a></td>
      </tr>`;
    })
    .join('');

  const body = `
    ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ''}
    <div class="page-head">
      <div>
        <h1>Admin</h1>
        <p class="lede">Public and internal monitors on one screen. ${escapeHtml(windowCaption(windowKey))} Changing the window does not delete anything.</p>
      </div>
      <div class="head-actions">
        ${windowLinks(`/admin`, key)}
        <a class="pp-button" href="/admin/monitors/new">Add monitor</a>
      </div>
    </div>
    ${ourSections}
    ${renderGroupSection('Databases', 'From Uptime Kuma. Edit those connections in the Kuma dashboard.', dbRows, 'No database monitors reported.').replace('<th>Latest</th></tr>', '<th>Latest</th><th></th></tr>')}`;

  return renderShell({ title: 'Admin', active: 'admin', email, body, refreshSeconds: 60 });
}

function renderHistoryPage({ email, monitor, samples, windowKey, mode }) {
  const key = normalizeWindow(windowKey);
  const view = viewFor(monitor, samples, key);
  const back = mode === 'admin' ? '/admin' : '/internal';
  const self = mode === 'admin'
    ? `/admin/monitors/${encodeURIComponent(monitor.id)}`
    : `/internal/monitors/${encodeURIComponent(monitor.id)}`;
  const recent = [...samples].slice(-12).reverse();
  const rows = recent
    .map((sample) => {
      const when = new Date(sample.t).toISOString().replace('T', ' ').slice(0, 19);
      return `<tr><td>${escapeHtml(when)} UTC</td><td>${statusPill(Boolean(sample.ok), false)}</td><td class="muted">${sample.code ? `HTTP ${escapeHtml(sample.code)}` : '—'} ${sample.ms != null ? `· ${escapeHtml(sample.ms)}ms` : ''}</td></tr>`;
    })
    .join('');
  const edit = mode === 'admin'
    ? `<section class="panel"><div class="panel-head"><h2>Edit</h2></div>${renderMonitorForm(monitor, null)}</section>`
    : '';
  const body = `
    <div class="page-head">
      <div>
        <p class="eyebrow"><a class="text-link" href="${back}">Back</a></p>
        <h1>${escapeHtml(monitor.name)}</h1>
        <p class="lede">${escapeHtml(monitor.url)} · ${escapeHtml(groupById(monitor.group)?.label || monitor.group)} · ${escapeHtml(monitor.visibility)}</p>
      </div>
      ${windowLinks(self, key)}
    </div>
    <section class="panel">
      <div class="panel-head">
        <h2>${statusPill(view.latest && view.latest.ok, !view.latest)} ${escapeHtml(percentLabel(view.series.percent))}</h2>
      </div>
      <div class="beats beats-large">${view.series.cells.map((cell) => `<i class="beat beat-${cell}"></i>`).join('')}</div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Recent checks</h2></div>
      <div class="table-wrap"><table><thead><tr><th>Time</th><th>Status</th><th>Detail</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No checks yet.</td></tr>'}</tbody></table></div>
    </section>
    ${edit}`;
  return renderShell({
    title: monitor.name,
    active: mode === 'admin' ? 'admin' : 'internal',
    email,
    body,
  });
}

function renderKumaHistoryPage({ email, monitor, windowKey }) {
  const key = normalizeWindow(windowKey);
  const samples = monitor.samples || [];
  const view = series(samples, key);
  const latest = samples.at(-1);
  const body = `
    <div class="page-head">
      <div>
        <p class="eyebrow"><a class="text-link" href="/admin">Back</a></p>
        <h1>${escapeHtml(monitor.name)}</h1>
        <p class="lede">${escapeHtml(monitor.groupName)} · Uptime Kuma ${escapeHtml(monitor.type)}. This record is read only here.</p>
      </div>
      ${windowLinks(`/admin/kuma/${encodeURIComponent(monitor.id)}`, key)}
    </div>
    <section class="panel">
      <div class="panel-head"><h2>${statusPill(latest ? Boolean(latest.ok) : false, !latest)} ${escapeHtml(percentLabel(view.percent))}</h2></div>
      <div class="beats beats-large">${view.cells.map((cell) => `<i class="beat beat-${cell}"></i>`).join('')}</div>
      <p class="muted">Checks are kept for 8 days, the same as the instance bars. The 24 hour figure from Uptime Kuma is ${monitor.uptime24 == null ? 'not reported' : `${Math.round(monitor.uptime24 * 1000) / 10}%`}.</p>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Recent checks</h2></div>
      <div class="table-wrap"><table><thead><tr><th>Time</th><th>Status</th><th>Detail</th></tr></thead><tbody>${
        [...samples].slice(-24).reverse().map((sample) => {
          const when = new Date(sample.t).toISOString().replace('T', ' ').slice(0, 19);
          return `<tr><td>${escapeHtml(when)} UTC</td><td>${statusPill(Boolean(sample.ok), false)}</td><td class="muted">${sample.ms != null ? `${escapeHtml(sample.ms)}ms` : '—'}</td></tr>`;
        }).join('') || '<tr><td colspan="3">No checks yet.</td></tr>'
      }</tbody></table></div>
    </section>`;
  return renderShell({ title: monitor.name, active: 'admin', email, body });
}

function renderMonitorForm(monitor, error) {
  const value = monitor || {
    name: '',
    url: 'https://',
    group: 'australia',
    visibility: 'internal',
    expect: 'redirect-ok',
    enabled: true,
  };
  const action = monitor && monitor.id ? `/admin/monitors/${encodeURIComponent(monitor.id)}` : '/admin/monitors';
  const groupOptions = GROUPS.map((group) => {
    const selected = group.id === value.group ? ' selected' : '';
    return `<option value="${escapeHtml(group.id)}"${selected}>${escapeHtml(group.label)} (${escapeHtml(group.hint || group.visibility)})</option>`;
  }).join('');
  return `<form class="stack-form" method="post" action="${escapeHtml(action)}">
    ${error ? `<p class="form-error">${escapeHtml(error)}</p>` : ''}
    <label>Name <input name="name" required maxlength="80" value="${escapeHtml(value.name)}" /></label>
    <label>Check URL <input name="url" required type="url" value="${escapeHtml(value.url)}" /></label>
    <label>Group <select name="group">${groupOptions}</select></label>
    <label>Audience
      <select name="visibility">
        <option value="internal"${value.visibility === 'internal' ? ' selected' : ''}>Internal only</option>
        <option value="public"${value.visibility === 'public' ? ' selected' : ''}>Public page</option>
      </select>
    </label>
    <label>Success
      <select name="expect">
        <option value="2xx"${value.expect !== 'redirect-ok' ? ' selected' : ''}>HTTP 200–299</option>
        <option value="redirect-ok"${value.expect === 'redirect-ok' ? ' selected' : ''}>HTTP 200 or a redirect</option>
      </select>
    </label>
    <label class="check"><input type="checkbox" name="enabled"${value.enabled ? ' checked' : ''} /> Enabled</label>
    <div class="form-actions">
      <button class="pp-button" type="submit">${monitor && monitor.id ? 'Save' : 'Add monitor'}</button>
      <a class="text-link" href="/admin">Cancel</a>
    </div>
  </form>
  ${
    monitor && monitor.id
      ? `<form method="post" action="/admin/monitors/${encodeURIComponent(monitor.id)}/delete" class="delete-form" onsubmit="return confirm('Remove this monitor?');">
          <button class="pp-button pp-button-danger" type="submit">Remove</button>
        </form>`
      : ''
  }`;
}

function renderMonitorEditor({ email, monitor, error }) {
  const body = `
    <div class="page-head">
      <div>
        <p class="eyebrow"><a class="text-link" href="/admin">Back</a></p>
        <h1>${monitor && monitor.id ? 'Edit monitor' : 'Add monitor'}</h1>
        <p class="lede">Use Australia, Demo, Europe, Canada, or the United States when a single app moves. Mark audience as public only for shared services.</p>
      </div>
    </div>
    <section class="panel">${renderMonitorForm(monitor, error)}</section>`;
  return renderShell({
    title: monitor && monitor.id ? 'Edit monitor' : 'Add monitor',
    active: 'admin',
    email,
    body,
  });
}

module.exports = {
  renderAdminPage,
  renderHistoryPage,
  renderInternalPage,
  renderKumaHistoryPage,
  renderMonitorEditor,
};
