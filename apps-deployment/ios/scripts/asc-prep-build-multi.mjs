#!/usr/bin/env node
// 멀티 타겟 (앱 + 익스텐션 + 워치 + 워치 익스텐션) 용 ASC 부트스트랩.
//
// 단일 Distribution 인증서를 새로 발급한 뒤, 입력된 (bundleId → profileName)
// 각 페어에 대해 IOS_APP_STORE 프로비저닝 프로파일을 만들고
// `~/Library/MobileDevice/Provisioning Profiles/` 에 설치한다.
//
// `apps-deployment/flutter/scripts/asc-prep-build.mjs` 의 native-iOS 다중 타겟
// 버전. 단일 bundle 인 Flutter 앱과 달리 minifocus / mincal 처럼 4 개 타겟이
// 모두 같은 인증서 + 각자의 프로파일을 필요로 하는 경우용.
//
// Required env vars (shared.config.sh 가 채워줌):
//   ASC_API_KEY, ASC_API_ISSUER, ASC_TEAM_ID, ASC_TEAM_OWNER
//   ASC_APP_NAME           앱 이름 — 인증서 displayName 에 사용 ("<App Name> Distribution CLI")
//   ASC_BUNDLE_PROFILES    세미콜론 구분 'bundleId=ProfileName' 페어
//                          예: 'com.example.myapp=MiniFocus App Store CLI;com.example.myapp.widgets=MiniFocus Widgets App Store CLI'
//
// Optional:
//   ASC_KEY_PATH           .p8 path (default ~/.appstoreconnect/private_keys/AuthKey_<KEY>.p8)
//   ASC_PROFILE_TYPE       기본 IOS_APP_STORE. 별도 변경 거의 없음.
//
// 멱등 — 같은 이름의 cert / profile 이 있으면 먼저 삭제하고 다시 만든다.
//
// 출력 마지막에 ExportOptions.plist 의 provisioningProfiles dict 에 그대로
// 복붙할 수 있는 XML 조각이 표시됨.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import jwt from 'jsonwebtoken';

const KEY_ID    = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const TEAM_ID   = process.env.ASC_TEAM_ID;
const APP_NAME  = process.env.ASC_APP_NAME;
const PAIRS_RAW = process.env.ASC_BUNDLE_PROFILES;
if (!KEY_ID || !ISSUER_ID || !TEAM_ID || !APP_NAME || !PAIRS_RAW) {
  console.error(
    '❌ ASC_API_KEY, ASC_API_ISSUER, ASC_TEAM_ID, ASC_APP_NAME, ' +
    'ASC_BUNDLE_PROFILES env vars required.');
  process.exit(2);
}

const PROFILE_TYPE = process.env.ASC_PROFILE_TYPE || 'IOS_APP_STORE';
const KEY_PATH = process.env.ASC_KEY_PATH || path.join(
  os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);
const TEAM_OWNER = process.env.ASC_TEAM_OWNER || 'Lim Sangjin';

const CERT_NAME = `${APP_NAME} Distribution CLI`;

// 'a=foo;b=bar' → [{bundleId:'a', profileName:'foo'}, ...]
const PAIRS = PAIRS_RAW.split(';').map(s => s.trim()).filter(Boolean).map(s => {
  const eq = s.indexOf('=');
  if (eq < 0) throw new Error(`malformed pair (need bundleId=ProfileName): ${s}`);
  return { bundleId: s.slice(0, eq).trim(), profileName: s.slice(eq + 1).trim() };
});

console.log(`bundle/profile pairs (${PAIRS.length}):`);
for (const p of PAIRS) console.log(`  ${p.bundleId} → "${p.profileName}"`);

const API = 'https://api.appstoreconnect.apple.com/v1';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-prep-multi-'));

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

// ─── 1. bundle 매핑 ─────────────────────────────────────────────
const bundlesResp = await asc('GET', '/bundleIds?limit=200');
const bundleByIdentifier = new Map(
  bundlesResp.data.map(b => [b.attributes.identifier, b]));

const missing = PAIRS.filter(p => !bundleByIdentifier.has(p.bundleId));
if (missing.length) {
  console.error('❌ 다음 Bundle ID 가 ASC 에 등록돼 있지 않음:');
  for (const m of missing) console.error(`  ${m.bundleId}`);
  console.error('Apple Developer Portal 에서 먼저 등록 (또는 ASC API 로 생성).');
  process.exit(3);
}

