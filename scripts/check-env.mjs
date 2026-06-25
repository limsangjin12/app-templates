#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split('=');
    args[key] = value ?? true;
  }
  return args;
}

function loadEnv(appPath) {
  const configPath = path.join(appPath, 'deploy.config.sh');
  if (!fs.existsSync(configPath)) {
    return { env: process.env, configPath, loaded: false };
  }
  const script = `set -a; source "${configPath.replaceAll('"', '\\"')}"; env -0`;
  const raw = execFileSync('bash', ['-lc', script], { encoding: 'utf8' });
  const env = { ...process.env };
  for (const entry of raw.split('\0')) {
    if (!entry) continue;
    const index = entry.indexOf('=');
    if (index > -1) env[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return { env, configPath, loaded: true };
}

function exists(filePath) {
  return filePath && fs.existsSync(filePath.replace(/^~(?=$|\/)/, os.homedir()));
}

function printMissing(name, help) {
  console.log(`- ${name}: 누락`);
  console.log(`  ${help}`);
}

const args = parseArgs(process.argv.slice(2));
const appRelative = args.app || '.';
const appPath = path.resolve(root, appRelative);
const platform = args.platform || 'auto';
const { env, configPath, loaded } = loadEnv(appPath);

console.log(`검사 대상: ${path.relative(root, appPath) || '.'}`);
console.log(`deploy.config.sh: ${loaded ? path.relative(root, configPath) : '없음'}`);

if (!loaded) {
  console.log('\n먼저 앱 디렉터리에 deploy.config.sh를 만드세요. templates/app/deploy.config.example.sh를 복사해 시작할 수 있습니다.');
}

const checks = [];
function requireEnv(name, help) {
  checks.push({ name, ok: Boolean(env[name]), help });
}

const needsIos = platform === 'ios' || platform === 'macos' || platform === 'flutter' || platform === 'auto';
const needsPlay = platform === 'flutter' || platform === 'android';

if (needsIos) {
  requireEnv('ASC_API_KEY', 'App Store Connect → Users and Access → Integrations → Keys의 Key ID를 설정하세요.');
  requireEnv('ASC_API_ISSUER', 'App Store Connect Integrations 화면의 Issuer ID를 설정하세요.');
  requireEnv('ASC_TEAM_ID', 'Apple Developer Team ID를 설정하세요.');
  requireEnv('ASC_BUNDLE_ID', '앱 bundle id를 설정하세요. 예: com.example.myapp');
  requireEnv('ASC_APP_NAME', 'App Store Connect 앱 이름 또는 scheme 이름을 설정하세요.');
}
if (needsPlay) {
  requireEnv('PLAY_PACKAGE_NAME', 'Play Console package name을 설정하세요. Android applicationId와 같아야 합니다.');
  requireEnv('PLAY_SA_KEY', 'Android Publisher API 권한이 있는 service account JSON 경로를 설정하세요.');
}

let failed = false;
for (const check of checks) {
  if (check.ok) {
    console.log(`- ${check.name}: 설정됨`);
  } else {
    failed = true;
    printMissing(check.name, check.help);
  }
}

if (env.ASC_API_KEY) {
  const keyPath = env.ASC_KEY_PATH || path.join(os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${env.ASC_API_KEY}.p8`);
  if (exists(keyPath)) {
    console.log(`- ASC .p8 파일: 존재 (${keyPath})`);
  } else {
    failed = true;
    console.log(`- ASC .p8 파일: 없음 (${keyPath})`);
    console.log('  mkdir -p "$HOME/.appstoreconnect/private_keys" 후 AuthKey_<KEY_ID>.p8 파일을 이 위치에 두고 chmod 600을 적용하세요.');
  }
}

if (needsPlay && env.PLAY_SA_KEY) {
  if (exists(env.PLAY_SA_KEY)) {
    console.log(`- PLAY_SA_KEY 파일: 존재 (${env.PLAY_SA_KEY})`);
  } else {
    failed = true;
    console.log(`- PLAY_SA_KEY 파일: 없음 (${env.PLAY_SA_KEY})`);
    console.log('  Google Cloud에서 service account JSON을 내려받아 repo 밖 경로에 두고 chmod 600을 적용하세요.');
  }
}

if (failed) {
  console.log('\n일회성 설정 예시:');
  console.log('export ASC_API_KEY="<KEY_ID>"');
  console.log('export ASC_API_ISSUER="<ISSUER_ID>"');
  console.log('export ASC_TEAM_ID="<TEAM_ID>"');
  console.log('export ASC_BUNDLE_ID="com.example.myapp"');
  console.log('export ASC_APP_NAME="MyApp"');
  console.log('export PLAY_PACKAGE_NAME="com.example.myapp"');
  console.log('export PLAY_SA_KEY="$HOME/.playconsole/apps-sa.json"');
  process.exit(1);
}

console.log('\n환경변수 검사 통과');

