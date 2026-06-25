#!/usr/bin/env node
// Copy whatsNew (release notes) from the previously published appStoreVersion
// into the editable version's localizations. Idempotent: PATCHes existing
// localizations, falling back to copy from previous when whatsNew is empty
// in source.
//
// Required env: ASC_API_KEY ASC_API_ISSUER ASC_BUNDLE_ID
// Optional arg: --target-version=1.0.2 (default: latest editable)
//               --whatsnew="문구"  (default: copy from previous)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID) {
  console.error('❌ ASC_API_KEY/ISSUER/BUNDLE_ID required');
  process.exit(2);
}
const args = Object.fromEntries(process.argv.slice(2)
  .map(a => a.startsWith('--') ? a.slice(2).split('=') : [a, true]));
const TARGET_VERSION = args['target-version']
  ? String(args['target-version']).trim() : null;
const FORCE_WHATSNEW = args.whatsnew ? String(args.whatsnew) : null;

const KEY_PATH = path.join(os.homedir(),
  '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);
const API = 'https://api.appstoreconnect.apple.com/v1';
const EDITABLE = new Set([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'WAITING_FOR_REVIEW',
  'INVALID_BINARY',
]);

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

const apps = await asc('GET', `/apps?filter[bundleId]=${BUNDLE_ID}&limit=10`);
const app = apps.data[0];
if (!app) throw new Error(`app ${BUNDLE_ID} not found`);

const versions = await asc('GET',
  `/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=50`);
const target = TARGET_VERSION
  ? versions.data.find(v => v.attributes.versionString === TARGET_VERSION)
  : versions.data.find(v => EDITABLE.has(v.attributes.appStoreState));
if (!target) {
  console.error('❌ no target editable version found');
  process.exit(1);
}
console.log(`target: v=${target.attributes.versionString} state=${target.attributes.appStoreState}`);

// pick previous version (most recent below target)
const prev = versions.data
  .filter(v => v.id !== target.id && v.attributes.versionString !== target.attributes.versionString)
  .sort((a, b) => new Date(b.attributes.createdDate) - new Date(a.attributes.createdDate))[0];
if (!prev) {
  console.error('❌ no prior version to copy from');
  process.exit(1);
}
console.log(`source: v=${prev.attributes.versionString} state=${prev.attributes.appStoreState}`);

const targetLocs = await asc('GET',
  `/appStoreVersions/${target.id}/appStoreVersionLocalizations?limit=50`);
const sourceLocs = await asc('GET',
  `/appStoreVersions/${prev.id}/appStoreVersionLocalizations?limit=50`);
const sourceByLocale = Object.fromEntries(
  sourceLocs.data.map(l => [l.attributes.locale, l.attributes]));

console.log(`\nupdating ${targetLocs.data.length} locales:`);
for (const loc of targetLocs.data) {
  const a = loc.attributes;
  const src = sourceByLocale[a.locale];
  const whatsNew = FORCE_WHATSNEW ?? src?.whatsNew;
  if (whatsNew == null || whatsNew === '') {
    console.log(`  ${a.locale} skip — no source whatsNew`);
    continue;
  }
  if (a.whatsNew === whatsNew) {
    console.log(`  ${a.locale} ✓ already set`);
    continue;
  }
  await asc('PATCH', `/appStoreVersionLocalizations/${loc.id}`, {
    data: {
      type: 'appStoreVersionLocalizations',
      id: loc.id,
      attributes: { whatsNew },
    },
  });
  console.log(`  ${a.locale} ↑ ${whatsNew.length} chars`);
}
console.log('\n✅ Done.');
