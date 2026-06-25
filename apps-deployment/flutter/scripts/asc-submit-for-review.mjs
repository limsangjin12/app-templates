#!/usr/bin/env node
// Submits the editable iOS appStoreVersion for App Store review.
// Polls the named build until it reaches processingState=VALID, attaches
// it to the current editable version, then creates + submits a
// reviewSubmission.
//
// Required env vars:
//   ASC_API_KEY      e.g. <KEY_ID>
//   ASC_API_ISSUER   UUID
//   ASC_BUNDLE_ID    com.example.myapp
//
// Required argument:
//   --build=<N>      build number (matches CFBundleVersion)
//
// Optional:
//   ASC_KEY_PATH                       .p8 path
//   --whatsnew="..."                   누락된 locale 의 whatsNew 를 이 텍스트로 채움
//                                       (모든 locale 동일). 줄바꿈은 \n.
//   --copy-whatsnew-from-previous      누락된 locale 의 whatsNew 를 직전 출시
//                                       버전에서 자동 복사. 두 옵션 모두 없으면
//                                       누락 시 즉시 종료.
//
// Run:
//   ASC_API_KEY=... ASC_API_ISSUER=... ASC_BUNDLE_ID=... \
//     node /path/to/apps-deployment/flutter/scripts/asc-submit-for-review.mjs --build=20
//   # whatsNew 누락 위험 있는 신규 버전:
//     ... asc-submit-for-review.mjs --build=20 --whatsnew="• Bug fixes"

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
const PLATFORM = (process.env.ASC_PLATFORM || 'IOS').toUpperCase();
const PLATFORM_FILTER = PLATFORM === 'MACOS' ? 'MAC_OS' : PLATFORM;
const KEY_PATH = process.env.ASC_KEY_PATH || path.join(
  os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);

const args = Object.fromEntries(process.argv.slice(2)
  .map(a => {
    if (!a.startsWith('--')) return [a, true];
    const body = a.slice(2);
    const eq = body.indexOf('=');
    return eq === -1 ? [body, true] : [body.slice(0, eq), body.slice(eq + 1)];
  }));
const TARGET_BUILD = String(args.build ?? '').trim();
if (!TARGET_BUILD) {
  console.error('Usage: --build=<N>');
  process.exit(2);
}
const FORCE_WHATSNEW = args.whatsnew ? String(args.whatsnew) : null;
const COPY_WHATSNEW = Boolean(args['copy-whatsnew-from-previous']);

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

async function findBuild(appId, marketingVersion) {
  const q = new URLSearchParams({
    'filter[app]': appId,
    'filter[version]': TARGET_BUILD,
    'filter[preReleaseVersion.platform]': PLATFORM_FILTER,
    'sort': '-uploadedDate',
    'include': 'preReleaseVersion',
    'limit': '20',
  });
  const resp = await asc('GET', `/builds?${q.toString()}`);
  const preReleaseVersions = Object.fromEntries(
    (resp.included ?? []).map((item) => [item.id, item]));
  return resp.data.find((build) => {
    const preReleaseId = build.relationships?.preReleaseVersion?.data?.id;
    const preRelease = preReleaseVersions[preReleaseId];
    return preRelease?.attributes?.version === marketingVersion;
  });
}

async function waitForBuild(appId, marketingVersion) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const build = await findBuild(appId, marketingVersion);
    if (build) {
      const state = build.attributes.processingState;
      console.log(`  Build ${marketingVersion} (${TARGET_BUILD}): id=${build.id}, state=${state}`);
      if (state === 'VALID') return build;
      if (state === 'FAILED' || state === 'INVALID') {
        throw new Error(`Build processing ${state}`);
      }
    } else {
      console.log(`  Build ${marketingVersion} (${TARGET_BUILD}) not visible yet…`);
    }
    console.log('  sleeping 60s before next poll…');
    await sleep(60_000);
  }
  throw new Error('Timed out waiting for build to process (40 minutes)');
}

async function attachBuild(versionId, buildId) {
  await asc('PATCH', `/appStoreVersions/${versionId}`, {
    data: {
      type: 'appStoreVersions',
      id: versionId,
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    },
  });
}

/**
 * 모든 locale 의 whatsNew 누락 점검 + 자동 채움.
 *
 * ASC 는 신규 (post-first-release) 버전을 review 큐에 넣을 때 모든 active
 * appStoreVersionLocalizations 의 whatsNew 가 채워져 있길 요구한다. 하나라도
 * 비면 reviewSubmissionItems POST 가 409 STATE_ERROR 로 떨어진다 (각 locale
 * 별 ENTITY_ERROR.ATTRIBUTE.REQUIRED 가 associatedErrors 에 줄줄이).
 *
 * 메타데이터 sync 스크립트(asc-set-metadata.mjs) 가 whatsNew 를 안 다루므로
 * 새 버전을 만들 때마다 매번 함정. 여기서 사전 점검:
 *   - `--whatsnew="..."` 인자 → 누락 locale 에 그 텍스트 PATCH (모든 locale 동일)
 *   - `--copy-whatsnew-from-previous` → 직전 출시 버전 같은 locale 에서 copy
 *   - 둘 다 없고 누락이면 → 명확한 에러로 종료 (실수로 빈 채로 제출 방지)
 */
