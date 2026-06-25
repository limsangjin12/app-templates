#!/usr/bin/env node
// Set Beta App Localizations and Beta Build Localizations.
//
// Required env: ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID
// Optional:
//   ASC_KEY_PATH
//   ASC_BETA_LOCALIZATIONS_FILE  JSON file with { appLocalizations, buildLocalizations }
//   --build=<version>            build version for What to Test; default latest
//
// JSON schema:
// {
//   "appLocalizations": {
//     "en-US": {
//       "description": "...",
//       "feedbackEmail": "support@example.com",
//       "privacyPolicyUrl": "https://example.com/privacy.html",
//       "marketingUrl": "https://example.com/"
//     }
//   },
//   "buildLocalizations": {
//     "en-US": "What testers should verify."
//   }
// }

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID) {
  console.error('Missing ASC_API_KEY, ASC_API_ISSUER, or ASC_BUNDLE_ID.');
  process.exit(2);
}

const BUILD_VERSION = process.argv.find((a) => a.startsWith('--build='))?.slice(8);
const KEY_PATH = process.env.ASC_KEY_PATH ||
  path.join(os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);
const LOCALIZATIONS_FILE = process.env.ASC_BETA_LOCALIZATIONS_FILE ||
  path.join(process.cwd(), 'store-listings', 'asc-beta-localizations.json');
const API = 'https://api.appstoreconnect.apple.com/v1';

if (!fs.existsSync(LOCALIZATIONS_FILE)) {
  console.error(`Localization file not found: ${LOCALIZATIONS_FILE}`);
  process.exit(2);
}

const config = JSON.parse(fs.readFileSync(LOCALIZATIONS_FILE, 'utf8'));
const APP_LOC = config.appLocalizations || {};
const BUILD_LOC = config.buildLocalizations || {};

function tok() {
  return jwt.sign({}, fs.readFileSync(KEY_PATH, 'utf8'), {
    algorithm: 'ES256',
    expiresIn: '15m',
    audience: 'appstoreconnect-v1',
    issuer: ISSUER_ID,
    keyid: KEY_ID,
  });
}

async function asc(method, pathname, body) {
  const response = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${tok()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`${method} ${pathname} -> ${response.status}\n${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

const apps = await asc('GET', `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
const app = apps.data[0];
if (!app) {
  console.error(`No App Store Connect app found for ${BUNDLE_ID}`);
  process.exit(3);
}
console.log(`App ${app.attributes.name} id=${app.id}`);

if (Object.keys(APP_LOC).length) {
  const existing = await asc('GET', `/apps/${app.id}/betaAppLocalizations`);
  const byLocale = Object.fromEntries(existing.data.map((d) => [d.attributes.locale, d]));
  for (const [locale, attrs] of Object.entries(APP_LOC)) {
    if (byLocale[locale]) {
      console.log(`PATCH app localization ${locale}`);
      await asc('PATCH', `/betaAppLocalizations/${byLocale[locale].id}`, {
        data: { type: 'betaAppLocalizations', id: byLocale[locale].id, attributes: attrs },
      });
    } else {
      console.log(`POST app localization ${locale}`);
      await asc('POST', '/betaAppLocalizations', {
        data: {
          type: 'betaAppLocalizations',
          attributes: { ...attrs, locale },
          relationships: { app: { data: { type: 'apps', id: app.id } } },
        },
      });
    }
  }
}

if (Object.keys(BUILD_LOC).length) {
  let build;
  if (BUILD_VERSION) {
    const result = await asc('GET',
      `/builds?filter[app]=${app.id}&filter[version]=${BUILD_VERSION}&limit=1`);
    build = result.data[0];
  } else {
    const result = await asc('GET', `/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=1`);
    build = result.data[0];
  }
  if (!build) {
    console.error('No build found.');
    process.exit(3);
  }
  console.log(`Build ${build.attributes.version} id=${build.id}`);

  const existing = await asc('GET', `/builds/${build.id}/betaBuildLocalizations`);
  const byLocale = Object.fromEntries(existing.data.map((d) => [d.attributes.locale, d]));
  for (const [locale, whatsNew] of Object.entries(BUILD_LOC)) {
    if (byLocale[locale]) {
      console.log(`PATCH build localization ${locale}`);
      await asc('PATCH', `/betaBuildLocalizations/${byLocale[locale].id}`, {
        data: {
          type: 'betaBuildLocalizations',
          id: byLocale[locale].id,
          attributes: { whatsNew },
        },
      });
    } else {
      console.log(`POST build localization ${locale}`);
      await asc('POST', '/betaBuildLocalizations', {
        data: {
          type: 'betaBuildLocalizations',
          attributes: { locale, whatsNew },
          relationships: { build: { data: { type: 'builds', id: build.id } } },
        },
      });
    }
  }
}

console.log('Beta localizations set.');

