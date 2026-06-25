#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirs = new Set(['.git', 'node_modules', '.terraform', 'build', 'DerivedData', 'public-site']);
const ignoredFiles = new Set(['package-lock.json', 'check-sensitive.mjs', 'check-docs.mjs']);
const patterns = [
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
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, result);
    else if (!ignoredFiles.has(entry.name)) result.push(fullPath);
  }
  return result;
}

const findings = [];
for (const file of walk(root)) {
  const rel = path.relative(root, file);
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  content = withoutAllowedPublicReferences(content);
  for (const pattern of patterns) {
    if (pattern.test(content)) findings.push(`${rel}: ${pattern}`);
  }
}

if (findings.length) {
  console.error('민감정보 패턴 검사 실패:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log('민감정보 패턴 검사 통과');
