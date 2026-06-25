#!/usr/bin/env node
// 1) Find current app + reviewSubmission state
// 2) If reviewSubmission is in WAITING_FOR_REVIEW (or similar pre-review state),
//    cancel it so the appStoreVersion becomes editable again
// 3) Print the resulting state so the next step (submit-for-review --build=4) can run
//
// Required env vars (load via deploy.config.sh):
//   ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID, ASC_PLATFORM=MAC_OS

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID    = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
const PLATFORM  = (process.env.ASC_PLATFORM || 'MAC_OS').toUpperCase();
if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID) throw new Error('missing ASC env vars');

const KEY_PATH = process.env.ASC_KEY_PATH ||
  path.join(os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);
const PRIVATE_KEY = fs.readFileSync(KEY_PATH, 'utf8');
const API = 'https://api.appstoreconnect.apple.com/v1';

function token() {
  return jwt.sign({ iss: ISSUER_ID, exp: Math.floor(Date.now()/1000)+1100, aud: 'appstoreconnect-v1' },
    PRIVATE_KEY, { algorithm: 'ES256', header: { alg: 'ES256', kid: KEY_ID, typ: 'JWT' } });
}

async function asc(method, p, body) {
  const r = await fetch(`${API}${p}`, {
    method, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status}: ${await r.text()}`);
  if (r.status === 204) return null;
  return r.json();
}

const apps = await asc('GET', `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
const app = apps.data[0];
console.log(`App: ${app.attributes.name} (${app.id})`);

console.log('\n— appStoreVersions —');
const versions = await asc('GET',
  `/apps/${app.id}/appStoreVersions?filter[platform]=${PLATFORM}&limit=10`);
for (const v of versions.data) {
  console.log(`  ${v.attributes.versionString} state=${v.attributes.appStoreState} (id=${v.id})`);
}

console.log('\n— reviewSubmissions —');
const subs = await asc('GET',
  `/apps/${app.id}/reviewSubmissions?filter[platform]=${PLATFORM}&limit=10`);
const items = subs.data || [];
for (const s of items) {
  console.log(`  state=${s.attributes.state} submittedDate=${s.attributes.submittedDate} (id=${s.id})`);
}

const cancelable = items.find(s => ['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(s.attributes.state));
if (cancelable) {
  console.log(`\n→ Canceling reviewSubmission ${cancelable.id} (${cancelable.attributes.state}) so the version becomes editable…`);
  await asc('PATCH', `/reviewSubmissions/${cancelable.id}`, {
    data: {
      type: 'reviewSubmissions',
      id: cancelable.id,
      attributes: { canceled: true },
    },
  });
  console.log('  Canceled. Version should return to DEVELOPER_REJECTED (editable).');
} else {
  console.log('\n(No WAITING_FOR_REVIEW / IN_REVIEW submission to cancel.)');
}

console.log('\n— refetch versions —');
const v2 = await asc('GET',
  `/apps/${app.id}/appStoreVersions?filter[platform]=${PLATFORM}&limit=5`);
for (const v of v2.data) {
  console.log(`  ${v.attributes.versionString} state=${v.attributes.appStoreState} (id=${v.id})`);
}
