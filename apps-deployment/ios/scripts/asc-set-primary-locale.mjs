#!/usr/bin/env node
// Sets the App Store Connect primary locale for an app (PATCH /v1/apps/{id}).
//
// ASC primary locale = the App Store fallback language. If a user's region
// has no localized listing, ASC shows the primary locale's listing. Default
// for new apps is en-US — switch to ko when the app is Korean-first.
//
// Required env:
//   ASC_API_KEY      e.g. <KEY_ID>
//   ASC_API_ISSUER   UUID
//   ASC_BUNDLE_ID    com.example.myapp
//   ASC_PRIMARY_LOCALE   target locale code (e.g. ko, en-US, ja)
//
// Optional:
//   ASC_KEY_PATH     .p8 path
//
// Run via deploy.config.sh:
//   source ./deploy.config.sh
//   ASC_PRIMARY_LOCALE=ko \
//     node "$APPS_DEPLOY_DIR/ios/scripts/asc-set-primary-locale.mjs"

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID    = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
const LOCALE    = process.env.ASC_PRIMARY_LOCALE;
if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID || !LOCALE) {
  console.error(
    '❌ ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID, ASC_PRIMARY_LOCALE env vars required.');
  process.exit(2);
}
const KEY_PATH = process.env.ASC_KEY_PATH || path.join(
  os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);

const API = 'https://api.appstoreconnect.apple.com/v1';

function newToken() {
  const key = fs.readFileSync(KEY_PATH, 'utf8');
  return jwt.sign({}, key, {
    algorithm: 'ES256', expiresIn: '15m',
    audience: 'appstoreconnect-v1', issuer: ISSUER_ID, keyid: KEY_ID,
  });
}

async function asc(method, pathname, body) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${newToken()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${pathname} → ${res.status}: ${await res.text()}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function main() {
  console.log(`→ Locating app by bundleId=${BUNDLE_ID}…`);
  const apps = await asc('GET',
    `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
  if (!apps.data.length) throw new Error(`No app found for bundleId=${BUNDLE_ID}`);
  const app = apps.data[0];
  const current = app.attributes.primaryLocale;
  console.log(`  App: ${app.attributes.name}  (id=${app.id})`);
  console.log(`  Current primaryLocale: ${current}`);

  if (current === LOCALE) {
    console.log(`✓ Already ${LOCALE} — nothing to do.`);
    return;
  }

  console.log(`→ PATCH primaryLocale: ${current} → ${LOCALE}`);
  await asc('PATCH', `/apps/${app.id}`, {
    data: {
      type: 'apps',
      id: app.id,
      attributes: { primaryLocale: LOCALE },
    },
  });
  console.log(`✓ Updated.`);
}

main().catch(err => { console.error(err); process.exit(1); });
