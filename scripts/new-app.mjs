#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  console.log(`새 앱 문서/정적 페이지 템플릿 생성기

사용:
  node scripts/new-app.mjs --name=my-app --platform=ios --category=utilities --bundle-id=com.example.myapp --display-name="MyApp"

필수:
  --name          kebab-case 앱 디렉터리 이름
  --platform      flutter | ios | macos
  --category      games, utilities 같은 카테고리 디렉터리

선택:
  --bundle-id     기본값: com.example.<name에서 dash 제거>
  --display-name  기본값: name을 Title Case로 변환
  --description   README/docs/ROADMAP에 들어갈 앱 설명
  --constraints   지원 OS/기기/네트워크 제약
  --hosting       netlify | vercel | aws | undecided
  --company       docs footer 회사명. 기본값: Example Company
  --support-email privacy 문의 이메일. 기본값: support@example.com
  --force         기존 파일 덮어쓰기
`);
}

function parseArgs(argv) {
  const result = { _: [] };
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      result._.push(arg);
      continue;
    }
    const [key, rawValue] = arg.slice(2).split('=');
    result[key] = rawValue ?? true;
  }
  if (result._[0] && !result.name) result.name = result._[0];
  if (result._[1] && !result.platform) result.platform = result._[1];
  if (result._[2] && !result.category) result.category = result._[2];
  return result;
}

function titleCase(value) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function pascalCase(value) {
  return titleCase(value).replace(/\s+/g, '');
}

function readTemplate(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function writeFile(filePath, content, { force = false } = {}) {
  if (fs.existsSync(filePath) && !force) {
    throw new Error(`이미 존재하는 파일입니다: ${path.relative(root, filePath)} (--force로 덮어쓰기 가능)`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function replaceAll(content, replacements) {
  let output = content;
  for (const [key, value] of Object.entries(replacements)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }
  return output;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  usage();
  process.exit(0);
}

const missing = ['name', 'platform', 'category'].filter((key) => !args[key]);
if (missing.length) {
  console.error(`필수 값이 없습니다: ${missing.map((key) => `--${key}`).join(', ')}`);
  usage();
  process.exit(2);
}

const name = String(args.name);
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
  console.error('--name은 kebab-case여야 합니다. 예: my-app');
  process.exit(2);
}

const platform = String(args.platform);
if (!['flutter', 'ios', 'macos'].includes(platform)) {
  console.error('--platform은 flutter, ios, macos 중 하나여야 합니다.');
  process.exit(2);
}

const category = String(args.category).replace(/^\/+|\/+$/g, '');
const bundleId = String(args['bundle-id'] || `com.example.${name.replaceAll('-', '')}`);
const displayName = String(args['display-name'] || titleCase(name));
const appTypeName = pascalCase(displayName);
const description = String(args.description || `${displayName} 앱의 목적과 핵심 사용자를 작성하세요.`);
const constraints = String(args.constraints || '지원 OS와 기기 제약을 작성하세요.');
const hosting = String(args.hosting || 'undecided');
const company = String(args.company || 'Example Company');
const supportEmail = String(args['support-email'] || 'support@example.com');
const force = Boolean(args.force);
const year = String(new Date().getFullYear());
const today = new Date().toISOString().slice(0, 10);
const appDir = path.join(root, category, name);

if (fs.existsSync(appDir) && fs.readdirSync(appDir).length > 0 && !force) {
  console.error(`앱 디렉터리가 이미 비어 있지 않습니다: ${path.relative(root, appDir)}`);
  console.error('--force를 사용하면 템플릿 파일만 덮어씁니다.');
  process.exit(2);
}

const replacements = {
  APP_NAME_DISPLAY: displayName,
  APP_NAME_EN: displayName,
  TAGLINE: description.split(/[.!?。]/)[0] || description,
  DESCRIPTION_HTML: `<p>${description}</p>\n    <p>지원 환경: ${constraints}</p>`,
  COPYRIGHT_YEAR: year,
  COMPANY_NAME: company,
  LAST_UPDATED: today,
  PRIVACY_SUMMARY: '앱의 실제 데이터 수집, 추적, 계정, 결제, 클라우드 사용 여부에 맞게 이 문장을 수정하세요.',
  SUPPORT_EMAIL: supportEmail,
};

const readme = `# ${displayName}

