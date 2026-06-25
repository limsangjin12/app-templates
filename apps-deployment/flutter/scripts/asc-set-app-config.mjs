#!/usr/bin/env node
// 신규 앱 첫 심사 제출 전에 필요한 ASC 1회성 설정을 일괄 적용한다.
//   1) Age Rating Declaration — 모든 카테고리 NONE / false (Token Dog 같은
//      유틸리티 기본값. 게임/소셜 등은 별도 메타데이터 매핑 필요).
//   2) contentRightsDeclaration — DOES_NOT_USE_THIRD_PARTY_CONTENT 또는
//      USES_THIRD_PARTY_CONTENT (env 로 override).
//   3) Pricing — Free (USD_0) 기본. ASC_PRICE_TIER 로 override 가능.
//   4) App Privacy — "Data Not Collected" 기본 — 즉, appDataUsage 0 개 +
//      appDataUsagePublishState published. 실제 수집이 있는 앱은 별도
//      구성 필요.
//
// 환경변수:
//   ASC_API_KEY / ASC_API_ISSUER / ASC_BUNDLE_ID 필수
//   ASC_KEY_PATH 선택
//   ASC_PRICE_TIER 선택 (기본 "USD_0")
//   ASC_USES_THIRD_PARTY_CONTENT 선택 (true 면 USES_THIRD_PARTY_CONTENT)
//   ASC_AGE_OVERRIDES 선택 — JSON 으로 일부 카테고리만 덮어쓰기
//                       e.g. '{"violenceCartoonOrFantasy":"INFREQUENT_OR_MILD"}'
//
// 멱등 — 이미 적용된 항목은 그대로 두고, 누락된 부분만 채움.

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

const PRICE_TIER  = process.env.ASC_PRICE_TIER || 'USD_0';
const RIGHTS_DECL = process.env.ASC_USES_THIRD_PARTY_CONTENT === 'true'
  ? 'USES_THIRD_PARTY_CONTENT'
  : 'DOES_NOT_USE_THIRD_PARTY_CONTENT';
const AGE_OVERRIDES = process.env.ASC_AGE_OVERRIDES
  ? JSON.parse(process.env.ASC_AGE_OVERRIDES)
  : {};

const API = 'https://api.appstoreconnect.apple.com/v1';

function newToken() {
  const key = fs.readFileSync(KEY_PATH, 'utf8');
  return jwt.sign({}, key, {
    algorithm: 'ES256', expiresIn: '15m',
    audience: 'appstoreconnect-v1', issuer: ISSUER_ID, keyid: KEY_ID,
  });
}

