'use strict';

const { config } = require('./config');

function normalizeEmail(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function emailDomain(email) {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at === normalized.length - 1) {
    return '';
  }
  return normalized.slice(at + 1);
}

function isAllowedStaffEmail(email, allowedDomains = config.allowedEmailDomains) {
  const domain = emailDomain(email);
  if (!domain) {
    return false;
  }
  return allowedDomains.map((item) => item.toLowerCase()).includes(domain);
}

function staffEmailFromOidcUser(user) {
  if (!user || typeof user !== 'object') {
    return '';
  }
  return normalizeEmail(user.email || user.preferred_username || user.upn || '');
}

module.exports = {
  emailDomain,
  isAllowedStaffEmail,
  normalizeEmail,
  staffEmailFromOidcUser,
};
