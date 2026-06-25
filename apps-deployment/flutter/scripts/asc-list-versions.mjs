#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
const PLATFORM = process.env.ASC_PLATFORM || 'IOS';
if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID) {
  console.error('ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID env vars are required.');
  process.exit(2);
}
const KEY_PATH = path.join(os.homedir(),
  '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);
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
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${pathname} → ${res.status}\n${await res.text()}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const apps = await asc('GET',
  `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=10`);
const app = apps.data[0];
if (!app) {
  console.error(`No App Store Connect app record found for bundleId=${BUNDLE_ID}.`);
  console.error('Create the app record in App Store Connect, then rerun this command.');
  process.exit(3);
}
console.log(`app: ${app.id} (${app.attributes.name})`);

const versions = await asc('GET',
  `/apps/${app.id}/appStoreVersions?filter[platform]=${encodeURIComponent(PLATFORM)}&limit=20`);
console.log(`platform: ${PLATFORM}`);
console.log(`\n${versions.data.length} appStoreVersions:`);
for (const v of versions.data) {
  const a = v.attributes;
  console.log(`  ${v.id} v=${a.versionString} state=${a.appStoreState} created=${a.createdDate}`);
}

// also list builds
const builds = await asc('GET',
  `/builds?filter[app]=${app.id}&limit=10&sort=-uploadedDate`);
console.log(`\n${builds.data.length} recent builds:`);
for (const b of builds.data) {
  console.log(`  ${b.id} v=${b.attributes.version} state=${b.attributes.processingState} uploaded=${b.attributes.uploadedDate}`);
}
