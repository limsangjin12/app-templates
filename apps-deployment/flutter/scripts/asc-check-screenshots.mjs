#!/usr/bin/env node
// Diagnoses App Store Connect screenshot states — useful when the
// "screenshots still uploading" banner is stuck for hours. Walks every
// localization → screenshotSet → screenshot, prints the
// assetDeliveryState (UPLOAD_COMPLETE / COMPLETE / FAILED / …) and any
// errors.
//
// Required env vars:
//   ASC_API_KEY      e.g. <KEY_ID>
//   ASC_API_ISSUER   UUID
//   ASC_BUNDLE_ID    com.example.myapp
//
// Optional:
//   ASC_KEY_PATH     .p8 path
//   ASC_PLATFORM     IOS / MAC_OS / TV_OS / VISION_OS (default IOS)
//
// Run:
//   node /path/to/apps-deployment/flutter/scripts/asc-check-screenshots.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID    = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID) {
  console.error('❌ ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID env vars required.');
  process.exit(2);
}
const KEY_PATH = process.env.ASC_KEY_PATH || path.join(
  os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);
const PLATFORM = (process.env.ASC_PLATFORM || 'IOS').toUpperCase();
const PLATFORM_FILTER = PLATFORM === 'MACOS' ? 'MAC_OS' : PLATFORM;

const API = 'https://api.appstoreconnect.apple.com/v1';

function newToken() {
  const key = fs.readFileSync(KEY_PATH, 'utf8');
  return jwt.sign({}, key, {
    algorithm: 'ES256', expiresIn: '15m',
    audience: 'appstoreconnect-v1', issuer: ISSUER_ID, keyid: KEY_ID,
  });
}

async function asc(method, pathname) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${newToken()}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`${method} ${pathname} → ${res.status}: ${await res.text()}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function main() {
  const apps = await asc('GET',
    `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
  const app = apps.data[0];
  console.log(`App: ${app.attributes.name} (id=${app.id})`);

  const versions = await asc('GET',
    `/apps/${app.id}/appStoreVersions?filter[platform]=${PLATFORM_FILTER}&limit=5`);
  const version = versions.data[0];
  console.log(`Version: ${version.attributes.versionString} state=${version.attributes.appStoreState}`);

  const locsResp = await asc('GET',
    `/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`);

  const summary = { complete: 0, processing: 0, failed: 0, other: 0 };
  for (const loc of locsResp.data) {
    const locale = loc.attributes.locale;
    const setsResp = await asc('GET',
      `/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`);
    for (const set of setsResp.data) {
      const display = set.attributes.screenshotDisplayType;
      const shotsResp = await asc('GET',
        `/appScreenshotSets/${set.id}/appScreenshots?limit=50`);
      for (const shot of shotsResp.data) {
        const name = shot.attributes.fileName || shot.id;
        const state = shot.attributes.assetDeliveryState?.state || '?';
        const errors = shot.attributes.assetDeliveryState?.errors;
        if (state === 'COMPLETE') summary.complete++;
        else if (state === 'UPLOAD_COMPLETE') summary.processing++;
        else if (state === 'FAILED') summary.failed++;
        else summary.other++;
        if (state !== 'COMPLETE') {
          console.log(`  ${locale} ${display} ${name} → ${state}${errors ? ' errors=' + JSON.stringify(errors) : ''}`);
        }
      }
    }
  }
  console.log('\nSummary:', summary);
}

main().catch(e => { console.error(e.message); process.exit(1); });
