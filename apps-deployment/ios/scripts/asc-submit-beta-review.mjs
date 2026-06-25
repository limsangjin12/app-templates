#!/usr/bin/env node
// External TestFlight 그룹의 첫 빌드를 Beta App Review 에 제출.
// 통과 (~24h) 후 그룹 testers 에게 자동 invite 발송.
//
// Required env:
//   ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID
//
// Optional:
//   --build=<version>   특정 빌드 (default: 가장 최근 build)
//
// Usage:
//   node /path/to/apps-deployment/ios/scripts/asc-submit-beta-review.mjs
//   node /path/to/apps-deployment/ios/scripts/asc-submit-beta-review.mjs --build=2

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID    = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID) {
  console.error('❌ ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID required.');
  process.exit(2);
}
const KEY_PATH = process.env.ASC_KEY_PATH || path.join(
  os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);

const BUILD_VERSION = process.argv.find(a => a.startsWith('--build='))?.slice(8);

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

const apps = await asc('GET', `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
if (!apps.data.length) throw new Error(`No app for bundleId=${BUNDLE_ID}`);
const app = apps.data[0];
console.log(`App: ${app.attributes.name}  (id=${app.id})`);

let build;
if (BUILD_VERSION) {
  const r = await asc('GET',
    `/builds?filter[app]=${app.id}&filter[version]=${BUILD_VERSION}&limit=1`);
  build = r.data[0];
  if (!build) throw new Error(`No build with version=${BUILD_VERSION}`);
} else {
  const r = await asc('GET',
    `/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=5`);
  build = r.data[0];
  if (!build) throw new Error('No build found.');
}
console.log(`Build: ${build.attributes.version}  (id=${build.id})  state=${build.attributes.processingState}`);

if (build.attributes.processingState !== 'VALID') {
  console.error(`❌ Build is ${build.attributes.processingState}, must be VALID before Beta Review submission.`);
  process.exit(3);
}

// 이미 submission 이 있으면 skip.
const existing = await asc('GET', `/builds/${build.id}/betaAppReviewSubmission`);
if (existing.data) {
  console.log(`✔ already has Beta Review submission (id=${existing.data.id}, state=${existing.data.attributes.betaReviewState})`);
  process.exit(0);
}

console.log('→ Submitting for Beta App Review…');
const sub = await asc('POST', '/betaAppReviewSubmissions', {
  data: {
    type: 'betaAppReviewSubmissions',
    relationships: {
      build: { data: { type: 'builds', id: build.id } },
    },
  },
});
console.log(`✅ submitted. id=${sub.data.id}  state=${sub.data.attributes.betaReviewState}`);
console.log('   ASC 처리 ~24 h. 통과 시 external 그룹의 testers 에게 자동 invite 발송.');
