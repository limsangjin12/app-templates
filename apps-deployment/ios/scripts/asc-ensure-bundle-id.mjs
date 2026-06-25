#!/usr/bin/env node
// Ensures an explicit iOS Bundle ID exists in Apple Developer resources.
//
// Required env:
//   ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID, ASC_APP_NAME
// Optional env:
//   ASC_KEY_PATH
//   ASC_BUNDLE_PLATFORM (default: IOS)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
const APP_NAME = process.env.ASC_APP_NAME;
const PLATFORM = process.env.ASC_BUNDLE_PLATFORM || 'IOS';

if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID || !APP_NAME) {
  console.error('ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID, ASC_APP_NAME env vars required.');
  process.exit(2);
}

const KEY_PATH = process.env.ASC_KEY_PATH || path.join(
  os.homedir(),
  '.appstoreconnect/private_keys',
  `AuthKey_${KEY_ID}.p8`,
);
const API = 'https://api.appstoreconnect.apple.com/v1';

function token() {
  return jwt.sign({}, fs.readFileSync(KEY_PATH, 'utf8'), {
    algorithm: 'ES256',
    expiresIn: '15m',
    audience: 'appstoreconnect-v1',
    issuer: ISSUER_ID,
    keyid: KEY_ID,
  });
}

async function asc(method, pathname, body) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status}\n${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const existing = await asc('GET', `/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE_ID)}&limit=1`);
if (existing.data[0]) {
  console.log(`Bundle ID exists: ${existing.data[0].attributes.identifier} (${existing.data[0].id})`);
  process.exit(0);
}

const created = await asc('POST', '/bundleIds', {
  data: {
    type: 'bundleIds',
    attributes: {
      identifier: BUNDLE_ID,
      name: APP_NAME,
      platform: PLATFORM,
    },
  },
});

console.log(`Bundle ID created: ${created.data.attributes.identifier} (${created.data.id})`);
