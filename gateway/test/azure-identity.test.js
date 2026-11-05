'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { identityRequest } = require('../src/azure');

describe('azure identity request', () => {
  it('uses the App Service identity endpoint when the platform provides one', () => {
    const request = identityRequest({
      IDENTITY_ENDPOINT: 'http://169.254.169.254:8081/msi/token',
      IDENTITY_HEADER: 'secret-header',
    });
    const url = new URL(request.url);
    assert.equal(url.origin + url.pathname, 'http://169.254.169.254:8081/msi/token');
    assert.equal(url.searchParams.get('api-version'), '2019-08-01');
    assert.equal(url.searchParams.get('resource'), 'https://management.azure.com/');
    assert.equal(request.headers['X-IDENTITY-HEADER'], 'secret-header');
  });

  it('keeps an existing query string on the identity endpoint', () => {
    const request = identityRequest({
      IDENTITY_ENDPOINT: 'http://127.0.0.1:42356/msi/token?api-version=2017-09-01',
      IDENTITY_HEADER: 'secret-header',
    });
    assert.match(request.url, /^http:\/\/127\.0\.0\.1:42356\/msi\/token\?/);
    assert.match(request.url, /api-version=2019-08-01/);
    assert.doesNotMatch(request.url, /\?.*\?/);
  });

  it('falls back to instance metadata when App Service has not set an endpoint', () => {
    const request = identityRequest({});
    assert.match(request.url, /^http:\/\/169\.254\.169\.254\/metadata\/identity\/oauth2\/token\?/);
    assert.equal(request.headers.Metadata, 'true');
  });
});
