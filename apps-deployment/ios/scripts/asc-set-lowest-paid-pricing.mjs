#!/usr/bin/env node
// Sets an App Store Connect app price schedule to a paid price point using the
// official ASC API. Defaults to the lowest non-free price point.
//
// Required env: ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID
// Optional env:
//   ASC_KEY_PATH
//   ASC_PRICE_BASE_TERRITORY (default: USA)
//   ASC_TARGET_CUSTOMER_PRICE (example: 0.99)
//
// Flags:
//   --customer-price=<price>
//   --force    Recreate the schedule even when the current manual price already
//              points at the selected paid price point.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
const BASE_TERRITORY = process.env.ASC_PRICE_BASE_TERRITORY || 'USA';
const TARGET_CUSTOMER_PRICE = process.argv
  .find(arg => arg.startsWith('--customer-price='))
  ?.split('=')
  .slice(1)
  .join('=') || process.env.ASC_TARGET_CUSTOMER_PRICE || '';
const FORCE = process.argv.includes('--force');

if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID) {
  console.error('ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID env vars required.');
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
  if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status}\n${await res.text()}`);
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

function priceNumber(point) {
  const value = Number(point.attributes.customerPrice);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function isTargetPrice(point, target) {
  return Math.abs(priceNumber(point) - target) < 0.000001;
}

const apps = await asc('GET', `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
const app = apps.data[0];
if (!app) {
  throw new Error(
    `No App Store Connect app record found for bundleId=${BUNDLE_ID}. ` +
    'Create the app record in App Store Connect first, then rerun this script.',
  );
}
console.log(`App ${app.attributes.name} (${app.id})`);

const points = await collect(
  `/apps/${app.id}/appPricePoints?filter[territory]=${encodeURIComponent(BASE_TERRITORY)}&limit=200`,
);
const paidPoints = points
  .filter(point => priceNumber(point) > 0)
  .sort((a, b) => priceNumber(a) - priceNumber(b));
if (!paidPoints[0]) {
  throw new Error(`No paid appPricePoint found for territory=${BASE_TERRITORY}`);
}

let selectedPoint = paidPoints[0];
let selectionLabel = 'lowest paid';
if (TARGET_CUSTOMER_PRICE) {
  const target = Number(TARGET_CUSTOMER_PRICE);
  if (!Number.isFinite(target) || target <= 0) {
    throw new Error(`ASC_TARGET_CUSTOMER_PRICE must be a positive number. Got: ${TARGET_CUSTOMER_PRICE}`);
  }
  selectedPoint = paidPoints.find(point => isTargetPrice(point, target));
  selectionLabel = `target paid ${target.toFixed(2)}`;
  if (!selectedPoint) {
    const available = paidPoints
      .map(point => point.attributes.customerPrice)
      .filter((price, index, prices) => prices.indexOf(price) === index)
      .slice(0, 30)
      .join(', ');
    throw new Error(
      `No appPricePoint with customerPrice=${TARGET_CUSTOMER_PRICE} for territory=${BASE_TERRITORY}. ` +
      `Available paid prices include: ${available}`,
    );
  }
}

const tier = selectedPoint.attributes.priceTier ?? selectedPoint.attributes.priceTierName ?? 'unknown tier';
console.log(
  `${selectionLabel} point for ${BASE_TERRITORY}: ${selectedPoint.id} ` +
  `customerPrice=${selectedPoint.attributes.customerPrice} tier=${tier}`,
);

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
  if (!FORCE && currentPointID === selectedPoint.id) {
    console.log(`Current price already uses the ${selectionLabel} price point. Skip.`);
    process.exit(0);
  }
}

// ASC inline-create IDs must use JSON:API local-id syntax ("${local-id}").
const appPriceId = `\${paid-price-${crypto.randomUUID()}}`;
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
      appPricePoint: { data: { type: 'appPricePoints', id: selectedPoint.id } },
    },
  }],
});

console.log(
  `Price schedule set to the ${selectionLabel} ${BASE_TERRITORY} price: ` +
  `${selectedPoint.attributes.customerPrice}`,
);
