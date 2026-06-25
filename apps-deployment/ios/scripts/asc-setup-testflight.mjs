#!/usr/bin/env node
// Sets up an auto-distribution TestFlight beta group + primary tester for
// the app, sends tester invitations, then links the most recent build (if it's
// processed). Re-run after each upload to push new builds to the group
// automatically.
//
// Required env vars:
//   ASC_API_KEY        e.g. <KEY_ID>
//   ASC_API_ISSUER     UUID
//   ASC_BUNDLE_ID      com.example.myapp
//   ASC_BETA_GROUP     beta group name (created if missing)
//
// 테스터 지정 — 다음 중 하나:
//   ASC_BETA_TESTERS   세미콜론(;) 구분 'email[:First[:Last]]' 목록.
//                      예: 'a@x.com:Sangjin:Lim;b@x.com:Yulhee:Lim'
//                      name 비우면 ASC_TESTER_FIRSTNAME / LASTNAME default 사용.
//   ASC_BETA_TESTER    (단일, 구버전 호환) 1 명 이메일만.
//                      ASC_BETA_TESTERS 가 있으면 무시됨.
//
// 그룹 종류별 처리:
//   - **External 그룹** (isInternalGroup=false): 각 email 을 betaTester 로
//     생성/조회 → 그룹에 add. 첫 빌드는 Beta App Review 필요.
//   - **Internal 그룹** (isInternalGroup=true): ASC users 만 멤버 가능. ASC
//     API 가 internal group 에 명시 add 를 제공 안 함. 대신:
//       1. 각 email 의 ASC user 존재 확인 (없으면 안내 후 skip)
//       2. user.allAppsVisible=true 면 통과
//       3. 아니면 user 의 visibleApps 에 현재 앱 추가
//     이로써 user 가 internal tester 로서 자동 build 접근 권한 획득.
//
// Optional:
//   ASC_KEY_PATH                .p8 path
//   ASC_TESTER_FIRSTNAME        new-tester first name (default: "Tester")
//   ASC_TESTER_LASTNAME         new-tester last name (default: "Primary")
//
// Run:
//   node /path/to/apps-deployment/ios/scripts/asc-setup-testflight.mjs
//   node /path/to/apps-deployment/ios/scripts/asc-setup-testflight.mjs --watch
//   node /path/to/apps-deployment/ios/scripts/asc-setup-testflight.mjs --build=42 --watch

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID    = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
const GROUP_NAME    = process.env.ASC_BETA_GROUP;
const TESTERS_RAW   = process.env.ASC_BETA_TESTERS || process.env.ASC_BETA_TESTER || '';
if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID || !GROUP_NAME || !TESTERS_RAW) {
  console.error(
    '❌ ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID, ASC_BETA_GROUP, ' +
    'ASC_BETA_TESTERS (또는 ASC_BETA_TESTER) env vars required.');
  process.exit(2);
}
const KEY_PATH = process.env.ASC_KEY_PATH || path.join(
  os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);
const DEFAULT_FIRST = process.env.ASC_TESTER_FIRSTNAME || 'Tester';
const DEFAULT_LAST  = process.env.ASC_TESTER_LASTNAME  || 'Primary';

// internal vs external — 기본 internal (Beta App Review 불필요, ASC user
// + visibleApps 만으로 즉시 access). external 으로 바꾸려면
// `ASC_BETA_INTERNAL=false`.
const WANT_INTERNAL = (process.env.ASC_BETA_INTERNAL || 'true').toLowerCase() !== 'false';

// 'a@x.com:First:Last;b@y.com::' → [{email,firstName,lastName}, ...]
// (구버전 단일 ASC_BETA_TESTER 도 같은 파서로 정상 처리됨 — 1 entry, no name)
const TESTERS = TESTERS_RAW.split(';').map(s => s.trim()).filter(Boolean).map(s => {
  const [email, first, last] = s.split(':').map(p => (p ?? '').trim());
  if (!email) throw new Error(`malformed tester entry: ${s}`);
  return {
    email,
    firstName: first || DEFAULT_FIRST,
    lastName:  last  || DEFAULT_LAST,
  };
});