// ─── 2. 기존 같은 이름 profile 정리 (멱등) ──────────────────────
const wantedProfileNames = new Set(PAIRS.map(p => p.profileName));
const allProfiles = await asc('GET', '/profiles?include=bundleId&limit=200');
for (const p of allProfiles.data) {
  if (wantedProfileNames.has(p.attributes.name)) {
    console.log(`deleting old profile: ${p.attributes.name} (${p.id})`);
    await asc('DELETE', `/profiles/${p.id}`);
  }
}

// ─── 3. cert: 가능하면 재사용, 아니면 새로 발급 ────────────────
// Apple Distribution cert 는 팀당 한도 (2-3 개) 가 있어서 매번 새로 만들면
// 금방 한계에 도달한다. 다음 우선순위로 cert 를 결정:
//
//   a) ASC 의 valid DISTRIBUTION cert 중에서, 로컬 keychain 에 매칭 private
//      key 가 있고 만료일이 가장 늦은 것 → 그대로 재사용
//   b) (a) 가 없으면 새 CSR + 새 cert 발급 + 로컬 import

// ASC API 는 cert serial 의 leading zero 를 strip 해서 반환 (예: "0B43..."
// → "B43..."). OpenSSL `x509 -serial` 은 full hex 출력. BigInt 로 변환해
// 자릿수 무시하고 수치 비교.
function serialToBigInt(hex) {
  const clean = hex.replace(/^serial=/i, '').replace(/^0x/i, '').trim();
  return BigInt('0x' + clean);
}

