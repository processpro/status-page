'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAllowedStaffEmail,
  staffEmailFromOidcUser,
  emailDomain,
} = require('../src/auth');

describe('staff email domain gate', () => {
  it('allows processpro.io and processpro.com', () => {
    assert.equal(isAllowedStaffEmail('alex@processpro.io'), true);
    assert.equal(isAllowedStaffEmail('Alex@ProcessPro.COM'), true);
  });

  it('rejects other domains and empty values', () => {
    assert.equal(isAllowedStaffEmail('alex@example.com'), false);
    assert.equal(isAllowedStaffEmail(''), false);
    assert.equal(isAllowedStaffEmail(null), false);
  });

  it('reads email-like claims from the OIDC user', () => {
    assert.equal(staffEmailFromOidcUser({ email: 'a@processpro.io' }), 'a@processpro.io');
    assert.equal(
      staffEmailFromOidcUser({ preferred_username: 'b@processpro.com' }),
      'b@processpro.com'
    );
    assert.equal(emailDomain('user@processpro.io'), 'processpro.io');
  });
});
