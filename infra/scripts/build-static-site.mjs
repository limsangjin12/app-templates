#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ignoredDirs = new Set(['.git', 'node_modules', '.terraform', 'apps-deployment', 'infra', 'templates', '.claude', 'scripts']);

function parseArgs(argv) {
  const args = { out: 'public-site' };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split('=');
    args[key] = value ?? true;
  }
  return args;
}

function walk(dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name) && dir === root) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, result);
    else result.push(fullPath);
  }
  return result;
}

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(root, args.out);
const docsDirs = [];

for (const file of walk(root)) {
  if (path.basename(file) !== 'index.html') continue;
  if (path.basename(path.dirname(file)) !== 'docs') continue;
  docsDirs.push(path.dirname(file));
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const docsDir of docsDirs) {
  const appDir = path.dirname(docsDir);
  const appName = path.basename(appDir);
  const target = path.join(outDir, appName);
  copyDir(docsDir, target);
  console.log(`${path.relative(root, docsDir)} -> ${path.relative(root, target)}`);
}

console.log(`정적 사이트 생성 완료: ${path.relative(root, outDir)} (${docsDirs.length}개 앱)`);

