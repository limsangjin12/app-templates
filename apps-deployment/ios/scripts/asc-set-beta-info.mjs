#!/usr/bin/env node
// Beta App Localization (description / feedbackEmail / privacy / marketing)
// + Beta Build Localization (whatsNew) + Beta App Review Detail (contact / notes)
// 등록/갱신.
//
// `<app>/store-listings/asc-metadata.json` 의 locales / privacyUrl / marketingUrl /
// reviewContact 를 그대로 재사용 — App Store 메타데이터와 TestFlight 메타데이터가
// 갈라지지 않도록 단일 출처. minical 의 `set-beta-description.mjs` (앱 텍스트
// 하드코딩) 를 일반화한 버전.
//
// 채워두지 않으면 App Store Connect TestFlight UI 가 그룹의 빌드 목록을 비워서
// 표시 — internal 그룹조차 빌드 노출이 안 된다. 필요한 3 가지:
//   1. betaAppLocalizations: description / feedbackEmail / privacyPolicyUrl / marketingUrl
//   2. betaBuildLocalizations: whatsNew (per build)
//   3. betaAppReviewDetail: contactFirstName / contactLastName / contactPhone /
//      contactEmail / notes (UI 가 internal 그룹에서도 이거 안 채워두면 build 미노출).
//
// Required env: ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID
// Optional flags:
//   ASC_PLATFORM          IOS / MAC_OS / TV_OS / VISION_OS (default IOS)
//   --metadata=<path>    asc-metadata.json 경로 (기본: ./store-listings/asc-metadata.json)
//   --build=<version>    whatsNew 를 적용할 build version (기본: 가장 최근)
//   --whats-new=<key>    asc-metadata locales 의 어떤 필드를 whatsNew 로 쓸지 (기본: whatsNew)
//   --skip-build         betaBuildLocalizations 건너뛰기 (앱 메타만)

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

function flag(name, fallback) {
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
    if (a === name) return true;
  }
  return fallback;
}
const META_PATH = path.resolve(flag('--metadata', './store-listings/asc-metadata.json'));
const BUILD_VERSION = flag('--build', null);
const WHATS_NEW_KEY = flag('--whats-new', 'whatsNew');
const SKIP_BUILD = flag('--skip-build', false) === true;
const PLATFORM = (process.env.ASC_PLATFORM || 'IOS').toUpperCase();
const PLATFORM_FILTER = PLATFORM === 'MACOS' ? 'MAC_OS' : PLATFORM;

const KEY_PATH = path.join(os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);
const API = 'https://api.appstoreconnect.apple.com/v1';

function tok() {
  return jwt.sign({}, fs.readFileSync(KEY_PATH, 'utf8'), {
    algorithm: 'ES256', expiresIn: '15m',
    audience: 'appstoreconnect-v1', issuer: ISSUER_ID, keyid: KEY_ID,
  });
}
async function asc(method, p, body) {
  const r = await fetch(API + p, {
    method,
    headers: { Authorization: `Bearer ${tok()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status}\n${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
const rc = meta.reviewContact;
if (!rc?.contactEmail) throw new Error('reviewContact.contactEmail missing in metadata');
const feedbackEmail = rc.contactEmail;

const apps = await asc('GET', `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
const app = apps.data[0];
if (!app) throw new Error(`No app for bundleId=${BUNDLE_ID}`);
console.log(`App ${app.attributes.name} (${app.id})`);

// 1) betaAppLocalizations — 앱 단위, 빌드 사이 영구.
const existing = await asc('GET', `/apps/${app.id}/betaAppLocalizations`);
const byLocale = Object.fromEntries(existing.data.map(d => [d.attributes.locale, d]));
for (const [locale, m] of Object.entries(meta.locales)) {
  const attrs = {
    description: m.description,
    feedbackEmail,
    privacyPolicyUrl: meta.privacyUrl,
    marketingUrl: meta.marketingUrl,
  };
  if (byLocale[locale]) {
    console.log(`  PATCH app loc ${locale}`);
    await asc('PATCH', `/betaAppLocalizations/${byLocale[locale].id}`, {
      data: { type: 'betaAppLocalizations', id: byLocale[locale].id, attributes: attrs },
    });
  } else {
    console.log(`  POST  app loc ${locale}`);
    await asc('POST', '/betaAppLocalizations', {
      data: {
        type: 'betaAppLocalizations',
        attributes: { ...attrs, locale },
        relationships: { app: { data: { type: 'apps', id: app.id } } },
      },
    });
  }
}

// 1.5) betaAppReviewDetail — 앱 단위, beta UI/external 리뷰가 공통으로 본다.
console.log(`  PATCH betaAppReviewDetail`);
await asc('PATCH', `/betaAppReviewDetails/${app.id}`, {
  data: {
    type: 'betaAppReviewDetails',
    id: app.id,
    attributes: {
      contactFirstName: rc.contactFirstName,
      contactLastName: rc.contactLastName,
      contactPhone: rc.contactPhone,
      contactEmail: rc.contactEmail,
      demoAccountRequired: rc.demoAccountRequired ?? false,
      demoAccountName: rc.demoAccountName ?? null,
      demoAccountPassword: rc.demoAccountPassword ?? null,
      notes: rc.notes ?? null,
    },
  },
});

if (SKIP_BUILD) {
  console.log('✅ beta app localizations + review detail set (build skipped)');
  process.exit(0);
}

// 2) betaBuildLocalizations — 빌드별 "What to Test".
let build;
if (BUILD_VERSION) {
  const q = new URLSearchParams({
    'filter[app]': app.id,
    'filter[version]': BUILD_VERSION,
    'filter[preReleaseVersion.platform]': PLATFORM_FILTER,
    'sort': '-uploadedDate',
    'limit': '1',
  });
  const r = await asc('GET', `/builds?${q.toString()}`);
  build = r.data[0];
} else {
  const q = new URLSearchParams({
    'filter[app]': app.id,
    'filter[preReleaseVersion.platform]': PLATFORM_FILTER,
    'sort': '-uploadedDate',
    'limit': '1',
  });
  const r = await asc('GET', `/builds?${q.toString()}`);
  build = r.data[0];
}
if (!build) {
  console.log('  (no build found — re-run with --skip-build or after upload)');
  process.exit(0);
}
console.log(`Build ${build.attributes.version} (${build.id})`);

const bbl = await asc('GET', `/builds/${build.id}/betaBuildLocalizations`);
const bblByLocale = Object.fromEntries(bbl.data.map(d => [d.attributes.locale, d]));
for (const [locale, m] of Object.entries(meta.locales)) {
  const whatsNew = m[WHATS_NEW_KEY];
  if (!whatsNew) continue;
  if (bblByLocale[locale]) {
    console.log(`  PATCH build loc ${locale}`);
    await asc('PATCH', `/betaBuildLocalizations/${bblByLocale[locale].id}`, {
      data: { type: 'betaBuildLocalizations', id: bblByLocale[locale].id, attributes: { whatsNew } },
    });
  } else {
    console.log(`  POST  build loc ${locale}`);
    await asc('POST', '/betaBuildLocalizations', {
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale, whatsNew },
        relationships: { build: { data: { type: 'builds', id: build.id } } },
      },
    });
  }
}

console.log('✅ beta localizations set');
