#!/usr/bin/env node
// Create (or recreate) an IOS_APP_STORE provisioning profile bound to an
// existing Distribution certificate, install it locally, and print the
// values to plug into ExportOptions.plist for manual signing.
//
// Used when `asc-prep-build.mjs` can't issue a fresh cert (Apple limits
// active Distribution certs per team) but a usable cert + private key
// already exists in the local login keychain.
//
// Required env:
//   ASC_API_KEY ASC_API_ISSUER ASC_BUNDLE_ID ASC_TEAM_ID ASC_APP_NAME
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID    = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
const TEAM_ID   = process.env.ASC_TEAM_ID;
const APP_NAME  = process.env.ASC_APP_NAME;
if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID || !TEAM_ID || !APP_NAME) {
  console.error('❌ ASC_API_KEY/ISSUER/BUNDLE_ID/TEAM_ID/APP_NAME required');
  process.exit(2);
}
const KEY_PATH = path.join(os.homedir(),
  '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);
const PROFILE_NAME = `${APP_NAME} App Store CLI`;
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

const bundles = await asc('GET', '/bundleIds?limit=200');
const bundle = bundles.data.find(b => b.attributes.identifier === BUNDLE_ID);
if (!bundle) throw new Error(`bundle ID ${BUNDLE_ID} not found`);
console.log(`bundle: ${bundle.id} (${BUNDLE_ID})`);

const certs = await asc('GET', '/certificates?limit=200');
const dist = certs.data
  .filter(c => c.attributes.certificateType === 'DISTRIBUTION')
  .sort((a, b) => new Date(b.attributes.expirationDate) - new Date(a.attributes.expirationDate));
if (!dist.length) throw new Error('no DISTRIBUTION cert in ASC');
const cert = dist[0];
console.log(`using cert: ${cert.id} serial=${cert.attributes.serialNumber} expires=${cert.attributes.expirationDate}`);

const allProfiles = await asc('GET', '/profiles?include=bundleId&limit=200');
for (const p of allProfiles.data) {
  if (p.relationships.bundleId.data?.id === bundle.id
      && p.attributes.name === PROFILE_NAME) {
    console.log(`deleting old profile: ${p.attributes.name}`);
    await asc('DELETE', `/profiles/${p.id}`);
  }
}

console.log(`creating IOS_APP_STORE profile "${PROFILE_NAME}"…`);
const profileResp = await asc('POST', '/profiles', {
  data: {
    type: 'profiles',
    attributes: { name: PROFILE_NAME, profileType: 'IOS_APP_STORE' },
    relationships: {
      bundleId: { data: { type: 'bundleIds', id: bundle.id } },
      certificates: { data: [{ type: 'certificates', id: cert.id }] },
    },
  },
});
const profile = profileResp.data;
const profilePath = path.join(
  os.homedir(),
  'Library/MobileDevice/Provisioning Profiles',
  `${profile.attributes.uuid}.mobileprovision`);
fs.mkdirSync(path.dirname(profilePath), { recursive: true });
fs.writeFileSync(profilePath,
    Buffer.from(profile.attributes.profileContent, 'base64'));
console.log(`  uuid: ${profile.attributes.uuid}`);
console.log(`  installed: ${profilePath}`);

console.log('\n=== ExportOptions.plist values ===');
console.log(`  PROVISIONING_PROFILE_SPECIFIER = ${PROFILE_NAME}`);
console.log(`  PROVISIONING_PROFILE = ${profile.attributes.uuid}`);
console.log(`  CODE_SIGN_IDENTITY = Apple Distribution`);
console.log(`  DEVELOPMENT_TEAM = ${TEAM_ID}`);
console.log(`  CODE_SIGN_STYLE = Manual`);
