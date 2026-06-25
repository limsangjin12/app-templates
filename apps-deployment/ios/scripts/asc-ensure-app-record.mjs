#!/usr/bin/env node
// Checks whether an App Store Connect app record exists for a Bundle ID.
//
// Required env:
//   ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID, ASC_APP_NAME
// Optional env:
//   ASC_KEY_PATH
//
// Apple does not allow creating a brand-new app record through the public
// App Store Connect API. If this check fails, create the app record once in
// the App Store Connect website, then rerun automated upload/setup scripts.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
const APP_NAME = process.env.ASC_APP_NAME;

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

const existing = await asc('GET', `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=1`);
if (existing.data[0]) {
  const app = existing.data[0];
  console.log(`App record exists: ${app.attributes.name} (${app.id})`);
  process.exit(0);
}

console.error(`No App Store Connect app record found for bundleId=${BUNDLE_ID}.`);
console.error('Create it once in App Store Connect > Apps > + > New App, then rerun this script.');
console.error(`Suggested values: name="${APP_NAME}", bundleId="${BUNDLE_ID}", sku="${BUNDLE_ID}", primaryLocale="en-US".`);
process.exit(4);
