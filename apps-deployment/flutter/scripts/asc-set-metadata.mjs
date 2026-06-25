#!/usr/bin/env node
// Registers App Store Connect metadata (per-locale name / subtitle /
// keywords / description / privacy + support URL, category, copyright,
// reviewer contact) from a JSON config file.
//
// Required env vars:
//   ASC_API_KEY      e.g. <KEY_ID>
//   ASC_API_ISSUER   UUID
//   ASC_BUNDLE_ID    com.example.myapp
//
// Optional:
//   ASC_KEY_PATH     .p8 path
//   --metadata=<path>  config JSON (default: ./store-listings/asc-metadata.json)
//
// Config schema:
//   {
//     "supportUrl": "...",
//     "privacyUrl": "...",
//     "marketingUrl": "...",          // optional, default: supportUrl
//     "copyright": "2026 Example",     // optional
//     "primaryCategory": "GAMES",      // optional
//     "primarySubcategoryOne": "GAMES_BOARD",
//     "primarySubcategoryTwo": "GAMES_STRATEGY",
//     "secondaryCategory": "...",      // optional
//     "reviewContact": { ... },        // optional
//     "nameFallbackSuffixes": ["+"],   // optional, retry suffixes when name taken
//     "locales": {
//       "en-US": { "name": "...", "subtitle": "...",
//                  "keywords": "...", "description": "..." },
//       ...
//     }
//   }
//
// Run:
//   ASC_API_KEY=... ASC_API_ISSUER=... ASC_BUNDLE_ID=... \
//     node /path/to/apps-deployment/flutter/scripts/asc-set-metadata.mjs

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

const args = Object.fromEntries(process.argv.slice(2)
  .map(a => a.startsWith('--') ? a.slice(2).split('=') : [a, true]));
const METADATA_PATH = path.resolve(args.metadata
  || path.join(process.cwd(), 'store-listings', 'asc-metadata.json'));

if (!fs.existsSync(METADATA_PATH)) {
  console.error(`❌ Metadata file not found: ${METADATA_PATH}`);
  process.exit(2);
}
const cfg = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8'));
if (!cfg.locales || !Object.keys(cfg.locales).length) {
  console.error('❌ Config has no `locales` map.');
  process.exit(2);
}

const SUPPORT_URL    = cfg.supportUrl;
const PRIVACY_URL    = cfg.privacyUrl;
const MARKETING_URL  = cfg.marketingUrl || cfg.supportUrl;
const COPYRIGHT      = cfg.copyright;
const REVIEW_CONTACT = cfg.reviewContact;
const NAME_FALLBACKS = cfg.nameFallbackSuffixes || [];

const API = 'https://api.appstoreconnect.apple.com/v1';

function newToken() {
  const key = fs.readFileSync(KEY_PATH, 'utf8');
  return jwt.sign({}, key, {
    algorithm: 'ES256', expiresIn: '15m',
    audience: 'appstoreconnect-v1', issuer: ISSUER_ID, keyid: KEY_ID,
  });
}