const API = 'https://api.appstoreconnect.apple.com/v1';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  if (!a.startsWith('--')) return [a, true];
  const body = a.slice(2);
  const eq = body.indexOf('=');
  return eq === -1 ? [body, true] : [body.slice(0, eq), body.slice(eq + 1)];
}));
const WATCH = Boolean(args.watch);
const TARGET_BUILD = args.build ? String(args.build).trim() : '';
const PLATFORM = (process.env.ASC_PLATFORM || 'IOS').toUpperCase();
const PLATFORM_FILTER = PLATFORM === 'MACOS' ? 'MAC_OS' : PLATFORM;

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
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${pathname} → ${res.status}: ${await res.text()}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function ensureGroup(appId) {
  const list = await asc('GET', `/apps/${appId}/betaGroups?limit=200`);
  const group = list.data.find(g => g.attributes.name === GROUP_NAME);
  if (group) {
    console.log(`  ✔ group "${GROUP_NAME}" exists (id=${group.id}, internal=${group.attributes.isInternalGroup})`);
    if (group.attributes.isInternalGroup !== WANT_INTERNAL) {
      console.log(`  ⚠ 그룹은 ${group.attributes.isInternalGroup ? 'internal' : 'external'} 인데 ASC_BETA_INTERNAL=${WANT_INTERNAL} 와 다름. 그대로 사용 (변경하려면 그룹 삭제 후 재실행).`);
    }
    return group;
  }
  console.log(`  + creating ${WANT_INTERNAL ? 'INTERNAL' : 'EXTERNAL'} beta group "${GROUP_NAME}"…`);
  const attrs = {
    name: GROUP_NAME,
    isInternalGroup: WANT_INTERNAL,
  };
  if (WANT_INTERNAL) {
    attrs.hasAccessToAllBuilds = true;
  } else {
    attrs.publicLinkEnabled = false;
  }
  const created = await asc('POST', '/betaGroups', {
    data: {
      type: 'betaGroups',
      attributes: attrs,
      relationships: { app: { data: { type: 'apps', id: appId } } },
    },
  });
  return created.data;
}

async function ensureBuildLinked(group, build) {
  if (group.attributes.isInternalGroup) {
    console.log(`  ✔ internal group "${group.attributes.name}" uses app access; direct build assignment is not required`);
    return true;
  }
  try {
    await asc('POST', `/betaGroups/${group.id}/relationships/builds`, {
      data: [{ type: 'builds', id: build.id }],
    });
    console.log(`  ✔ linked build ${build.attributes.version} to group "${group.attributes.name}"`);
    return true;
  } catch (err) {
    if (err.message.includes('ALREADY_EXISTS') ||
        err.message.includes('already exists') ||
        err.message.includes('→ 409')) {
      console.log(`  ✔ build ${build.attributes.version} already linked to group "${group.attributes.name}"`);
      return true;
    }
    if (err.message.includes('BUILD_NOT_VALID') ||
        err.message.includes('processingState')) {
      console.log('  ⏳ build still processing, cannot link yet');
      return false;
    }
    throw err;
  }
}

// betaTester 를 그룹 (internal / external 무관) 에 add.
//
// 핵심 — ASC API 의 betaTester record 는 **앱 단위로 scope** 됨. 같은 email 도
// 앱마다 별도 id. 글로벌 `filter[email]=` 검색은 다른 앱의 betaTester id 를
// 반환할 수 있는데 그걸 다른 앱 그룹에 attach 시도하면 STATE_ERROR 로 거부됨
// ("Tester(s) cannot be assigned"). 따라서 `filter[apps]=<appId>` 로 같은 앱
// 컨텍스트에서만 찾는다.
//
// internal / external 그룹 모두 같은 betaTester relationship 으로 add 가능.
// Internal 그룹: state=INVITED (Beta App Review 불필요, 즉시).
// External 그룹: state=NOT_INVITED → Beta App Review 통과 후 INVITED.
async function ensureTester(appId, groupId, t) {
  const existing = await asc('GET',
    `/betaTesters?filter[email]=${encodeURIComponent(t.email)}` +
    `&filter[apps]=${appId}&limit=5`);
  if (existing.data.length) {
    const tester = existing.data[0];
    console.log(`  ✔ tester ${t.email} exists in app (id=${tester.id})`);
    try {
      await asc('POST', `/betaTesters/${tester.id}/relationships/betaGroups`, {
        data: [{ type: 'betaGroups', id: groupId }],
      });
      console.log('    ↳ added to group');
    } catch (err) {
      if (err.message.includes('ALREADY_EXISTS') ||
          err.message.includes('→ 409')) {
        console.log('    ↳ already in group');
      } else {
        console.log('    ↳', err.message.split('\n')[0]);
      }
    }
    return tester;
  }
  // 앱 컨텍스트에 없으면 — POST /betaTesters 가 새 record 를 만든다 (다른 앱에서
  // 같은 email 로 등록돼 있어도 별개).
  console.log(`  + inviting tester ${t.email} (${t.firstName} ${t.lastName})…`);
  const created = await asc('POST', '/betaTesters', {
    data: {
      type: 'betaTesters',
      attributes: {
        email: t.email,
        firstName: t.firstName,
        lastName: t.lastName,
      },
      relationships: {
        betaGroups: { data: [{ type: 'betaGroups', id: groupId }] },
      },
    },
  });
  return created.data;
}

async function sendTesterInvitation(appId, tester) {
  try {
    const invitation = await asc('POST', '/betaTesterInvitations', {
      data: {
        type: 'betaTesterInvitations',
        relationships: {
          app: { data: { type: 'apps', id: appId } },
          betaTester: { data: { type: 'betaTesters', id: tester.id } },
        },
      },
    });
    console.log(`  ✉ invitation sent to ${tester.attributes.email} (id=${invitation.data.id})`);
  } catch (err) {
    if (err.message.includes('ALREADY_EXISTS') ||
        err.message.includes('already') ||
        err.message.includes('→ 409')) {
      console.log(`  ✔ invitation already active for ${tester.attributes.email}`);
      return;
    }
    throw err;
  }
}

