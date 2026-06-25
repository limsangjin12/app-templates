#!/usr/bin/env node
// Update App Store Connect URLs (privacy / marketing / support) for every
// app in apps-config.mjs. Per-locale, applied to:
//   - appInfoLocalizations.privacyPolicyUrl  (every existing locale)
//   - appStoreVersionLocalizations.marketingUrl + supportUrl
//     (every existing locale on the editable version, if one exists)
//
// Idempotent: PATCHes only change values that differ. If the editable version
// is missing, only privacyPolicyUrl is updated (which lives on appInfo and
// applies to all future versions).
//
// Run:
//   cd infra/scripts
//   node update-asc-urls.mjs              # update both apps
//   node update-asc-urls.mjs --app=gomoku # one app
//   node update-asc-urls.mjs --dry-run    # show what would change

import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import { APPS, ASC } from './apps-config.mjs';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const ONLY = [...args].find(a => a.startsWith('--app='))?.slice('--app='.length);

const API = 'https://api.appstoreconnect.apple.com/v1';

function makeJwt() {
  if (!fs.existsSync(ASC.keyPath)) {
    throw new Error(`ASC key not found at ${ASC.keyPath}`);
  }
  const privateKey = fs.readFileSync(ASC.keyPath, 'utf8');
  return jwt.sign({}, privateKey, {
    algorithm: 'ES256',
    expiresIn: '20m',
    issuer: ASC.issuerId,
    audience: 'appstoreconnect-v1',
    header: { alg: 'ES256', kid: ASC.keyId, typ: 'JWT' },
  });
}

async function asc(token, method, path, body) {
  const resp = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ASC ${method} ${path} → ${resp.status}\n${text}`);
  }
  if (resp.status === 204) return null;
  return resp.json();
}

async function findApp(token, bundleId) {
  const r = await asc(token, 'GET', `/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
  return r.data[0] || null;
}

const EDITABLE_INFO_STATES = new Set([
  'PREPARE_FOR_SUBMISSION',
  'WAITING_FOR_REVIEW',
  'METADATA_REJECTED',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'INVALID_BINARY',
]);

const EDITABLE_VERSION_STATES = [
  'PREPARE_FOR_SUBMISSION',
  'WAITING_FOR_REVIEW',
  'METADATA_REJECTED',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'INVALID_BINARY',
].join(',');

async function updateApp(token, app) {
  console.log(`\n── ${app.name} (${app.bundleId})`);
  console.log(`   privacy = ${app.urls.privacy}`);
  console.log(`   marketing = ${app.urls.home}`);
  console.log(`   support = ${app.urls.support}`);

  const ascApp = await findApp(token, app.bundleId);
  if (!ascApp) {
    console.log(`   ⚠ app not found in ASC — skipping`);
    return { skipped: true };
  }

  // 1. appInfoLocalizations.privacyPolicyUrl
  // Only the editable AppInfo accepts PATCH. The live one (READY_FOR_DISTRIBUTION
  // / READY_FOR_SALE) returns 409 INVALID_STATE — Apple requires a new version
  // to change URLs once the app is live.
  const infos = await asc(token, 'GET', `/apps/${ascApp.id}/appInfos`);
  const editableInfo = infos.data.find(i =>
    EDITABLE_INFO_STATES.has(i.attributes.state) ||
    EDITABLE_INFO_STATES.has(i.attributes.appStoreState),
  );
  if (!editableInfo) {
    const states = infos.data.map(i => i.attributes.state ?? i.attributes.appStoreState).join(', ');
    console.log(`   no editable AppInfo (states: ${states}).`);
    console.log(`   App is fully live — create a new version (e.g. by uploading a new build) to update URLs.`);
    return { liveOnly: true };
  }

  const locsResp = await asc(token, 'GET', `/appInfos/${editableInfo.id}/appInfoLocalizations`);
  let updatedInfo = 0, skippedInfo = 0;
  for (const loc of locsResp.data) {
    if (loc.attributes.privacyPolicyUrl === app.urls.privacy) {
      skippedInfo++;
      continue;
    }
    if (DRY) {
      console.log(`   would PATCH ${loc.attributes.locale}: privacy → ${app.urls.privacy}`);
    } else {
      await asc(token, 'PATCH', `/appInfoLocalizations/${loc.id}`, {
        data: {
          type: 'appInfoLocalizations',
          id: loc.id,
          attributes: { privacyPolicyUrl: app.urls.privacy },
        },
      });
    }
    updatedInfo++;
  }
  console.log(`   privacyPolicyUrl: ${updatedInfo} updated, ${skippedInfo} already correct`);

  // 2. appStoreVersionLocalizations.marketingUrl + supportUrl
  const vs = await asc(
    token,
    'GET',
    `/apps/${ascApp.id}/appStoreVersions?filter[platform]=IOS&filter[appStoreState]=${EDITABLE_VERSION_STATES}&limit=5`,
  );
  const version = vs.data[0];
  if (!version) {
    console.log(`   no editable iOS version — marketing/support URLs only apply on next version`);
    return { ok: true };
  }
  console.log(`   editable version: ${version.attributes.versionString} (${version.attributes.appStoreState})`);

  const vlocs = await asc(token, 'GET', `/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  let updatedVer = 0, skippedVer = 0;
  for (const loc of vlocs.data) {
    const same =
      loc.attributes.marketingUrl === app.urls.home &&
      loc.attributes.supportUrl === app.urls.support;
    if (same) {
      skippedVer++;
      continue;
    }
    if (DRY) {
      console.log(`   would PATCH ${loc.attributes.locale}: marketing+support`);
    } else {
      await asc(token, 'PATCH', `/appStoreVersionLocalizations/${loc.id}`, {
        data: {
          type: 'appStoreVersionLocalizations',
          id: loc.id,
          attributes: {
            marketingUrl: app.urls.home,
            supportUrl: app.urls.support,
          },
        },
      });
    }
    updatedVer++;
  }
  console.log(`   marketing/support: ${updatedVer} updated, ${skippedVer} already correct`);

  return { ok: true };
}

async function main() {
  const token = makeJwt();
  const apps = ONLY ? APPS.filter(a => a.name === ONLY) : APPS;
  if (apps.length === 0) {
    console.error(`No app matches --app=${ONLY}. Available: ${APPS.map(a => a.name).join(', ')}`);
    process.exit(1);
  }
  if (DRY) console.log('(DRY RUN — no PATCH issued)');

  let failures = 0;
  for (const app of apps) {
    try {
      await updateApp(token, app);
    } catch (e) {
      console.error(`\n${app.name} failed: ${e.message}`);
      failures++;
    }
  }
  if (failures) process.exit(1);
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