function localKeychainHasSerial(serialHex) {
  try {
    const out = execSync(
      `security find-certificate -a -c 'Apple Distribution' -p ${os.homedir()}/Library/Keychains/login.keychain-db`,
      { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const target = serialToBigInt(serialHex);
    const certs = out.split(/(?=-----BEGIN CERTIFICATE-----)/).filter(Boolean);
    for (const pem of certs) {
      const tmp = path.join(TMP, `kc-${Math.random().toString(36).slice(2)}.pem`);
      fs.writeFileSync(tmp, pem);
      try {
        const ser = execSync(
          `openssl x509 -in ${tmp} -noout -serial`,
          { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        if (serialToBigInt(ser) === target) return true;
      } catch {/* skip this PEM */}
    }
  } catch {/* keychain access 실패 */}
  return false;
}

const allCerts = await asc('GET', '/certificates?limit=200');
const distCerts = allCerts.data
  .filter(c => c.attributes.certificateType === 'DISTRIBUTION')
  .filter(c => new Date(c.attributes.expirationDate) > new Date())
  .map(c => ({
    id: c.id,
    serial: c.attributes.serialNumber,
    expirationDate: c.attributes.expirationDate,
    displayName: c.attributes.displayName,
  }))
  .sort((a, b) => new Date(b.expirationDate) - new Date(a.expirationDate));

// Profile 에 attach 할 cert 들. 로컬 keychain 에 있는 모든 valid dist cert 를
// 다 포함시켜서 — Xcode 가 어떤 identity 를 골라도 매치되도록.
const reusableCerts = distCerts.filter(c => localKeychainHasSerial(c.serial));
let certs = reusableCerts.map(c => ({ id: c.id }));

if (reusableCerts.length > 0) {
  console.log(`reusing ${reusableCerts.length} existing DISTRIBUTION cert(s) (keychain-matched):`);
  for (const c of reusableCerts) {
    console.log(`  ${c.id}  serial: ${c.serial}  expires: ${c.expirationDate}`);
  }
}

let cert = certs[0];  // 호환성용 (legacy 코드 경로 — 새 cert 만들 때 사용)

if (!cert) {
  console.log(`no reusable cert found among ${distCerts.length} valid DISTRIBUTION certs — creating new…`);
  const KEY_PEM = path.join(TMP, 'dist.key.pem');
  const CSR_PEM = path.join(TMP, 'dist.csr.pem');
  execSync(`openssl genrsa -out ${KEY_PEM} 2048`, { stdio: 'pipe' });
  execSync(
    `openssl req -new -key ${KEY_PEM} -out ${CSR_PEM} ` +
    `-subj "/CN=${CERT_NAME}/O=${TEAM_OWNER}/C=US"`,
    { stdio: 'pipe' });
  const csrContent = fs.readFileSync(CSR_PEM, 'utf8')
    .replace(/-----BEGIN CERTIFICATE REQUEST-----/, '')
    .replace(/-----END CERTIFICATE REQUEST-----/, '')
    .replace(/\s+/g, '');

  console.log('requesting DISTRIBUTION certificate…');
  const certResp = await asc('POST', '/certificates', {
    data: {
      type: 'certificates',
      attributes: { csrContent, certificateType: 'DISTRIBUTION' },
    },
  });
  cert = certResp.data;
  console.log(`  cert id: ${cert.id}  serial: ${cert.attributes.serialNumber}`);

  const CER_PATH  = path.join(TMP, 'dist.cer');
  const CERT_PEM  = path.join(TMP, 'dist.cert.pem');
  fs.writeFileSync(
      CER_PATH, Buffer.from(cert.attributes.certificateContent, 'base64'));
  execSync(`openssl x509 -inform DER -in ${CER_PATH} -out ${CERT_PEM}`,
      { stdio: 'pipe' });

  const useHomebrew =
      fs.existsSync('/opt/homebrew/opt/openssl@3/bin/openssl');
  const OPENSSL = useHomebrew
    ? '/opt/homebrew/opt/openssl@3/bin/openssl'
    : 'openssl';
  const LEGACY = useHomebrew ? '-legacy' : '';

  const P12_PATH = path.join(TMP, 'dist.p12');
  const P12_PASS = 'asc-prep-temp';
  execSync(
    `${OPENSSL} pkcs12 -export ${LEGACY} -inkey ${KEY_PEM} -in ${CERT_PEM} ` +
    `-name "Apple Distribution: ${TEAM_OWNER} (${TEAM_ID})" ` +
    `-out ${P12_PATH} -password pass:${P12_PASS}`,
    { stdio: 'pipe' });

  console.log('importing into login keychain…');
  execSync(
    `security import ${P12_PATH} -k ${os.homedir()}/Library/Keychains/login.keychain-db -P ${P12_PASS} -T /usr/bin/codesign -T /usr/bin/security`,
    { stdio: 'inherit' });
  try {
    execSync(
      `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k '' ${os.homedir()}/Library/Keychains/login.keychain-db`,
      { stdio: 'pipe' });
  } catch {/* keychain pass 없으면 실패할 수 있지만 codesign 은 동작 */}
  certs = [{ id: cert.id }];
}

// ─── 4. profile 들 일괄 생성 ────────────────────────────────────
const profilesByBundle = new Map();
for (const pair of PAIRS) {
  const bundle = bundleByIdentifier.get(pair.bundleId);
  console.log(`creating ${PROFILE_TYPE} profile "${pair.profileName}" for ${pair.bundleId}…`);
  const profileResp = await asc('POST', '/profiles', {
    data: {
      type: 'profiles',
      attributes: {
        name: pair.profileName,
        profileType: PROFILE_TYPE,
      },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundle.id } },
        certificates: { data: certs.map(c => ({ type: 'certificates', id: c.id })) },
      },
    },
  });
  const profile = profileResp.data;
  console.log(`  profile id: ${profile.id}  uuid: ${profile.attributes.uuid}`);

  const profilePath = path.join(
    os.homedir(),
    'Library/MobileDevice/Provisioning Profiles',
    `${profile.attributes.uuid}.mobileprovision`);
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(
      profilePath,
      Buffer.from(profile.attributes.profileContent, 'base64'));
  console.log(`  installed: ${profilePath}`);
  profilesByBundle.set(pair.bundleId, { profile, name: pair.profileName });
}

// ─── 5. ExportOptions 안내 ──────────────────────────────────────
console.log('\n=== ExportOptions.plist provisioningProfiles dict ===');
console.log('<key>provisioningProfiles</key>');
console.log('<dict>');
for (const pair of PAIRS) {
  console.log(`    <key>${pair.bundleId}</key>`);
  console.log(`    <string>${pair.profileName}</string>`);
}
console.log('</dict>');
console.log('\n=== xcodebuild manual signing ===');
console.log(`  CODE_SIGN_IDENTITY = Apple Distribution: ${TEAM_OWNER} (${TEAM_ID})`);
console.log(`  DEVELOPMENT_TEAM   = ${TEAM_ID}`);
console.log(`  CODE_SIGN_STYLE    = Manual`);
console.log(`  (각 타겟의 PROVISIONING_PROFILE_SPECIFIER 는 이미 project.yml 에 박혀 있어야 함)`);

// 임시 파일 정리 (실패 시엔 디버깅 위해 보존)
try { fs.rmSync(TMP, { recursive: true }); } catch {/* ignore */}
