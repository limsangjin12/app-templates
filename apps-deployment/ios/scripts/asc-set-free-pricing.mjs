#!/usr/bin/env node
// Sets an App Store Connect app price schedule to Free using the official ASC API.
//
// Required env: ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID
// Optional env:
//   ASC_KEY_PATH
//   ASC_PRICE_BASE_TERRITORY (default: USA)
//
// Flags:
//   --force    Recreate the schedule even when the current manual price already
//              points at the free price point.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
const BASE_TERRITORY = process.env.ASC_PRICE_BASE_TERRITORY || 'USA';
const FORCE = process.argv.includes('--force');

if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID) {
  console.error('❌ ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID env vars required.');
  process.exit(2);
}

const KEY_PATH = process.env.ASC_KEY_PATH || path.join(
  os.homedir(),
  '.appstoreconnect/private_keys',
  `AuthKey_${KEY_ID}.p8`,
);
const API = 'https://api.appstoreconnect.apple.com/v1';

function token() {
  return jwt.sign({}, fs.readFileSync(KEY_PATH, 'utf8'), {
    algorithm: 'ES256',
    expiresIn: '15m',
    audience: 'appstoreconnect-v1',
    issuer: ISSUER_ID,
    keyid: KEY_ID,
  });
}

async function asc(method, pathname, body) {
  const url = pathname.startsWith('https://') ? pathname : `${API}${pathname}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status}\n${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function collect(pathname) {
  const rows = [];
  let next = pathname;
  while (next) {
    const page = await asc('GET', next);
    rows.push(...(page.data || []));
    next = page.links?.next || null;
  }
  return rows;
}

const apps = await asc('GET', `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
const app = apps.data[0];
if (!app) throw new Error(`No app found for bundleId=${BUNDLE_ID}`);
console.log(`App ${app.attributes.name} (${app.id})`);

const points = await collect(
  `/apps/${app.id}/appPricePoints?filter[territory]=${encodeURIComponent(BASE_TERRITORY)}&limit=200`,
);
const freePoint = points.find(point => {
  const price = point.attributes.customerPrice;
  return price === '0' || price === '0.0' || price === '0.00';
});
if (!freePoint) throw new Error(`Free appPricePoint for ${BASE_TERRITORY} customerPrice 0 was not found.`);
console.log(`Free appPricePoint: ${freePoint.id}`);

const existing = await asc('GET', `/apps/${app.id}/appPriceSchedule?include=manualPrices,baseTerritory`)
  .catch(() => null);
if (existing?.data?.id) {
  console.log(`Existing price schedule: ${existing.data.id}`);
  const manual = await asc(
    'GET',
    `/appPriceSchedules/${existing.data.id}/manualPrices?include=appPricePoint&limit=50`,
  ).catch(() => null);
  const activeManualPrice = manual?.data?.find(price => !price.attributes.endDate) || manual?.data?.[0];
  const currentPointID = activeManualPrice?.relationships?.appPricePoint?.data?.id;
  if (!FORCE && currentPointID === freePoint.id) {
    console.log('✓ Current price already uses the free price point. Skip.');
    process.exit(0);
  }
}

// ASC inline-create IDs must use JSON:API local-id syntax ("${local-id}").
const appPriceId = `\${free-price-${crypto.randomUUID()}}`;
await asc('POST', '/appPriceSchedules', {
  data: {
    type: 'appPriceSchedules',
    relationships: {
      app: { data: { type: 'apps', id: app.id } },
      baseTerritory: { data: { type: 'territories', id: BASE_TERRITORY } },
      manualPrices: { data: [{ type: 'appPrices', id: appPriceId }] },
    },
  },
  included: [{
    type: 'appPrices',
    id: appPriceId,
    attributes: { startDate: null },
    relationships: {
      appPricePoint: { data: { type: 'appPricePoints', id: freePoint.id } },
    },
  }],
});

console.log('✓ Pricing set to Free.');
