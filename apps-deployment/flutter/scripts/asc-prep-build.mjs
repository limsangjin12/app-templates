#!/usr/bin/env node
// Provisions a fresh Distribution certificate + IOS_APP_STORE provisioning
// profile via the App Store Connect API, installs both into the local
// keychain + system profile directory, and prints the values xcodebuild
// needs for manual signing.
//
// Use this on machines without an Apple ID logged into Xcode (CI, fresh
// laptops). The ExportOptions plist used by `flutter build ipa` should
// reference `signingStyle=manual`, the printed certificate name, and the
// printed profile name (defaults to "<App Name> App Store CLI").
//
// Required env vars:
//   ASC_API_KEY       e.g. <KEY_ID>
//   ASC_API_ISSUER    UUID
//   ASC_BUNDLE_ID     com.example.myapp
//   ASC_TEAM_ID       Apple Developer team id (10-char)
//   ASC_APP_NAME      app name used in cert/profile labels (e.g. "Gomoku Pro")
//
// Optional:
//   ASC_KEY_PATH      .p8 path (default ~/.appstoreconnect/private_keys/AuthKey_<KEY>.p8)
//   ASC_TEAM_OWNER    name baked into CSR subject (default "Lim Sangjin")
//
// Run:
//   node /path/to/apps-deployment/flutter/scripts/asc-prep-build.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import jwt from 'jsonwebtoken';

const KEY_ID    = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
const TEAM_ID   = process.env.ASC_TEAM_ID;
const APP_NAME  = process.env.ASC_APP_NAME;
if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID || !TEAM_ID || !APP_NAME) {
  console.error(
    '❌ ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID, ASC_TEAM_ID, ' +
    'ASC_APP_NAME env vars required.');
  process.exit(2);
}
const KEY_PATH = process.env.ASC_KEY_PATH || path.join(
  os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);
const TEAM_OWNER = process.env.ASC_TEAM_OWNER || 'Lim Sangjin';

const CERT_NAME    = `${APP_NAME} Distribution CLI`;
const PROFILE_NAME = `${APP_NAME} App Store CLI`;

const API = 'https://api.appstoreconnect.apple.com/v1';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-prep-'));

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

// Cleanup: drop our previous CLI profile + cert (idempotent re-run).
const allProfiles = await asc('GET',
    '/profiles?include=bundleId,certificates&limit=200');
for (const p of allProfiles.data) {
  if (p.relationships.bundleId.data?.id === bundle.id
      && p.attributes.name === PROFILE_NAME) {
    console.log(`deleting old profile: ${p.attributes.name}`);
    await asc('DELETE', `/profiles/${p.id}`);
  }
}
const allCerts = await asc('GET', '/certificates?limit=200');
for (const c of allCerts.data) {
  if (c.attributes.certificateType === 'DISTRIBUTION'
      && (c.attributes.displayName === CERT_NAME
          || c.attributes.name === CERT_NAME)) {
    console.log(`revoking old dist cert: ${c.id}`);
    await asc('DELETE', `/certificates/${c.id}`);
  }
}

// Generate fresh key + CSR.
const KEY_PEM = path.join(TMP, 'dist.key.pem');
const CSR_PEM = path.join(TMP, 'dist.csr.pem');
console.log('generating private key + CSR…');
execSync(`openssl genrsa -out ${KEY_PEM} 2048`, { stdio: 'pipe' });
execSync(
  `openssl req -new -key ${KEY_PEM} -out ${CSR_PEM} ` +
  `-subj "/CN=${CERT_NAME}/O=${TEAM_OWNER}/C=US"`,
  { stdio: 'pipe' });
const csrContent = fs.readFileSync(CSR_PEM, 'utf8')
  .replace(/-----BEGIN CERTIFICATE REQUEST-----/, '')
  .replace(/-----END CERTIFICATE REQUEST-----/, '')
  .replace(/\s+/g, '');