${description}

## 지원 환경

- 플랫폼: ${platform}
- Bundle ID / package name: \`${bundleId}\`
- 제약사항: ${constraints}

## 개발 문서

- \`ROADMAP.md\`: 목적, 핵심 기능, 디자인 원칙, 개발 순서, 출시 전 체크리스트
- \`AGENTS.md\`: Codex / Claude Code 작업 지침
- \`docs/\`: 홈페이지, 개인정보처리방침, 약관 등 정적 페이지

## 빌드

\`\`\`sh
# 플랫폼별 표준 빌드 명령을 작성하세요.
\`\`\`
`;

const agents = readTemplate('templates/app/AGENTS.md')
  .replaceAll('<앱 이름>', displayName)
  .replace('- 앱 이름:', `- 앱 이름: ${displayName}`)
  .replace('- 플랫폼:', `- 플랫폼: ${platform}`)
  .replace('- Bundle ID / package name:', `- Bundle ID / package name: ${bundleId}`)
  .replace('- 지원 환경:', `- 지원 환경: ${constraints}`)
  .replace('- 정적 페이지:', `- 정적 페이지: ${hosting}`);

const roadmap = readTemplate('templates/app/ROADMAP.md')
  .replaceAll('<앱 이름>', displayName)
  .replace('- 이 앱이 해결하는 문제:', `- 이 앱이 해결하는 문제: ${description}`)
  .replace('- 출시 시점에 반드시 전달해야 하는 가치:', '- 출시 시점에 반드시 전달해야 하는 가치:');

const deployConfig = `APPS_DEPLOY_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/../../apps-deployment" && pwd)"
export APPS_DEPLOY_DIR
source "$APPS_DEPLOY_DIR/shared.config.sh"

export ASC_BUNDLE_ID="${bundleId}"
export ASC_APP_NAME="${displayName}"
export PLAY_PACKAGE_NAME="${bundleId}"

# 필요 시 앱별로 채웁니다.
# export ASC_API_KEY="<KEY_ID>"
# export ASC_API_ISSUER="<ISSUER_ID>"
# export ASC_TEAM_ID="<TEAM_ID>"
# export PLAY_SA_KEY="$HOME/.playconsole/apps-sa.json"
`;

const files = [
  ['README.md', readme],
  ['AGENTS.md', agents],
  ['CLAUDE.md', readTemplate('templates/app/CLAUDE.md')],
  ['ROADMAP.md', roadmap],
  ['deploy.config.sh', deployConfig],
  ['docs/index.html', replaceAll(readTemplate('templates/docs/index.html'), replacements)],
  ['docs/privacy.html', replaceAll(readTemplate('templates/docs/privacy.html'), replacements)],
];

for (const [relativePath, content] of files) {
  writeFile(path.join(appDir, relativePath), content.endsWith('\n') ? content : `${content}\n`, { force });
}

console.log(`생성 완료: ${path.relative(root, appDir)}`);
console.log(`다음 단계:`);
console.log(`1. ${path.relative(root, appDir)}/ROADMAP.md를 실제 출시 범위에 맞게 수정`);
console.log(`2. 필요한 경우 플랫폼 scaffold 생성: ${platform === 'flutter' ? 'flutter create ...' : 'XcodeGen/SwiftPM 설정'}`);
console.log(`3. hosting provider 결정 후 infra/scripts/apps-config.mjs 갱신`);
console.log(`4. 배포 전: node scripts/check-env.mjs --app=${path.relative(root, appDir)} --platform=${platform}`);

