'use strict';

function parseList(value, fallback = []) {
  if (!value || !String(value).trim()) {
    return [...fallback];
  }
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

const defaultSingleApps = [
  'champion',
  'freetrial',
  'giltrapgroup',
  'mcalpinehussmann',
  'orc',
  'toyota',
  'vga',
  'wisegroup',
];

const config = {
  port: Number(process.env.PORT || process.env.GATEWAY_PORT || 8080),
  kumaUpstream: process.env.KUMA_UPSTREAM || 'http://127.0.0.1:3001',
  baseUrl: process.env.BASE_URL || 'http://localhost:8080',
  internalOnly: process.env.INTERNAL_ONLY === 'true',
  authDisabled: process.env.AUTH_DISABLED === 'true',
  allowedEmailDomains: parseList(process.env.ALLOWED_EMAIL_DOMAINS, [
    'processpro.io',
    'processpro.com',
  ]).map((domain) => domain.toLowerCase()),
  azureAd: {
    tenantId: process.env.AZURE_AD_TENANT_ID || '',
    clientId: process.env.AZURE_AD_CLIENT_ID || '',
    clientSecret: process.env.AZURE_AD_CLIENT_SECRET || '',
  },
  singleApps: parseList(process.env.SINGLE_APP_SERVICES, defaultSingleApps),
  demoApps: parseList(process.env.DEMO_APP_SERVICES, []),
  probePath: process.env.PROBE_PATH || '/Account/Login',
  probeTimeoutMs: Number(process.env.PROBE_TIMEOUT_MS || 8000),
  sessionSecret: process.env.SESSION_SECRET || 'change-me-in-production',
};

function isAuthConfigured() {
  return Boolean(
    config.azureAd.tenantId &&
      config.azureAd.clientId &&
      config.azureAd.clientSecret
  );
}

module.exports = {
  config,
  defaultSingleApps,
  isAuthConfigured,
  parseList,
};