console.log('requesting DISTRIBUTION certificate…');
const certResp = await asc('POST', '/certificates', {
  data: {
    type: 'certificates',
    attributes: { csrContent, certificateType: 'DISTRIBUTION' },
  },
});
const cert = certResp.data;
console.log(`  cert id: ${cert.id}  serial: ${cert.attributes.serialNumber}`);

const CER_PATH  = path.join(TMP, 'dist.cer');
const CERT_PEM  = path.join(TMP, 'dist.cert.pem');
fs.writeFileSync(
    CER_PATH, Buffer.from(cert.attributes.certificateContent, 'base64'));
execSync(`openssl x509 -inform DER -in ${CER_PATH} -out ${CERT_PEM}`,
    { stdio: 'pipe' });

// Build PKCS#12 + import. macOS bundled LibreSSL writes a p12 the
// system `security` tool can't verify; fall back to Homebrew OpenSSL 3
// with `-legacy` (RC2 form) when present.
const useHomebrew =
    fs.existsSync('/opt/homebrew/opt/openssl@3/bin/openssl');
const OPENSSL = useHomebrew
  ? '/opt/homebrew/opt/openssl@3/bin/openssl'
  : 'openssl';
const LEGACY = useHomebrew ? '-legacy' : '';

const P12_PATH = path.join(TMP, 'dist.p12');
const P12_PASS = 'asc-prep-temp';
execSync(
  `${OPENSSL} pkcs12 -export ${LEGACY} -inkey ${KEY_PEM} -in ${CERT_PEM} ` +
  `-name "Apple Distribution: ${TEAM_OWNER} (${TEAM_ID})" ` +
  `-out ${P12_PATH} -password pass:${P12_PASS}`,
  { stdio: 'pipe' });

console.log('importing into login keychain…');
execSync(
  `security import ${P12_PATH} -k ${os.homedir()}/Library/Keychains/login.keychain-db -P ${P12_PASS} -T /usr/bin/codesign -T /usr/bin/security`,
  { stdio: 'inherit' });
try {
  execSync(
    `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k '' ${os.homedir()}/Library/Keychains/login.keychain-db`,
    { stdio: 'pipe' });
} catch {/* may fail without keychain pass; codesign still works */}

console.log(`creating IOS_APP_STORE profile "${PROFILE_NAME}"…`);
const profileResp = await asc('POST', '/profiles', {
  data: {
    type: 'profiles',
    attributes: {
      name: PROFILE_NAME,
      profileType: 'IOS_APP_STORE',
    },
    relationships: {
      bundleId: { data: { type: 'bundleIds', id: bundle.id } },
      certificates: { data: [{ type: 'certificates', id: cert.id }] },
    },
  },
});
const profile = profileResp.data;
console.log(`  profile id: ${profile.id}  uuid: ${profile.attributes.uuid}`);

const profilePath = path.join(
  os.homedir(),
  'Library/MobileDevice/Provisioning Profiles',
  `${profile.attributes.uuid}.mobileprovision`);
fs.mkdirSync(path.dirname(profilePath), { recursive: true });
fs.writeFileSync(
    profilePath,
    Buffer.from(profile.attributes.profileContent, 'base64'));
console.log(`  installed to: ${profilePath}`);

console.log('\n=== Use these in xcodebuild / ExportOptions.plist ===');
console.log(`  PROVISIONING_PROFILE_SPECIFIER = ${PROFILE_NAME}`);
console.log(`  PROVISIONING_PROFILE = ${profile.attributes.uuid}`);
console.log(`  CODE_SIGN_IDENTITY = Apple Distribution: ${TEAM_OWNER} (${TEAM_ID})`);
console.log(`  DEVELOPMENT_TEAM = ${TEAM_ID}`);
console.log(`  CODE_SIGN_STYLE = Manual`);

// Best-effort cleanup of TMP. Leave on error so the user can inspect.
try { fs.rmSync(TMP, { recursive: true }); } catch {/* ignore */}
