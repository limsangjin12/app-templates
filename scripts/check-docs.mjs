#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirs = new Set(['.git', 'node_modules', '.terraform', 'build', 'DerivedData']);
const forbidden = [
  /limsangjin12/i,
  /jin-apps/i,
  /jin-factory/i,
  /com\.jin/i,
  /gmail\.com/i,
  /BEGIN (RSA |EC |OPENSSH |PRIVATE )?KEY/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /ghp_[0-9A-Za-z]{36}/,
];
const allowedPublicReferences = [
  'https://github.com/limsangjin12/app-templates',
  'git@github.com:limsangjin12/app-templates.git',
  'https://github.com/limsangjin12/app-templates.git',
  'https://raw.githubusercontent.com/limsangjin12/app-templates/main/README.md',
  'https://raw.githubusercontent.com/limsangjin12/app-templates/main/AGENTS.md',
  'https://raw.githubusercontent.com/limsangjin12/app-templates/main/prompts/app-development-environment-setup.md',
];

function withoutAllowedPublicReferences(content) {
  let sanitized = content;
  for (const value of allowedPublicReferences) {
    sanitized = sanitized.split(value).join('');
  }
  return sanitized;
}

function walk(dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, result);
    else result.push(fullPath);
  }
  return result;
}

const files = walk(root);
const mdFiles = files.filter((file) => file.endsWith('.md'));
const errors = [];

for (const file of mdFiles) {
  const rel = path.relative(root, file);
  const content = fs.readFileSync(file, 'utf8');
  const contentForSensitiveScan = withoutAllowedPublicReferences(content);
  if (!/[가-힣]/.test(content)) {
    errors.push(`${rel}: 한글 본문이 없습니다.`);
  }
  for (const pattern of forbidden) {
    if (pattern.test(contentForSensitiveScan)) {
      errors.push(`${rel}: 금지 패턴 감지 (${pattern})`);
    }
  }
  if (path.basename(file) === 'CLAUDE.md' && !content.includes('AGENTS.md')) {
    errors.push(`${rel}: CLAUDE.md는 같은 디렉터리의 AGENTS.md를 참조해야 합니다.`);
  }
}

const appLikeDirs = new Set();
for (const file of files) {
  const base = path.basename(file);
  if (['deploy.config.sh', 'ROADMAP.md'].includes(base)) {
    appLikeDirs.add(path.dirname(file));
  }
}
for (const dir of appLikeDirs) {
  const rel = path.relative(root, dir);
  for (const required of ['README.md', 'AGENTS.md', 'CLAUDE.md', 'ROADMAP.md']) {
    if (!fs.existsSync(path.join(dir, required))) {
      errors.push(`${rel}: ${required} 누락`);
    }
  }
}

const claudeSkillsDir = path.join(root, '.claude', 'skills');
const codexSkillsDir = path.join(root, '.codex', 'skills');
if (fs.existsSync(claudeSkillsDir) || fs.existsSync(codexSkillsDir)) {
  for (const [sourceDir, targetDir, label] of [
    [claudeSkillsDir, codexSkillsDir, 'Codex'],
    [codexSkillsDir, claudeSkillsDir, 'Claude Code'],
  ]) {
    if (!fs.existsSync(sourceDir)) continue;
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sourceSkill = path.join(sourceDir, entry.name, 'SKILL.md');
      const targetSkill = path.join(targetDir, entry.name, 'SKILL.md');
      if (fs.existsSync(sourceSkill) && !fs.existsSync(targetSkill)) {
        errors.push(`${entry.name}: ${label} skill 누락`);
      }
    }
  }
}

if (errors.length) {
  console.error('문서 검사 실패:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`문서 검사 통과: ${mdFiles.length}개 Markdown 파일`);
