#!/usr/bin/env node
// 빌드를 TestFlight Internal Testing 그룹에 등록한다.
//
// 환경변수 (shared.config.sh + 앱별 deploy.config.sh):
//   ASC_API_KEY / ASC_API_ISSUER / ASC_BUNDLE_ID 필수
//   ASC_PLATFORM       기본 IOS (MAC_OS / TV_OS / VISION_OS)
//   ASC_BETA_GROUP     기본 "Test"
//   ASC_BETA_TESTERS   semicolon-separated email:First:Last (internal user 의
//                      ASC team email 이어야 함). 비우면 그룹만 생성.
//
// 인자:
//   --build=<N>        빌드 번호 (CFBundleVersion). 누락 시 group 만 생성.
//
// Internal 그룹은 Beta App Review 불필요 — build VALID 즉시 invited 됨.

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
const GROUP_NAME = process.env.ASC_BETA_GROUP || 'Test';
const TESTERS_RAW = process.env.ASC_BETA_TESTERS || '';
const TESTERS = TESTERS_RAW.split(';').map(s => s.trim()).filter(Boolean).map(s => {
  const [email, first, last] = s.split(':');
  return { email, first, last };
});

const args = Object.fromEntries(process.argv.slice(2)
  .map(a => a.startsWith('--') ? a.slice(2).split('=') : [a, true]));
const TARGET_BUILD = String(args.build ?? '').trim() || null;

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
    throw new Error(`${method} ${pathname} → ${res.status}: ${await res.text()}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── 1) App lookup ────────────────────────────────────────────────────
console.log(`→ Looking up app ${BUNDLE_ID}…`);
const apps = await asc('GET',
  `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
const app = apps.data[0];
if (!app) throw new Error(`No app for bundleId=${BUNDLE_ID}`);
console.log(`  App: ${app.attributes.name} (${app.id})`);

// ── 2) Group lookup / create ─────────────────────────────────────────
console.log(`\n→ Looking for internal group "${GROUP_NAME}"…`);
const groupsResp = await asc('GET',
  `/betaGroups?filter[app]=${app.id}&limit=200`);
let group = groupsResp.data.find(g =>
  g.attributes.name === GROUP_NAME && g.attributes.isInternalGroup);
if (group) {
  console.log(`  Reusing ${group.id}`);
} else {
  console.log('  Creating new internal group…');
  const r = await asc('POST', '/betaGroups', {
    data: {
      type: 'betaGroups',
      attributes: { name: GROUP_NAME, isInternalGroup: true },
      relationships: { app: { data: { type: 'apps', id: app.id } } },
    },
  });
  group = r.data;
  console.log(`  Created ${group.id}`);
}

// ── 3) Add internal testers via /betaTesters resource ───────────────
// betaTester 는 앱마다 별도 record (같은 email 도 앱마다 다른 id).
// 따라서 다른 앱의 tester 를 재활용 불가 — 이 그룹용으로 새로 만들어야 함.
if (TESTERS.length > 0) {
  console.log(`\n→ Adding ${TESTERS.length} internal tester(s)…`);
  const existingResp = await asc('GET',
    `/betaGroups/${group.id}/betaTesters?limit=200`);
  const existingEmails = new Set(
    existingResp.data.map(x => (x.attributes.email || '').toLowerCase()));

  for (const t of TESTERS) {
    if (existingEmails.has(t.email.toLowerCase())) {
      console.log(`  · ${t.email} — already in group, skip`);
      continue;
    }
    console.log(`  + ${t.email} — creating betaTester for this group…`);
    try {
      const r = await asc('POST', '/betaTesters', {
        data: {
          type: 'betaTesters',
          attributes: {
            email: t.email,
            firstName: t.first || '',
            lastName: t.last || '',
          },
          relationships: {
            betaGroups: { data: [{ type: 'betaGroups', id: group.id }] },
          },
        },
      });
      console.log(`    → ${r.data.id}`);
    } catch (err) {
      console.warn(`    ⚠ create 실패 — ${err.message.split('\n')[0]}`);
    }
  }
}

// ── 4) Build attach ──────────────────────────────────────────────────
if (TARGET_BUILD) {
  console.log(`\n→ Attaching build ${TARGET_BUILD} to group…`);
  // build 찾기
  const q = new URLSearchParams({
    'filter[app]': app.id,
    'filter[version]': TARGET_BUILD,
    'filter[preReleaseVersion.platform]': PLATFORM_FILTER,
    'sort': '-uploadedDate',
    'limit': '5',
  });
  const buildsResp = await asc('GET', `/builds?${q.toString()}`);
  const build = buildsResp.data[0];
  if (!build) {
    throw new Error(`Build ${TARGET_BUILD} not found for ${PLATFORM_FILTER}`);
  }
  console.log(`  Build ${TARGET_BUILD}: id=${build.id}, state=${build.attributes.processingState}`);

  console.log('  ✓ Internal group uses app access; direct build assignment is not required');
}

console.log('\n✅ TestFlight internal testing 설정 완료.');
console.log(`   ASC: https://appstoreconnect.apple.com/apps/${app.id}/testflight/groups/${group.id}`);
