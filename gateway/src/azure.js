'use strict';

const ARM = 'https://management.azure.com';
const DEFAULT_SUBSCRIPTION = '5129406a-0cc3-4b3b-b4b4-1e5585dee05b';

let tokenCache = { value: '', expiresAt: 0 };

function subscriptionId() {
  return process.env.AZURE_SUBSCRIPTION_ID || DEFAULT_SUBSCRIPTION;
}

function armTimespan(durationMs, now = Date.now()) {
  const end = new Date(now);
  const start = new Date(now - durationMs);
  return `${start.toISOString()}/${end.toISOString()}`;
}

async function armToken() {
  if (tokenCache.value && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.value;
  }
  const params = new URLSearchParams({
    'api-version': '2018-02-01',
    resource: 'https://management.azure.com/',
  });
  if (process.env.AZURE_CLIENT_ID) {
    params.set('client_id', process.env.AZURE_CLIENT_ID);
  }
  const response = await fetch(
    `http://169.254.169.254/metadata/identity/oauth2/token?${params.toString()}`,
    { headers: { Metadata: 'true' } }
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Azure identity is not available (${response.status}). ${detail.slice(0, 180)}`);
  }
  const body = await response.json();
  tokenCache = {
    value: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
  };
  return tokenCache.value;
}

async function armGet(pathname) {
  const token = await armToken();
  const response = await fetch(`${ARM}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Azure ${response.status} for ${pathname.split('?')[0]}. ${detail.slice(0, 180)}`);
  }
  return response.json();
}

async function listAll(pathname) {
  const items = [];
  let next = pathname;
  while (next) {
    const page = await armGet(next.startsWith('http') ? next.slice(ARM.length) : next);
    items.push(...(page.value || []));
    next = page.nextLink ? page.nextLink.slice(ARM.length) : '';
  }
  return items;
}

async function queryMetrics(resourceId, metricNames, { timespan, interval, aggregation = 'Average' }) {
  const params = new URLSearchParams({
    'api-version': '2018-01-01',
    metricnames: metricNames.join(','),
    timespan,
    interval,
    aggregation,
  });
  return armGet(`${resourceId}/providers/microsoft.insights/metrics?${params.toString()}`);
}

function resetTokenCache() {
  tokenCache = { value: '', expiresAt: 0 };
}

module.exports = {
  DEFAULT_SUBSCRIPTION,
  armGet,
  armTimespan,
  listAll,
  queryMetrics,
  resetTokenCache,
  subscriptionId,
};