async function fetchLatestBuild(appId) {
  const resp = await asc('GET',
    `/builds?filter[app]=${appId}&sort=-uploadedDate&limit=5`);
  return resp.data[0] || null;
}

async function fetchTargetBuild(appId) {
  const q = new URLSearchParams({
    'filter[app]': appId,
    'filter[version]': TARGET_BUILD,
    'filter[preReleaseVersion.platform]': PLATFORM_FILTER,
    'sort': '-uploadedDate',
    'limit': '5',
  });
  const resp = await asc('GET', `/builds?${q.toString()}`);
  return resp.data[0] || null;
}

async function fetchBuild(appId) {
  return TARGET_BUILD ? fetchTargetBuild(appId) : fetchLatestBuild(appId);
}

async function describeBuild(build) {
  const detail = await asc('GET', `/builds/${build.id}/buildBetaDetail`);
  return {
    version: build.attributes.version,
    processingState: build.attributes.processingState,
    internalBuildState: detail?.data?.attributes?.internalBuildState,
    externalBuildState: detail?.data?.attributes?.externalBuildState,
  };
}

async function main() {
  console.log('→ Locating app by bundle ID…');
  const apps = await asc('GET',
    `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
  if (!apps.data.length) throw new Error(`No app for bundleId=${BUNDLE_ID}`);
  const app = apps.data[0];
  console.log(`  App: ${app.attributes.name}  (id=${app.id})`);

  console.log('→ Ensuring beta group…');
  const group = await ensureGroup(app.id);
  const isInternal = group.attributes.isInternalGroup === true;

  console.log(`→ Ensuring ${TESTERS.length} tester(s) (group type: ${isInternal ? 'INTERNAL' : 'EXTERNAL'})…`);
  const ensuredTesters = [];
  for (const t of TESTERS) {
    ensuredTesters.push(await ensureTester(app.id, group.id, t));
  }

  console.log('→ Sending TestFlight invitation(s)…');
  for (const tester of ensuredTesters) {
    await sendTesterInvitation(app.id, tester);
  }

  console.log(TARGET_BUILD ? `→ Checking build ${TARGET_BUILD}…` : '→ Checking most recent build…');
  let build = await fetchBuild(app.id);
  if (!build) {
    if (!WATCH) {
      const label = TARGET_BUILD ? `build ${TARGET_BUILD}` : 'build';
      console.log(`  (no ${label} found yet — upload first, or re-run with --watch)`);
      return;
    }
    const label = TARGET_BUILD ? `build ${TARGET_BUILD}` : 'a build';
    console.log(`  ${label} not visible yet.`);
    console.log('\n🔁 Watching until visible (30s interval)…');
    while (!build) {
      await sleep(30_000);
      build = await fetchBuild(app.id);
      const ts = new Date().toISOString().slice(11, 19);
      console.log(`  [${ts}] ${build ? `found build ${build.attributes.version}` : 'not visible yet'}`);
    }
  }
  let info = await describeBuild(build);
  console.log(`  Build ${info.version}: processing=${info.processingState}, internal=${info.internalBuildState}, external=${info.externalBuildState}`);

  if (info.processingState === 'VALID') {
    if (isInternal && info.internalBuildState === 'IN_BETA_TESTING') {
      console.log(`  ✔ internal build ${build.attributes.version} already available to group "${group.attributes.name}"`);
    } else {
      await ensureBuildLinked(group, build);
    }
  } else if (WATCH) {
    console.log('\n🔁 Watching until processed (30s interval)…');
    while (info.processingState !== 'VALID' && info.processingState !== 'FAILED') {
      await sleep(30_000);
      info = await describeBuild(build);
      const ts = new Date().toISOString().slice(11, 19);
      console.log(`  [${ts}] processing=${info.processingState}, internal=${info.internalBuildState}, external=${info.externalBuildState}`);
    }
    if (info.processingState === 'VALID') {
      if (isInternal && info.internalBuildState === 'IN_BETA_TESTING') {
        console.log(`  ✔ internal build ${build.attributes.version} already available to group "${group.attributes.name}"`);
      } else {
        await ensureBuildLinked(group, build);
      }
    } else {
      console.log(`\n❌ Build processing ${info.processingState}. Check App Store Connect.`);
    }
  } else {
    console.log('  ℹ  Build still processing — rerun later (or with --watch) to link it.');
  }

  console.log('\n✅ TestFlight group + tester(s) ready.');
  console.log(`   Group: "${GROUP_NAME}"  (id=${group.id})`);
  console.log(`   Testers: ${TESTERS.map(t => t.email).join(', ')}`);
}

main().catch(err => {
  console.error('\n❌', err.message);
  process.exit(1);
});
