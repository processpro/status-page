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

function withQuery(url, params) {
  return `${url}${url.includes('?') ? '&' : '?'}${params.toString()}`;
}

function identityRequest(env = process.env) {
  const resource = 'https://management.azure.com/';
  const clientId = env.AZURE_CLIENT_ID;
  if (env.IDENTITY_ENDPOINT && env.IDENTITY_HEADER) {
    const params = new URLSearchParams({ 'api-version': '2019-08-01', resource });
    if (clientId) {
      params.set('client_id', clientId);
    }
    return {
      url: withQuery(env.IDENTITY_ENDPOINT, params),
      headers: { 'X-IDENTITY-HEADER': env.IDENTITY_HEADER },
    };
  }
  if (env.MSI_ENDPOINT && env.MSI_SECRET) {
    const params = new URLSearchParams({ 'api-version': '2017-09-01', resource });
    if (clientId) {
      params.set('client_id', clientId);
    }
    return {
      url: withQuery(env.MSI_ENDPOINT, params),
      headers: { Secret: env.MSI_SECRET },
    };
  }
  const params = new URLSearchParams({ 'api-version': '2018-02-01', resource });
  if (clientId) {
    params.set('client_id', clientId);
  }
  return {
    url: `http://169.254.169.254/metadata/identity/oauth2/token?${params.toString()}`,
    headers: { Metadata: 'true' },
  };
}

function describeFetchError(error) {
  const cause = error.cause;
  const codes = [];
  if (cause?.code) {
    codes.push(cause.code);
  }
  if (Array.isArray(cause?.errors)) {
    cause.errors.forEach((item) => {
      if (item?.code) {
        codes.push(item.code);
      }
    });
  }
  return codes.length ? `${error.message} (${codes.join(', ')})` : error.message;
}

function tokenExpiry(body) {
  const expiresIn = Number(body.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return Date.now() + expiresIn * 1000;
  }
  const expiresOn = Number(body.expires_on);
  if (Number.isFinite(expiresOn) && expiresOn > 0) {
    return expiresOn > 10_000_000_000 ? expiresOn : expiresOn * 1000;
  }
  return Date.now() + 3600 * 1000;
}

async function armToken() {
  if (tokenCache.value && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.value;
  }
  const request = identityRequest();
  let response;
  try {
    response = await fetch(request.url, { headers: request.headers });
  } catch (error) {
    const where = process.env.IDENTITY_ENDPOINT ? 'App Service identity endpoint' : 'instance metadata';
    throw new Error(`Azure identity is not available from the ${where}. ${describeFetchError(error)}`);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Azure identity is not available (${response.status}). ${detail.slice(0, 180)}`);
  }
  const body = await response.json();
  tokenCache = {
    value: body.access_token,
    expiresAt: tokenExpiry(body),
  };
  return tokenCache.value;
}

async function armGet(pathname) {
  const token = await armToken();
  let response;
  try {
    response = await fetch(`${ARM}${pathname}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw new Error(`Azure request failed for ${pathname.split('?')[0]}. ${describeFetchError(error)}`);
  }
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
  identityRequest,
  listAll,
  queryMetrics,
  resetTokenCache,
  subscriptionId,
};
