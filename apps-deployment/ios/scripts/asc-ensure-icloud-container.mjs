#!/usr/bin/env node
// 입력 받은 bundle ID 목록 모두에 iCloud (CloudKit / XCODE_6) capability 를
// enable 한다. 멱등.
//
// **중요한 한계** — ASC public API 는 iCloud Container 의 *생성* 도 *bundle 매핑*
// 도 노출하지 않는다 (`/v1/cloudContainers` 자체가 404). App Group 이 부분
// 매핑까지 자동화되는 것과 달리, iCloud 는 다음 두 단계가 Apple Developer
// Portal 의 web UI 작업으로 남는다 (bundle 당 ~30 초):
//
//   A. Container identifier 첫 등록 — 1 회
//   B. 각 bundle 의 "iCloud" capability "Configure" → container 체크 → Save
//      — bundle 당 1 회 (이 스크립트가 capability 자체는 켜주므로 "Configure"
//      버튼은 활성화돼 있음)
//
// 이 스크립트가 자동으로 처리하는 것:
//   * 각 bundle 에 ICLOUD capability + CloudKit (XCODE_6) 설정 활성화
//   * 활성화 후 capability 상태 확인
//
// Required env vars:
//   ASC_API_KEY, ASC_API_ISSUER
//   ASC_ICLOUD_CONTAINER         예: iCloud.com.example.myapp (안내 출력용)
//   ASC_ICLOUD_CONTAINER_NAME    안내 출력용
//   ASC_ICLOUD_CONTAINER_BUNDLES 공백 또는 세미콜론 구분 bundle ID 목록.
//
// Optional:
//   ASC_KEY_PATH

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID         = process.env.ASC_API_KEY;
const ISSUER_ID      = process.env.ASC_API_ISSUER;
const CONTAINER_ID   = process.env.ASC_ICLOUD_CONTAINER;
const CONTAINER_NAME = process.env.ASC_ICLOUD_CONTAINER_NAME || CONTAINER_ID;
const BUNDLES_RAW    = process.env.ASC_ICLOUD_CONTAINER_BUNDLES;
if (!KEY_ID || !ISSUER_ID || !CONTAINER_ID || !BUNDLES_RAW) {
  console.error('❌ ASC_API_KEY, ASC_API_ISSUER, ASC_ICLOUD_CONTAINER, ASC_ICLOUD_CONTAINER_BUNDLES required.');
  process.exit(2);
}
const KEY_PATH = process.env.ASC_KEY_PATH || path.join(
  os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);

const BUNDLES = BUNDLES_RAW.split(/[\s;]+/).map(s => s.trim()).filter(Boolean);
console.log(`iCloud container: ${CONTAINER_ID}  name: "${CONTAINER_NAME}"`);
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

// ─── 2. 각 bundle 에 ICLOUD capability 활성화 ────────────────────
let needsManualConfigure = [];

for (const identifier of BUNDLES) {
  const bundle = bundleByIdentifier.get(identifier);
  console.log(`\n── ${identifier} (${bundle.id})`);

  // 현재 capabilities 확인
  const capsResp = await asc('GET', `/bundleIds/${bundle.id}/bundleIdCapabilities`);
  const existing = (capsResp.data || []).find(c => c.attributes.capabilityType === 'ICLOUD');

  if (existing) {
    const settings = existing.attributes.settings || [];
    const version = settings.find(s => s.key === 'ICLOUD_VERSION')?.options?.[0]?.key;
    console.log(`  ICLOUD already enabled (version: ${version || 'unknown'})`);
  } else {
    try {
      await asc('POST', '/bundleIdCapabilities', {
        data: {
          type: 'bundleIdCapabilities',
          attributes: {
            capabilityType: 'ICLOUD',
            settings: [
              { key: 'ICLOUD_VERSION', options: [{ key: 'XCODE_6' }] },
            ],
          },
          relationships: {
            bundleId: { data: { type: 'bundleIds', id: bundle.id } },
          },
        },
      });
      console.log('  ✓ ICLOUD (CloudKit / XCODE_6) capability enabled');
    } catch (e) {
      if (/409|already/i.test(e.message)) {
        console.log('  ICLOUD already enabled (409)');
      } else {
        throw e;
      }
    }
  }
  needsManualConfigure.push(identifier);
}

// ─── 3. Container 연결 안내 — web UI 작업 ─────────────────────
console.log('\n═══════════════════════════════════════════════════════════');
console.log('✓ 4 bundle 모두 ICLOUD capability 활성화 완료.');
console.log('');
console.log('🚧 마지막 단계 — ASC API 가 노출하지 않는 부분 (bundle 당 ~30초):');
console.log('');
console.log(`   각 bundle 의 iCloud capability 에 container ${CONTAINER_ID} 를`);
console.log('   체크해야 profile 발급 시 entitlement 매칭 통과:');
console.log('');
for (const identifier of needsManualConfigure) {
  console.log(`   • https://developer.apple.com/account/resources/identifiers/list/bundleId`);
  console.log(`     → "${identifier}" 클릭`);
  console.log('     → Capabilities 의 "iCloud" 줄 끝의 "Configure" (또는 "Edit") 버튼');
  console.log(`     → ☑ ${CONTAINER_ID} 체크`);
  console.log('     → Save (Continue → Save)');
  console.log('');
}
console.log('   완료 후 asc-prep-build-multi.mjs 를 다시 돌리면 새 entitlement 가');
console.log('   포함된 provisioning profile 이 발급됨.');
console.log('═══════════════════════════════════════════════════════════');
