'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { dataDir } = require('./store');

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const ISSUER = 'status.processpro.io';
const SCOPE = 'sites';

function tokensPath() {
  return path.join(dataDir(), 'agent-tokens.json');
}

function keyPath() {
  return path.join(dataDir(), 'agent-signing-key');
}

function readTokens() {
  try {
    const parsed = JSON.parse(fs.readFileSync(tokensPath(), 'utf8'));
    if (Array.isArray(parsed.tokens)) {
      return parsed.tokens;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  return [];
}

function writeTokens(tokens) {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = tokensPath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ tokens }, null, 2));
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.copyFileSync(tmp, file);
    fs.rmSync(tmp, { force: true });
  }
}

function signingKey() {
  const file = keyPath();
  try {
    const existing = fs.readFileSync(file);
    if (existing.length >= 32) {
      return existing;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}

function sign(agentName, tokenId, issuedAtUnix, key = signingKey()) {
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER,
    sub: agentName,
    jti: tokenId,
    scope: SCOPE,
    iat: issuedAtUnix,
  })).toString('base64url');
  const input = `${HEADER}.${payload}`;
  const signature = crypto.createHmac('sha256', key).update(input).digest('base64url');
  return `${input}.${signature}`;
}

function readToken(token, key = signingKey()) {
  if (!token || token.length > 4000) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) {
    return null;
  }
  const expected = crypto.createHmac('sha256', key).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  const provided = Buffer.from(parts[2]);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length || !crypto.timingSafeEqual(provided, expectedBuf)) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || payload.iss !== ISSUER || payload.scope !== SCOPE || !payload.sub || !payload.jti) {
    return null;
  }
  return payload;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hashEquals(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeAgentName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 120 || /[\u0000-\u001f]/.test(name)) {
    throw new Error('Enter an agent name of 120 characters or fewer.');
  }
  return name;
}

function listConnections() {
  return readTokens()
    .slice()
    .sort((a, b) => {
      if (Boolean(a.revokedUtc) !== Boolean(b.revokedUtc)) {
        return a.revokedUtc ? 1 : -1;
      }
      return String(b.createdUtc).localeCompare(String(a.createdUtc));
    })
    .map((token) => ({
      id: token.id,
      agentName: token.agentName,
      createdUtc: token.createdUtc,
      createdBy: token.createdBy,
      lastUsedUtc: token.lastUsedUtc || null,
      revokedUtc: token.revokedUtc || null,
    }));
}

function createConnection(agentName, createdBy) {
  const name = normalizeAgentName(agentName);
  const tokenId = crypto.randomUUID();
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = sign(name, tokenId, issuedAt);
  const record = {
    id: crypto.randomUUID(),
    agentName: name,
    tokenId,
    tokenHash: hashToken(token),
    createdUtc: new Date(issuedAt * 1000).toISOString(),
    createdBy: String(createdBy || 'staff').trim() || 'staff',
    lastUsedUtc: null,
    revokedUtc: null,
  };
  const tokens = readTokens();
  tokens.push(record);
  writeTokens(tokens);
  return { connection: publicConnection(record), token };
}

function revokeConnection(id) {
  const tokens = readTokens();
  const record = tokens.find((token) => token.id === id);
  if (!record || record.revokedUtc) {
    return false;
  }
  record.revokedUtc = new Date().toISOString();
  writeTokens(tokens);
  return true;
}

function authenticateConnection(token) {
  const payload = readToken(token);
  if (!payload) {
    return null;
  }
  const tokens = readTokens();
  const record = tokens.find((item) => item.tokenId === payload.jti);
  if (!record || record.revokedUtc || record.agentName !== payload.sub || !hashEquals(record.tokenHash, hashToken(token))) {
    return null;
  }
  record.lastUsedUtc = new Date().toISOString();
  writeTokens(tokens);
  return publicConnection(record);
}

function publicConnection(record) {
  return {
    id: record.id,
    agentName: record.agentName,
    createdUtc: record.createdUtc,
    createdBy: record.createdBy,
    lastUsedUtc: record.lastUsedUtc || null,
    revokedUtc: record.revokedUtc || null,
  };
}

module.exports = {
  authenticateConnection,
  createConnection,
  hashToken,
  listConnections,
  readToken,
  revokeConnection,
  sign,
};