async function asc(method, pathname, body) {
  const retryStatuses = new Set([401, 429, 500, 502, 503, 504]);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(`${API}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${newToken()}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) {
      if (res.status === 204) return null;
      return res.json();
    }
    const text = await res.text();
    if (!retryStatuses.has(res.status) || attempt === 3) {
      throw new Error(`${method} ${pathname} → ${res.status}: ${text}`);
    }
    const delayMs = 1000 * 2 ** attempt;
    console.log(`    ↳ ASC ${res.status}; retrying in ${delayMs}ms (${attempt + 1}/3)`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

async function main() {
  console.log(`Loading metadata from ${METADATA_PATH}`);

  console.log('→ Locating app by bundle ID…');
  const apps = await asc('GET',
    `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
  if (!apps.data.length) throw new Error(`No app found for bundleId=${BUNDLE_ID}`);
  const app = apps.data[0];
  console.log(`  App: ${app.attributes.name}  (id=${app.id})`);

  console.log('→ Fetching appInfos (editable)…');
  const appInfos = await asc('GET', `/apps/${app.id}/appInfos`);
  const editableStates = new Set([
    'PREPARE_FOR_SUBMISSION', 'METADATA_REJECTED', 'WAITING_FOR_REVIEW',
    'DEVELOPER_REJECTED', 'REJECTED', 'INVALID_BINARY',
  ]);
  const appInfo = appInfos.data.find(ai =>
    editableStates.has(ai.attributes.appStoreState)) || appInfos.data[0];
  console.log(`  AppInfo: id=${appInfo.id}, state=${appInfo.attributes.appStoreState}`);

  // Categories: only patch what's provided.
  if (cfg.primaryCategory || cfg.secondaryCategory) {
    console.log('→ Setting categories…');
    const rels = {};
    if (cfg.primaryCategory) {
      rels.primaryCategory = {
        data: { type: 'appCategories', id: cfg.primaryCategory },
      };
    }
    if (cfg.primarySubcategoryOne) {
      rels.primarySubcategoryOne = {
        data: { type: 'appCategories', id: cfg.primarySubcategoryOne },
      };
    }
    if (cfg.primarySubcategoryTwo) {
      rels.primarySubcategoryTwo = {
        data: { type: 'appCategories', id: cfg.primarySubcategoryTwo },
      };
    }
    if (cfg.secondaryCategory) {
      rels.secondaryCategory = {
        data: { type: 'appCategories', id: cfg.secondaryCategory },
      };
    }
    try {
      await asc('PATCH', `/appInfos/${appInfo.id}`, {
        data: { type: 'appInfos', id: appInfo.id, relationships: rels },
      });
    } catch (err) {
      if (!err.message.includes('ENTITY_ERROR.RELATIONSHIP.INVALID_STATE')) throw err;
      console.log('  ↳ categories are locked for the current appInfo state; skipping category patch');
    }
  }

  console.log('→ Fetching existing appInfoLocalizations…');
  const locsResp = await asc('GET',
    `/appInfos/${appInfo.id}/appInfoLocalizations`);
  const existing = new Map();
  for (const loc of locsResp.data) existing.set(loc.attributes.locale, loc);

  const skipped = [];
  for (const [locale, meta] of Object.entries(cfg.locales)) {
    const baseName = meta.name;
    const attempts = [baseName, ...NAME_FALLBACKS.map(s => `${baseName}${s}`)];
    const cur = existing.get(locale);
    let succeeded = false;
    for (const name of attempts) {
      const attrs = {
        ...(cur ? {} : { locale }),
        name,
        ...(meta.subtitle ? { subtitle: meta.subtitle } : {}),
        ...(PRIVACY_URL ? { privacyPolicyUrl: PRIVACY_URL } : {}),
      };
      try {
        if (cur) {
          await asc('PATCH', `/appInfoLocalizations/${cur.id}`, {
            data: { type: 'appInfoLocalizations', id: cur.id, attributes: attrs },
          });
          console.log(`  ↺ UPDATE ${locale}: name="${name}"`);
        } else {
          await asc('POST', '/appInfoLocalizations', {
            data: {
              type: 'appInfoLocalizations',
              attributes: attrs,
              relationships: { appInfo: { data: { type: 'appInfos', id: appInfo.id } } },
            },
          });
          console.log(`  + CREATE ${locale}: name="${name}"`);
        }
        succeeded = true;
        break;
      } catch (err) {
        if (err.message.includes('DIFFERENT_ACCOUNT')) {
          console.log(`    ↳ "${name}" already taken, trying next…`);
          continue;
        }
        throw err;
      }
    }
    if (!succeeded) {
      console.log(`  ⚠  SKIP ${locale}: all candidate names are taken`);
      skipped.push(locale);
    }
  }
  if (skipped.length) {
    console.log(`\n  Locales needing a manual name: ${skipped.join(', ')}`);
  }

  // ASC_PLATFORM 으로 IOS / MAC_OS / TV_OS / VISION_OS 구분 (default IOS).
  // token-dog 같은 macOS 네이티브 앱은 MAC_OS, iOS Flutter 앱은 IOS.
  const PLATFORM = (process.env.ASC_PLATFORM || 'IOS').toUpperCase();
  const PLATFORM_FILTER = PLATFORM === 'MACOS' ? 'MAC_OS' : PLATFORM;
  console.log(`→ Fetching current editable appStoreVersion (platform=${PLATFORM_FILTER})…`);
  const versions = await asc('GET',
    `/apps/${app.id}/appStoreVersions?filter[platform]=${PLATFORM_FILTER}&filter[appStoreState]=PREPARE_FOR_SUBMISSION,WAITING_FOR_REVIEW,METADATA_REJECTED,DEVELOPER_REJECTED,REJECTED&limit=5`);
  const version = versions.data[0];
  if (!version) {
    console.log('  (no editable version — skipping version localization step)');
  } else {
    console.log(`  Version: ${version.attributes.versionString}  state=${version.attributes.appStoreState}`);
    const vLocsResp = await asc('GET',
      `/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
    const vExisting = new Map();
    for (const loc of vLocsResp.data) vExisting.set(loc.attributes.locale, loc);
    for (const [locale, meta] of Object.entries(cfg.locales)) {
      const cur = vExisting.get(locale);
      const attrs = {
        ...(MARKETING_URL ? { marketingUrl: MARKETING_URL } : {}),
        ...(SUPPORT_URL   ? { supportUrl: SUPPORT_URL } : {}),
        ...(meta.description ? { description: meta.description } : {}),
        ...(meta.keywords    ? { keywords: meta.keywords } : {}),
        ...(meta.whatsNew    ? { whatsNew: meta.whatsNew } : {}),
        ...(meta.promotionalText ? { promotionalText: meta.promotionalText } : {}),
      };
      const isLockedWhatsNewError = (err) =>
        err.message.includes("Attribute 'whatsNew' cannot be edited at this time");
      const withoutWhatsNew = ({ whatsNew, ...rest }) => rest;

      if (cur) {
        console.log(`  ↺ UPDATE ${locale} version localization`);
        try {
          await asc('PATCH', `/appStoreVersionLocalizations/${cur.id}`, {
            data: { type: 'appStoreVersionLocalizations', id: cur.id, attributes: attrs },
          });
        } catch (err) {
          if (!attrs.whatsNew || !isLockedWhatsNewError(err)) throw err;
          console.log(`    ↳ whatsNew locked for this version; retrying ${locale} without whatsNew`);
          await asc('PATCH', `/appStoreVersionLocalizations/${cur.id}`, {
            data: { type: 'appStoreVersionLocalizations', id: cur.id, attributes: withoutWhatsNew(attrs) },
          });
        }
      } else {
        console.log(`  + CREATE ${locale} version localization`);
        try {
          await asc('POST', '/appStoreVersionLocalizations', {
            data: {
              type: 'appStoreVersionLocalizations',
              attributes: { locale, ...attrs },
              relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } },
            },
          });
        } catch (err) {
          if (!attrs.whatsNew || !isLockedWhatsNewError(err)) throw err;
          console.log(`    ↳ whatsNew locked for this version; retrying ${locale} without whatsNew`);
          await asc('POST', '/appStoreVersionLocalizations', {
            data: {
              type: 'appStoreVersionLocalizations',
              attributes: { locale, ...withoutWhatsNew(attrs) },
              relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } },
            },
          });
        }
      }
    }

    if (COPYRIGHT) {
      console.log('→ Setting copyright on appStoreVersion…');
      await asc('PATCH', `/appStoreVersions/${version.id}`, {
        data: {
          type: 'appStoreVersions',
          id: version.id,
          attributes: { copyright: COPYRIGHT },
        },
      });
    }

    if (REVIEW_CONTACT) {
      console.log('→ Setting App Review contact info + reviewer notes…');
      const reviewResp = await asc('GET',
        `/appStoreVersions/${version.id}/appStoreReviewDetail`);
      if (reviewResp && reviewResp.data) {
        await asc('PATCH', `/appStoreReviewDetails/${reviewResp.data.id}`, {
          data: {
            type: 'appStoreReviewDetails',
            id: reviewResp.data.id,
            attributes: REVIEW_CONTACT,
          },
        });
      } else {
        await asc('POST', '/appStoreReviewDetails', {
          data: {
            type: 'appStoreReviewDetails',
            attributes: REVIEW_CONTACT,
            relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } },
          },
        });
      }
    }
  }

  console.log('\n✅ App Store Connect metadata registered.');
}

main().catch(err => {
  console.error('\n❌', err.message);
  process.exit(1);
});
