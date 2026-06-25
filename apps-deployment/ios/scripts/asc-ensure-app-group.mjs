#!/usr/bin/env node
// 입력 받은 App Group identifier 가 ASC 에 등록돼 있는지 확인하고, 입력된
// bundle ID 목록 모두에 APP_GROUPS capability 를 enable + 해당 App Group 과
// 연결한다. 멱등.
//
// Required env vars:
//   ASC_API_KEY, ASC_API_ISSUER
//   ASC_APP_GROUP          예: group.com.example.myapp
//   ASC_APP_GROUP_NAME     ASC 에 표시될 사람 친화 이름. 기본 "<identifier>"
//   ASC_APP_GROUP_BUNDLES  공백 또는 세미콜론 구분 bundle ID 목록.
//                          예: "com.example.myapp com.example.myapp.widgets ..."
//
// Optional:
//   ASC_KEY_PATH

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID    = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const GROUP_ID  = process.env.ASC_APP_GROUP;
const GROUP_NAME = process.env.ASC_APP_GROUP_NAME || GROUP_ID;
const BUNDLES_RAW = process.env.ASC_APP_GROUP_BUNDLES;
if (!KEY_ID || !ISSUER_ID || !GROUP_ID || !BUNDLES_RAW) {
  console.error('❌ ASC_API_KEY, ASC_API_ISSUER, ASC_APP_GROUP, ASC_APP_GROUP_BUNDLES required.');
  process.exit(2);
}
const KEY_PATH = process.env.ASC_KEY_PATH || path.join(
  os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);

const BUNDLES = BUNDLES_RAW.split(/[\s;]+/).map(s => s.trim()).filter(Boolean);
console.log(`app group: ${GROUP_ID}  name: "${GROUP_NAME}"`);
console.log(`bundles (${BUNDLES.length}): ${BUNDLES.join(', ')}`);

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

// ─── 1. bundle ID 매핑 ──────────────────────────────────────────
const bundlesResp = await asc('GET', '/bundleIds?limit=200');
const bundleByIdentifier = new Map(
  bundlesResp.data.map(b => [b.attributes.identifier, b]));
const missing = BUNDLES.filter(b => !bundleByIdentifier.has(b));
if (missing.length) {
  console.error('❌ 다음 Bundle ID 가 ASC 에 없음:');
  for (const m of missing) console.error(`  ${m}`);
  process.exit(3);
}

// ─── 2. App Group 식별 ──────────────────────────────────────────
// 주의: ASC API 의 `/v1/appGroups` root resource 는 일반 ASC API key 로
// 접근 불가 (404). App Group 자체의 등록은 Apple Developer Portal 수동:
//   https://developer.apple.com/account/resources/identifiers/list/applicationGroup
//   + 버튼 → "App Groups" → identifier 와 name 입력
//
// 등록 후 어느 bundle 에라도 한 번 연결해두면 ASC API 가 그 그룹을 "보이는
// 자원" 으로 인식하기 시작. 그 후엔 이 스크립트가 나머지 bundle 들에 자동 연결.
const probeBundle = bundleByIdentifier.get(BUNDLES[0]);
const probe = await asc('GET', `/bundleIds/${probeBundle.id}/appGroups`);
let group = probe.data.find(g => g.attributes.identifier === GROUP_ID);
if (!group) {
  for (const b of BUNDLES.slice(1)) {
    const r = await asc('GET', `/bundleIds/${bundleByIdentifier.get(b).id}/appGroups`);
    group = r.data.find(g => g.attributes.identifier === GROUP_ID);
    if (group) break;
  }
}
if (!group) {
  console.error(`❌ App Group ${GROUP_ID} 가 ASC 에 안 보임.`);
  console.error('   Apple Developer Portal 에서 먼저 등록 + 어느 bundle 에라도 1 회 연결:');
  console.error('   https://developer.apple.com/account/resources/identifiers/list/applicationGroup');
  console.error(`   identifier: ${GROUP_ID}`);
  console.error(`   name:       ${GROUP_NAME}`);
  console.error(`   그 후 어느 bundle (예: ${BUNDLES[0]}) 의 App Groups capability 를 한 번 클릭해 그룹 선택 → Save.`);
  console.error('   이 스크립트 재실행하면 나머지 bundle 들에 대해 자동 진행.');
  process.exit(4);
}
console.log(`app group resolved: ${group.id} (${group.attributes.identifier})`);

// ─── 3. 각 bundle 에 APP_GROUPS capability + 그룹 연결 ─────────
for (const identifier of BUNDLES) {
  const bundle = bundleByIdentifier.get(identifier);
  console.log(`\n── ${identifier} (${bundle.id})`);

  // 3a. APP_GROUPS capability 활성화 (멱등 — 이미 있으면 409 반환, 무시)
  try {
    await asc('POST', '/bundleIdCapabilities', {
      data: {
        type: 'bundleIdCapabilities',
        attributes: { capabilityType: 'APP_GROUPS' },
        relationships: {
          bundleId: { data: { type: 'bundleIds', id: bundle.id } },
        },
      },
    });
    console.log('  capability APP_GROUPS enabled');
  } catch (e) {
    if (/409|already/i.test(e.message)) {
      console.log('  capability APP_GROUPS already enabled');
    } else {
      throw e;
    }
  }

  // 3b. App Group 연결 (POST 으로 set 에 add — 기존 그룹 보존)
  // `?limit=` 파라미터는 이 endpoint 에서도 거부됨.
  const linksResp = await asc('GET', `/bundleIds/${bundle.id}/appGroups`);
  const linkedIds = new Set(linksResp.data.map(g => g.id));
  if (linkedIds.has(group.id)) {
    console.log(`  already linked to ${GROUP_ID}`);
  } else {
    // POST /v1/bundleIds/{id}/relationships/appGroups → set 에 add
    await asc('POST', `/bundleIds/${bundle.id}/relationships/appGroups`, {
      data: [{ type: 'appGroups', id: group.id }],
    });
    console.log(`  linked to ${GROUP_ID}`);
  }
}

console.log('\n✓ done. 이제 asc-prep-build-multi.mjs 를 다시 돌려서 profile 을 재생성하세요.');
console.log('  (profile 은 capability 를 baking 하기 때문에 capability 변경 후 항상 재발급 필요)');
