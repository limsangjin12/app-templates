#!/usr/bin/env node
// Create a new editable appStoreVersion (idempotent — returns existing
// if the version string already exists in an editable state).
//
// Required env: ASC_API_KEY ASC_API_ISSUER ASC_BUNDLE_ID
// Optional env: ASC_PLATFORM (IOS / MAC_OS / TV_OS / VISION_OS; default IOS)
// Required arg: --version=1.0.2
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
const VERSION = String(args.version ?? '').trim();
if (!VERSION) { console.error('Usage: --version=1.0.2'); process.exit(2); }
const PLATFORM = (process.env.ASC_PLATFORM || 'IOS').toUpperCase();
const PLATFORM_FILTER = PLATFORM === 'MACOS' ? 'MAC_OS' : PLATFORM;

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

const apps = await asc('GET', `/apps?filter[bundleId]=${BUNDLE_ID}&limit=10`);
const app = apps.data[0];
if (!app) throw new Error(`app ${BUNDLE_ID} not found`);
console.log(`app: ${app.id} (${app.attributes.name})`);

const versions = await asc('GET',
  `/apps/${app.id}/appStoreVersions?filter[platform]=${PLATFORM_FILTER}&limit=50`);
const existing = versions.data.find(v => v.attributes.versionString === VERSION);
if (existing) {
  console.log(`  existing version ${VERSION}: ${existing.id} state=${existing.attributes.appStoreState}`);
  process.exit(0);
}

// Copy release notes from the latest version (so en-US/ko/etc. remain
// populated). The editable version requires localizations.
const latest = versions.data[0];
console.log(`latest version: ${latest.attributes.versionString} (${latest.id})`);
const latestLocs = await asc('GET',
  `/appStoreVersions/${latest.id}/appStoreVersionLocalizations?limit=50`);

console.log(`creating appStoreVersion ${VERSION}…`);
const created = await asc('POST', '/appStoreVersions', {
  data: {
    type: 'appStoreVersions',
    attributes: { versionString: VERSION, platform: PLATFORM_FILTER },
    relationships: { app: { data: { type: 'apps', id: app.id } } },
  },
});
const newVersion = created.data;
console.log(`  created: ${newVersion.id}`);

console.log('copying localizations from previous version…');
for (const loc of latestLocs.data) {
  const a = loc.attributes;
  const body = {
    data: {
      type: 'appStoreVersionLocalizations',
      attributes: {
        locale: a.locale,
        whatsNew: a.whatsNew,
        description: a.description,
        keywords: a.keywords,
        marketingUrl: a.marketingUrl,
        promotionalText: a.promotionalText,
        supportUrl: a.supportUrl,
      },
      relationships: {
        appStoreVersion: {
          data: { type: 'appStoreVersions', id: newVersion.id },
        },
      },
    },
  };
  // strip undefined attributes
  for (const k of Object.keys(body.data.attributes)) {
    if (body.data.attributes[k] == null) delete body.data.attributes[k];
  }
  try {
    await asc('POST', '/appStoreVersionLocalizations', body);
    console.log(`  ${a.locale} ✓`);
  } catch (e) {
    console.log(`  ${a.locale} skip (${e.message.split('\n')[0]})`);
  }
}
console.log('\n✅ Done. New editable version:', newVersion.id);