async function asc(method, pathname, body) {
  const url = pathname.startsWith('http')
    ? pathname
    : `${API}${pathname}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${newToken()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${method} ${pathname} → ${res.status}: ${txt}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── 0) App + AppInfo lookup ──────────────────────────────────────────
console.log(`→ Looking up app ${BUNDLE_ID}…`);
const apps = await asc('GET',
  `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&include=appInfos`);
const app = apps.data[0];
if (!app) throw new Error(`No app for bundleId=${BUNDLE_ID}`);
console.log(`  App: ${app.attributes.name} (${app.id})`);

const appInfos = (apps.included ?? []).filter(x => x.type === 'appInfos');
// editable appInfo 우선 — state 가 PREPARE_FOR_SUBMISSION / READY_FOR_SALE 등
const editable = appInfos.find(ai =>
  ai.attributes.state === 'PREPARE_FOR_SUBMISSION') || appInfos[0];
if (!editable) throw new Error('No appInfo found');
console.log(`  AppInfo: ${editable.id} state=${editable.attributes.state}`);

// ── 1) Age Rating Declaration ────────────────────────────────────────
console.log('\n=== Age Rating Declaration ===');
// AgeRatingDeclaration은 appInfo 하위 리소스
const ardResp = await asc('GET',
  `/appInfos/${editable.id}/ageRatingDeclaration`);
const ard = ardResp.data;
if (!ard) {
  throw new Error('No ageRatingDeclaration on this appInfo');
}
console.log(`  Declaration id: ${ard.id}`);

// Token Dog 기본값 — 모든 카테고리 NONE.
// ASC API 2024 이후 모든 age rating 카테고리가 STRING enum 으로 통일됨:
// NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE / INFREQUENT / FREQUENT.
const ageDefaults = {
  // STRING enum: NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE 등
  alcoholTobaccoOrDrugUseOrReferences: 'NONE',
  contests: 'NONE',
  gamblingSimulated: 'NONE',
  horrorOrFearThemes: 'NONE',
  matureOrSuggestiveThemes: 'NONE',
  medicalOrTreatmentInformation: 'NONE',
  profanityOrCrudeHumor: 'NONE',
  sexualContentGraphicAndNudity: 'NONE',
  sexualContentOrNudity: 'NONE',
  violenceCartoonOrFantasy: 'NONE',
  violenceRealistic: 'NONE',
  violenceRealisticProlongedGraphicOrSadistic: 'NONE',
  ageRatingOverride: 'NONE',
  // 2025+ 추가 — gunsOrOtherWeapons 만 enum, 나머지는 boolean
  gunsOrOtherWeapons: 'NONE',
  // BOOLEAN
  advertising: false,
  ageAssurance: false,
  gambling: false,
  healthOrWellnessTopics: false,
  lootBox: false,
  messagingAndChat: false,
  parentalControls: false,
  unrestrictedWebAccess: false,
  userGeneratedContent: false,
};
const ageAttrs = { ...ageDefaults, ...AGE_OVERRIDES };
console.log('  Patching with:', Object.keys(ageAttrs).length, 'fields…');
await asc('PATCH', `/ageRatingDeclarations/${ard.id}`, {
  data: {
    type: 'ageRatingDeclarations',
    id: ard.id,
    attributes: ageAttrs,
  },
});
console.log('  ✓ Age rating declared');

// ── 2) contentRightsDeclaration ─────────────────────────────────────
console.log('\n=== Content Rights Declaration ===');
console.log(`  Setting: ${RIGHTS_DECL}`);
await asc('PATCH', `/apps/${app.id}`, {
  data: {
    type: 'apps',
    id: app.id,
    attributes: { contentRightsDeclaration: RIGHTS_DECL },
  },
});
console.log('  ✓ Rights declared');

// ── 3) Pricing — Free 기본 ──────────────────────────────────────────
console.log('\n=== Pricing ===');
// 기존 schedule 체크
const schedResp = await asc('GET',
  `/apps/${app.id}/appPriceSchedule?include=manualPrices,baseTerritory`).catch(() => null);
if (schedResp?.data?.id) {
  console.log(`  Existing schedule: ${schedResp.data.id} — skip`);
} else {
  console.log('  No schedule — creating Free pricing…');
  // pricePoint 찾기 — USA territory + 무료 (customerPrice "0.0")
  const ppResp = await asc('GET',
    `/apps/${app.id}/appPricePoints?filter[territory]=USA&limit=200`);
  const freePoint = ppResp.data.find(pp => {
    const c = pp.attributes.customerPrice;
    return c === '0' || c === '0.0' || c === '0.00';
  });
  if (!freePoint) {
    throw new Error('Free pricePoint (USA, customerPrice 0) not found');
  }
  console.log(`  Free pricePoint: ${freePoint.id}`);

  // appPriceSchedule 은 included 로 manualPrice (appPrice) 를 새로 만들고
  // 그것을 manualPrices 관계에 연결하는 패턴.
  const NEW_APP_PRICE_ID = '${appPriceId}';
  await asc('POST', '/appPriceSchedules', {
    data: {
      type: 'appPriceSchedules',
      relationships: {
        app: { data: { type: 'apps', id: app.id } },
        baseTerritory: { data: { type: 'territories', id: 'USA' } },
        manualPrices: {
          data: [{ type: 'appPrices', id: NEW_APP_PRICE_ID }],
        },
      },
    },
    included: [{
      type: 'appPrices',
      id: NEW_APP_PRICE_ID,
      attributes: { startDate: null },
      relationships: {
        appPricePoint: { data: { type: 'appPricePoints', id: freePoint.id } },
      },
    }],
  });
  console.log('  ✓ Pricing set (Free)');
}

// ── 4) App Privacy — ASC API 미지원 (2025 시점) ─────────────────────
console.log('\n=== App Privacy ===');
console.log('  ⚠ App Privacy / Data Usages 는 ASC 공개 API 미지원');
console.log('  → 웹 콘솔에서 1회만 설정:');
console.log(`     https://appstoreconnect.apple.com/apps/${app.id}/distribution/privacy`);
console.log('  → "Data Not Collected" 선택 후 Publish.');
console.log('  → 다음 버전부터는 그대로 유지됨.');

console.log('\n✅ App config registered (3/4 항목 — Privacy 만 웹 1단계 필요).');
