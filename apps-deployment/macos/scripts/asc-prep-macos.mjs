#!/usr/bin/env node
// macOS App Store 배포용 cert / profile 부트스트랩.
//
// `apps-deployment/ios/scripts/asc-prep-build-multi.mjs` 의 macOS 변형.
// macOS App Store 업로드는 두 가지 cert 가 필요:
//   1. Apple Distribution (= ASC API 의 DISTRIBUTION 타입) — .app 서명
//      iOS 와 같은 cert 로 macOS 도 서명 가능 (unified Apple Distribution).
//   2. Mac Installer Distribution (= MAC_INSTALLER_DISTRIBUTION) — .pkg 서명
//      App Store 업로드 시 .pkg 를 만들 때 필수.
// 그리고 MAC_APP_STORE 프로비저닝 프로파일.
//
// Required env (deploy.config.sh + shared.config.sh 가 채워줌):
//   ASC_API_KEY, ASC_API_ISSUER, ASC_TEAM_ID, ASC_TEAM_OWNER
//   ASC_APP_NAME    예: TokenDog
//   ASC_BUNDLE_ID   예: com.example.myapp
//   ASC_PROFILE_NAME (optional, default "<App Name> Mac App Store CLI")
//   ASC_MAC_BUNDLE_PROFILES (optional)
//      세미콜론 구분 'bundleId=ProfileName' 페어. host + macOS extension 처럼
//      여러 MAC_APP_STORE profile 이 필요할 때 사용.
//
// 출력 마지막에 ExportOptions.plist 에 그대로 복붙할 XML 조각이 표시됨.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import jwt from 'jsonwebtoken';

const KEY_ID    = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const TEAM_ID   = process.env.ASC_TEAM_ID;
const APP_NAME  = process.env.ASC_APP_NAME;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
if (!KEY_ID || !ISSUER_ID || !TEAM_ID || !APP_NAME || !BUNDLE_ID) {
  console.error('❌ ASC_API_KEY, ASC_API_ISSUER, ASC_TEAM_ID, ASC_APP_NAME, ASC_BUNDLE_ID required.');
  process.exit(2);
}
const PROFILE_NAME = process.env.ASC_PROFILE_NAME || `${APP_NAME} Mac App Store CLI`;
const PAIRS_RAW = process.env.ASC_MAC_BUNDLE_PROFILES;
const PROFILE_PAIRS = PAIRS_RAW
  ? PAIRS_RAW.split(';').map(s => s.trim()).filter(Boolean).map(s => {
      const eq = s.indexOf('=');
      if (eq < 0) throw new Error(`malformed pair (need bundleId=ProfileName): ${s}`);
      return { bundleId: s.slice(0, eq).trim(), profileName: s.slice(eq + 1).trim() };
    })
  : [{ bundleId: BUNDLE_ID, profileName: PROFILE_NAME }];
const TEAM_OWNER  = process.env.ASC_TEAM_OWNER || 'Lim Sangjin';
const KEY_PATH    = process.env.ASC_KEY_PATH || path.join(os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);