async function ensureWhatsNew(appId, version) {
  const locsResp = await asc('GET',
    `/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`);
  const missing = locsResp.data.filter(l =>
    !l.attributes.whatsNew || l.attributes.whatsNew.trim() === '');
  if (missing.length === 0) return;

  const allVersionsResp = await asc('GET',
    `/apps/${appId}/appStoreVersions?filter[platform]=${PLATFORM_FILTER}&limit=50`);
  const previousVersions = allVersionsResp.data
    .filter(v => v.id !== version.id)
    .sort((a, b) => new Date(b.attributes.createdDate) - new Date(a.attributes.createdDate));
  if (previousVersions.length === 0) {
    console.log('  first app version; whatsNew is not editable or required.');
    return;
  }

  const locales = missing.map(l => l.attributes.locale).join(', ');
  console.log(`  ⚠ whatsNew 누락: ${locales}`);

  let prevByLocale = null;
  if (COPY_WHATSNEW) {
    const prev = previousVersions[0];
    console.log(`  copying from previous v=${prev.attributes.versionString}`);
    const prevLocs = await asc('GET',
      `/appStoreVersions/${prev.id}/appStoreVersionLocalizations?limit=50`);
    prevByLocale = Object.fromEntries(
      prevLocs.data.map(l => [l.attributes.locale, l.attributes.whatsNew]));
  } else if (!FORCE_WHATSNEW) {
    throw new Error(
      `whatsNew 가 ${missing.length} 개 locale 에 비어 있음 (${locales}).\n` +
      '   --whatsnew="..." 또는 --copy-whatsnew-from-previous 추가하거나\n' +
      '   asc-copy-whatsnew.mjs 로 먼저 채우세요.');
  }

  for (const loc of missing) {
    const text = FORCE_WHATSNEW ?? prevByLocale?.[loc.attributes.locale];
    if (!text) {
      throw new Error(`locale ${loc.attributes.locale} 에 채울 whatsNew 가 없음`);
    }
    await asc('PATCH', `/appStoreVersionLocalizations/${loc.id}`, {
      data: {
        type: 'appStoreVersionLocalizations',
        id: loc.id,
        attributes: { whatsNew: text },
      },
    });
    console.log(`  ↑ ${loc.attributes.locale} (${text.length} chars)`);
  }
}

async function findOpenSubmission(appId) {
  const q = new URLSearchParams({
    'filter[app]': appId,
    'filter[platform]': PLATFORM_FILTER,
    'filter[state]': 'READY_FOR_REVIEW',
    'limit': '5',
  });
  const resp = await asc('GET', `/reviewSubmissions?${q.toString()}`);
  return resp.data[0];
}

async function main() {
  console.log('→ Locating app…');
  const apps = await asc('GET',
    `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
  const app = apps.data[0];
  if (!app) throw new Error(`No app for bundleId=${BUNDLE_ID}`);
  console.log(`  App: ${app.attributes.name} (${app.id})`);

  console.log(`→ Fetching editable ${PLATFORM_FILTER} appStoreVersion…`);
  const versions = await asc('GET',
    `/apps/${app.id}/appStoreVersions?filter[platform]=${PLATFORM_FILTER}&filter[appStoreState]=PREPARE_FOR_SUBMISSION,READY_FOR_REVIEW,WAITING_FOR_REVIEW,METADATA_REJECTED,DEVELOPER_REJECTED,REJECTED,INVALID_BINARY&limit=5`);
  const version = versions.data[0];
  if (!version) throw new Error('No editable appStoreVersion');
  console.log(`  Version ${version.attributes.versionString}  state=${version.attributes.appStoreState}`);

  console.log(`→ Waiting for build ${version.attributes.versionString} (${TARGET_BUILD}) to finish processing…`);
  const build = await waitForBuild(app.id, version.attributes.versionString);

  console.log(`→ Attaching build ${build.id} to version…`);
  await attachBuild(version.id, build.id);

  console.log('→ Verifying whatsNew on all locales…');
  await ensureWhatsNew(app.id, version);

  console.log('→ Creating / locating reviewSubmission…');
  let submission = await findOpenSubmission(app.id);
  if (submission) {
    console.log(`  Reusing open submission ${submission.id} (${submission.attributes.state})`);
  } else {
    const resp = await asc('POST', '/reviewSubmissions', {
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: PLATFORM_FILTER },
        relationships: { app: { data: { type: 'apps', id: app.id } } },
      },
    });
    submission = resp.data;
    console.log(`  Created ${submission.id} (${submission.attributes.state})`);
  }

  console.log('→ Checking existing submission items…');
  const itemsResp = await asc('GET',
    `/reviewSubmissions/${submission.id}/items`);
  const alreadyIncluded = (itemsResp.data ?? []).some((it) =>
    it.relationships?.appStoreVersion?.data?.id === version.id);
  if (alreadyIncluded) {
    console.log('  appStoreVersion already included.');
  } else {
    console.log('  Adding appStoreVersion to submission…');
    await asc('POST', '/reviewSubmissionItems', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: {
            data: { type: 'reviewSubmissions', id: submission.id },
          },
          appStoreVersion: {
            data: { type: 'appStoreVersions', id: version.id },
          },
        },
      },
    });
  }

  console.log('→ Submitting for review…');
  await asc('PATCH', `/reviewSubmissions/${submission.id}`, {
    data: {
      type: 'reviewSubmissions',
      id: submission.id,
      attributes: { submitted: true },
    },
  });

  console.log(`\n✅ Submitted for review. submission=${submission.id}`);
  console.log('   Watch status in App Store Connect → My Apps → TestFlight / App Store tab.');
}

main().catch((err) => {
  console.error('\n❌', err.message);
  process.exit(1);
});
