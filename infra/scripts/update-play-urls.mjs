#!/usr/bin/env node
// Update Google Play Console URLs for every app in apps-config.mjs.
//
// What's automatable via the Android Publisher API v3:
//   - edits.details.contactWebsite   (set to the app's home URL)
//
// What is NOT in the public API (web UI only):
//   - Privacy Policy URL  (Policy → App content → Privacy Policy)
//   - Data Safety questionnaire
//   - "Account deletion" external link
//
// For the UI-only fields, this script prints an actionable list with
// pre-filled URLs and (with --open) opens the right Play Console page in
// the default browser.
//
// Run:
//   cd infra/scripts
//   node update-play-urls.mjs               # update contactWebsite, print UI todos
//   node update-play-urls.mjs --validate    # dry run (validates the edit, no commit)
//   node update-play-urls.mjs --open        # also open the Play Console URLs
//   node update-play-urls.mjs --app=gomoku  # one app only

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { JWT } from 'google-auth-library';
import { APPS } from './apps-config.mjs';

const args = new Set(process.argv.slice(2));
const VALIDATE = args.has('--validate');
const OPEN = args.has('--open');
const ONLY = [...args].find(a => a.startsWith('--app='))?.slice('--app='.length);

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

async function authClient(saKey) {
  const keyPath = path.join(os.homedir(), '.playconsole', saKey);
  if (!fs.existsSync(keyPath)) {
    throw new Error(`SA key not found: ${keyPath}`);
  }
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const c = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  await c.authorize();
  return c;
}

async function call(client, method, p, body) {
  const r = await client.request({ url: `${API}${p}`, method, data: body });
  return r.data;
}

async function updateApp(app) {
  console.log(`\n── ${app.name} (${app.packageName})`);

  let client;
  try {
    client = await authClient(app.playSaKey);
  } catch (e) {
    console.log(`   ⚠ ${e.message}`);
    console.log(`   skipping API update; UI todos still printed below`);
    return { authFailed: true };
  }

  const edit = await call(client, 'POST', `/applications/${app.packageName}/edits`, {});
  console.log(`   edit ${edit.id}`);

  const cur = await call(client, 'GET', `/applications/${app.packageName}/edits/${edit.id}/details`);
  const same = cur.contactWebsite === app.urls.home;
  console.log(`   contactWebsite: ${cur.contactWebsite || '(unset)'}`);
  if (same) {
    console.log(`   already correct — no PATCH`);
  } else {
    console.log(`   → ${app.urls.home}`);
    await call(client, 'PUT', `/applications/${app.packageName}/edits/${edit.id}/details`, {
      ...cur,
      contactWebsite: app.urls.home,
    });
  }

  if (VALIDATE) {
    await call(client, 'POST', `/applications/${app.packageName}/edits/${edit.id}:validate`, {});
    console.log(`   validated (no commit)`);
  } else if (same) {
    // No-op; delete the unmodified edit to keep the namespace clean.
    try { await call(client, 'DELETE', `/applications/${app.packageName}/edits/${edit.id}`); } catch {}
  } else {
    await call(client, 'POST', `/applications/${app.packageName}/edits/${edit.id}:commit`, {});
    console.log(`   committed`);
  }

  return { ok: true };
}

function printUiTodos(app) {
  console.log(`   --- UI-only updates (${app.name}) ---`);
  console.log(`   Privacy Policy URL:  ${app.urls.privacy}`);
  console.log(`     → 콘솔에서 ${app.packageName} 선택 → Policy and programs → App content → Privacy policy`);
  if (app.urls.accountDeletion) {
    console.log(`   Account deletion URL: ${app.urls.accountDeletion}`);
    console.log(`     → 같은 화면 → App content → Data deletion`);
  }
}

function maybeOpenConsole() {
  if (!OPEN) return;
  // 앱별 deep link 가 developer-account 선택 페이지로 빠지므로 콘솔 root 만 1회 오픈.
  const url = 'https://play.google.com/console/u/0/developers';
  try {
    execSync(`open '${url}'`);
    console.log(`\n(opened ${url} — 위 가이드 따라 각 앱별로 처리)`);
  } catch {}
}

async function main() {
  const apps = ONLY ? APPS.filter(a => a.name === ONLY) : APPS;
  if (apps.length === 0) {
    console.error(`No app matches --app=${ONLY}. Available: ${APPS.map(a => a.name).join(', ')}`);
    process.exit(1);
  }
  let failures = 0;
  for (const app of apps) {
    try {
      await updateApp(app);
    } catch (e) {
      console.error(`   API update failed: ${e.response?.data ? JSON.stringify(e.response.data) : e.message}`);
      failures++;
    }
    printUiTodos(app);
  }
  maybeOpenConsole();
  if (failures) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
