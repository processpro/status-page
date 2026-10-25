'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('agent tokens and sites API', () => {
  let server;

  beforeEach(() => {
    process.env.STATUS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'status-agents-'));
    process.env.AUTH_DISABLED = 'true';
    process.env.INTERNAL_ONLY = 'true';
  });

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  });

  it('issues a JWS that only the signing key accepts', () => {
    const { createConnection, authenticateConnection, readToken, revokeConnection } = require('../src/tokens');
    const issued = createConnection('fleet-agent', 'dev@processpro.io');
    assert.equal(issued.token.split('.').length, 3);
    assert.equal(authenticateConnection(issued.token).agentName, 'fleet-agent');
    const payload = readToken(issued.token);
    assert.equal(payload.sub, 'fleet-agent');
    assert.equal(payload.scope, 'sites');

    const [header, body, signature] = issued.token.split('.');
    assert.equal(readToken(`${header}.${body}.${signature.slice(0, -2)}aa`), null);
    assert.equal(authenticateConnection(`${header}.${body}.not-a-signature`), null);

    const otherKey = crypto.randomBytes(32);
    const { sign } = require('../src/tokens');
    assert.equal(readToken(sign('fleet-agent', payload.jti, payload.iat, otherKey)), null);

    assert.equal(revokeConnection(issued.connection.id), true);
    assert.equal(authenticateConnection(issued.token), null);
  });

  it('adds, lists, and removes a monitored site by name', () => {
    const { addSite, listSites, removeSite } = require('../src/sites');
    const { loadMonitors } = require('../src/store');
    loadMonitors();

    const created = addSite({
      name: 'northwind',
      region: 'Australia',
      url: 'https://northwind.processpro.io',
    });
    assert.equal(created.status, 'created');
    assert.equal(created.site.region, 'Australia');
    assert.equal(created.site.url, 'https://northwind.processpro.io/');

    const again = addSite({
      name: 'Northwind',
      region: 'Australia',
      url: 'https://northwind.processpro.io',
    });
    assert.equal(again.status, 'conflict');
    assert.ok(listSites().some((site) => site.name === 'northwind' && site.region === 'Australia'));
    assert.equal(addSite({
      name: 'toyota',
      region: 'Australia',
      url: 'https://toyota.processpro.io',
    }).status, 'conflict');

    assert.equal(addSite({ name: 'bad/name', region: 'Australia', url: 'https://example.com' }).status, 'invalid');
    assert.equal(removeSite('northwind').status, 'removed');
    assert.equal(listSites().some((site) => site.name.toLowerCase() === 'northwind'), false);
    assert.equal(removeSite('northwind').status, 'missing');
  });

  it('answers the sites API with a bearer token', async () => {
    delete require.cache[require.resolve('../src/server')];
    const { createConnection } = require('../src/tokens');
    const issued = createConnection('fleet-agent', 'dev@processpro.io');
    const { createApp } = require('../src/server');
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;

    const missing = await request(origin, '/api/sites');
    assert.equal(missing.status, 401);

    const created = await request(origin, '/api/sites', {
      method: 'POST',
      token: issued.token,
      body: { name: 'acme', region: 'Canada', url: 'https://127.0.0.1:9' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.name, 'acme');
    assert.equal(created.json.region, 'Canada');

    const listed = await request(origin, '/api/sites', { token: issued.token });
    assert.equal(listed.status, 200);
    assert.ok(listed.json.some((site) => site.name === 'acme'));

    const duplicate = await request(origin, '/api/sites', {
      method: 'POST',
      token: issued.token,
      body: { name: 'acme', region: 'Canada', url: 'https://127.0.0.1:9' },
    });
    assert.equal(duplicate.status, 409);

    const removed = await request(origin, '/api/sites/acme', { method: 'DELETE', token: issued.token });
    assert.equal(removed.status, 204);
  });
});

function request(origin, pathname, { method = 'GET', token, body } = {}) {
  const url = new URL(pathname, origin);
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
        }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}
