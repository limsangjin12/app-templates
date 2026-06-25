#!/usr/bin/env node
// Cancels in-flight reviewSubmissions for the app/platform, freeing the
// editable appStoreVersion so a fresh build can be attached. Use after
// a rejected/UNRESOLVED_ISSUES submission keeps the version locked.
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
//   node /path/to/apps-deployment/flutter/scripts/asc-cancel-submission.mjs

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
  const apps = await asc('GET',
    `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
  const app = apps.data[0];
  if (!app) throw new Error(`No app found for bundleId ${BUNDLE_ID}`);
  console.log(`  App: ${app.attributes.name} (${app.id})`);

  const subs = await asc('GET',
    `/reviewSubmissions?filter[app]=${app.id}&filter[platform]=${PLATFORM_FILTER}&limit=20`);
  if (!subs.data.length) {
    console.log('  No review submissions found.');
    return;
  }
  for (const sub of subs.data) {
    const state = sub.attributes.state;
    console.log(`  submission ${sub.id} state=${state}`);
    if (
      state === 'WAITING_FOR_REVIEW'
      || state === 'IN_REVIEW'
      || state === 'UNRESOLVED_ISSUES'
      || state === 'READY_FOR_REVIEW'
    ) {
      console.log(`→ Cancelling submission ${sub.id}…`);
      try {
        await asc('PATCH', `/reviewSubmissions/${sub.id}`, {
          data: {
            id: sub.id,
            type: 'reviewSubmissions',
            attributes: { canceled: true },
          },
        });
        console.log('  done.');
      } catch (err) {
        if (!err.message.includes('Resource is not in cancellable state')) {
          throw err;
        }
        console.log('  skip: submission is not currently cancellable.');
      }
    }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