const API = 'https://api.appstoreconnect.apple.com/v1';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-prep-macos-'));

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
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status}\n${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

// ─── 1. bundle 매핑 ─────────────────────────────────────────────
const bundlesResp = await asc('GET', '/bundleIds?limit=200');
const bundleByIdentifier = new Map(
  bundlesResp.data.map(b => [b.attributes.identifier, b]));
const missing = PROFILE_PAIRS.filter(p => !bundleByIdentifier.has(p.bundleId));
if (missing.length) {
  console.error('❌ 다음 Bundle ID 가 ASC 에 등록돼 있지 않음:');
  for (const m of missing) console.error(`  ${m.bundleId}`);
  process.exit(3);
}

// ─── 2. App Distribution cert: 로컬 keychain 매칭 valid cert 재사용 ──
function serialToBigInt(hex) {
  return BigInt('0x' + hex.replace(/^serial=/i, '').replace(/^0x/i, '').trim());
}
function localKeychainHasSerial(serialHex, name = 'Apple Distribution') {
  try {
    const out = execSync(
      `security find-certificate -a -c '${name}' -p ${os.homedir()}/Library/Keychains/login.keychain-db`,
      { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const target = serialToBigInt(serialHex);
    const certs = out.split(/(?=-----BEGIN CERTIFICATE-----)/).filter(Boolean);
    for (const pem of certs) {
      const tmp = path.join(TMP, `kc-${Math.random().toString(36).slice(2)}.pem`);
      fs.writeFileSync(tmp, pem);
      try {
        const ser = execSync(`openssl x509 -in ${tmp} -noout -serial`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        if (serialToBigInt(ser) === target) return true;
      } catch {}
    }
  } catch {}
  return false;
}

const allCerts = await asc('GET', '/certificates?limit=200');
const validBy = (type, name) => allCerts.data
  .filter(c => c.attributes.certificateType === type)
  .filter(c => new Date(c.attributes.expirationDate) > new Date())
  .filter(c => localKeychainHasSerial(c.attributes.serialNumber, name))
  .map(c => ({ id: c.id, serial: c.attributes.serialNumber, exp: c.attributes.expirationDate }));

const distCerts = validBy('DISTRIBUTION', 'Apple Distribution');
if (distCerts.length === 0) {
  console.error('❌ 로컬 keychain 에 Apple Distribution cert 가 없음.');
  console.error('iOS asc-prep-build-multi.mjs 를 먼저 한 번 돌리거나 Xcode → Settings → Accounts 에서 발급.');
  process.exit(4);
}
console.log(`reusing ${distCerts.length} Apple Distribution cert(s)`);

// ─── 3. Mac Installer Distribution cert: 없으면 새로 발급 + import ──
const installerType = 'MAC_INSTALLER_DISTRIBUTION';
const installerCN  = '3rd Party Mac Developer Installer';   // certificate CN
let installerCerts = validBy(installerType, installerCN);

if (installerCerts.length === 0) {
  console.log('Mac Installer Distribution cert 없음 — 새로 발급…');
  const KEY_PEM = path.join(TMP, 'inst.key.pem');
  const CSR_PEM = path.join(TMP, 'inst.csr.pem');
  execSync(`openssl genrsa -out ${KEY_PEM} 2048`, { stdio: 'pipe' });
  execSync(
    `openssl req -new -key ${KEY_PEM} -out ${CSR_PEM} ` +
    `-subj "/CN=${APP_NAME} Installer CLI/O=${TEAM_OWNER}/C=US"`,
    { stdio: 'pipe' });
  const csr = fs.readFileSync(CSR_PEM, 'utf8')
    .replace(/-----(BEGIN|END) CERTIFICATE REQUEST-----/g, '').replace(/\s+/g, '');
  const certResp = await asc('POST', '/certificates', {
    data: { type: 'certificates', attributes: { csrContent: csr, certificateType: installerType } },
  });
  const cert = certResp.data;
  console.log(`  cert id: ${cert.id} serial: ${cert.attributes.serialNumber}`);

  const CER = path.join(TMP, 'inst.cer');
  const PEM = path.join(TMP, 'inst.cert.pem');
  const P12 = path.join(TMP, 'inst.p12');
  fs.writeFileSync(CER, Buffer.from(cert.attributes.certificateContent, 'base64'));
  execSync(`openssl x509 -inform DER -in ${CER} -out ${PEM}`, { stdio: 'pipe' });

  const useHomebrew = fs.existsSync('/opt/homebrew/opt/openssl@3/bin/openssl');
  const OPENSSL = useHomebrew ? '/opt/homebrew/opt/openssl@3/bin/openssl' : 'openssl';
  const LEGACY  = useHomebrew ? '-legacy' : '';
  execSync(
    `${OPENSSL} pkcs12 -export ${LEGACY} -inkey ${KEY_PEM} -in ${PEM} ` +
    `-name "${installerCN}: ${TEAM_OWNER} (${TEAM_ID})" ` +
    `-out ${P12} -password pass:asc-prep-temp`,
    { stdio: 'pipe' });
  execSync(
    `security import ${P12} -k ${os.homedir()}/Library/Keychains/login.keychain-db -P asc-prep-temp -T /usr/bin/productbuild -T /usr/bin/security`,
    { stdio: 'inherit' });
  try {
    execSync(
      `security set-key-partition-list -S apple-tool:,apple:,productbuild: -s -k '' ${os.homedir()}/Library/Keychains/login.keychain-db`,
      { stdio: 'pipe' });
  } catch {}
  installerCerts = [{ id: cert.id, serial: cert.attributes.serialNumber, exp: cert.attributes.expirationDate }];
}
console.log(`Mac Installer Distribution cert OK (${installerCerts.length})`);

// ─── 4. Profile 정리 후 새로 생성 ────────────────────────────────
const allProfiles = await asc('GET', '/profiles?include=bundleId&limit=200');
const wantedProfileNames = new Set(PROFILE_PAIRS.map(p => p.profileName));
for (const p of allProfiles.data) {
  if (wantedProfileNames.has(p.attributes.name)) {
    console.log(`deleting old profile: ${p.attributes.name} (${p.id})`);
    await asc('DELETE', `/profiles/${p.id}`);
  }
}

for (const pair of PROFILE_PAIRS) {
  const bundle = bundleByIdentifier.get(pair.bundleId);
  console.log(`creating MAC_APP_STORE profile "${pair.profileName}" for ${pair.bundleId}…`);
  const profileResp = await asc('POST', '/profiles', {
    data: {
      type: 'profiles',
      attributes: { name: pair.profileName, profileType: 'MAC_APP_STORE' },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundle.id } },
        certificates: { data: distCerts.map(c => ({ type: 'certificates', id: c.id })) },
      },
    },
  });
  const profile = profileResp.data;
  const profilePath = path.join(
    os.homedir(),
    'Library/MobileDevice/Provisioning Profiles',
    `${profile.attributes.uuid}.provisionprofile`);
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, Buffer.from(profile.attributes.profileContent, 'base64'));
  console.log(`  installed: ${profilePath}`);
}

// ─── 5. ExportOptions 안내 ──────────────────────────────────────
console.log('\n=== ExportOptions.plist (manual signing 권장) ===');
console.log(`<key>method</key>                  <string>app-store-connect</string>`);
console.log(`<key>signingStyle</key>            <string>manual</string>`);
console.log(`<key>teamID</key>                  <string>${TEAM_ID}</string>`);
console.log(`<key>signingCertificate</key>      <string>Apple Distribution</string>`);
console.log(`<key>installerSigningCertificate</key>`);
console.log(`<string>3rd Party Mac Developer Installer</string>`);
console.log(`<key>provisioningProfiles</key>`);
console.log(`<dict>`);
for (const pair of PROFILE_PAIRS) {
  console.log(`    <key>${pair.bundleId}</key>  <string>${pair.profileName}</string>`);
}
console.log(`</dict>`);

try { fs.rmSync(TMP, { recursive: true }); } catch {}
