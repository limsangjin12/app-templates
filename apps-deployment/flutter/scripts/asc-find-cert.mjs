#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import jwt from 'jsonwebtoken';

const KEY_ID = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const KEY_PATH = process.env.ASC_KEY_PATH || path.join(os.homedir(),
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

const certs = await asc('GET', '/certificates?limit=200');
const distCerts = certs.data.filter(c => c.attributes.certificateType === 'DISTRIBUTION');

// Get local cert SHA-1 hashes for Apple Distribution certificates.
const certCommonName = process.env.ASC_CERT_COMMON_NAME ||
  (process.env.ASC_TEAM_OWNER && process.env.ASC_TEAM_ID
    ? `Apple Distribution: ${process.env.ASC_TEAM_OWNER} (${process.env.ASC_TEAM_ID})`
    : 'Apple Distribution');
const keychainPath = process.env.ASC_KEYCHAIN ||
  path.join(os.homedir(), 'Library/Keychains/login.keychain-db');
const localCertsRaw = execSync(
  `security find-certificate -c "${certCommonName.replaceAll('"', '\\"')}" -p -a "${keychainPath.replaceAll('"', '\\"')}"`,
  { encoding: 'utf8' });

// Parse PEM blocks; for each compute SHA-1 fingerprint, also extract not-after
const blocks = [...localCertsRaw.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)].map(m => m[0]);
const localFingerprints = blocks.map(pem => {
  const tmp = `/tmp/asc-cert-${Math.random().toString(36).slice(2)}.pem`;
  fs.writeFileSync(tmp, pem);
  const fp = execSync(`openssl x509 -in ${tmp} -noout -fingerprint -sha1`, { encoding: 'utf8' })
    .replace(/^.*=/, '').replace(/[:\s]/g, '').toLowerCase();
  const serial = execSync(`openssl x509 -in ${tmp} -noout -serial`, { encoding: 'utf8' })
    .replace(/^.*=/, '').trim().toLowerCase();
  const notAfter = execSync(`openssl x509 -in ${tmp} -noout -enddate`, { encoding: 'utf8' })
    .replace(/^.*=/, '').trim();
  fs.unlinkSync(tmp);
  return { fp, serial, notAfter };
});

console.log('=== ASC Distribution certificates ===');
for (const c of distCerts) {
  const a = c.attributes;
  const ascSerial = a.serialNumber?.toLowerCase();
  const matchedLocal = localFingerprints.find(l =>
    l.serial === ascSerial || l.serial.replace(/^0+/, '') === ascSerial);
  console.log(`  id=${c.id} name=${a.name} displayName=${a.displayName} serial=${a.serialNumber} expires=${a.expirationDate}${matchedLocal ? ' [LOCAL ✓]' : ''}`);
}
console.log('=== local Apple Distribution certs ===');
for (const l of localFingerprints) {
  console.log(`  serial=${l.serial} fp=${l.fp} notAfter=${l.notAfter}`);
}
