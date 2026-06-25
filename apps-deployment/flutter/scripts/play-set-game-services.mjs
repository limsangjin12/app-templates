#!/usr/bin/env node
// Registers Play Games Services leaderboards + achievements via the
// Games Configuration API. Idempotent — match by `token` (the public
// vendor ID like `com.example.app.elo`); existing items are PATCHed.
//
// **Manual prerequisites (one-time)**:
//   1. Create the Play Games Services game in Play Console (gives you
//      a numeric applicationId — e.g. 308041177033).
//   2. Link a Cloud project to the game (Play Console → PGS → Configuration).
//   3. Enable Games Configuration API in that Cloud project.
//   4. Create a Service Account in that Cloud project; download a JSON key.
//   5. Invite the SA in Play Console → Users and permissions with at least
//      "View app information" + "Manage Play Games Services".
//
// Required env vars:
//   PLAY_GAMES_APPLICATION_ID   numeric, from Play Console → PGS → Configuration
//   PLAY_GAMES_SA_KEY           path to SA JSON (default ~/.playconsole/play-games-sa.json)
//
// Optional:
//   --config=<path>             default: ./store-listings/play-game-services.json
//   --validate                  lint config + auth, no mutations
//
// Config schema (per-app, lives in <app>/store-listings/play-game-services.json):
//   {
//     "leaderboards": [
//       {
//         "vendorId": "com.example.app.elo",
//         "scoreOrder": "LARGER_IS_BETTER",   // or SMALLER_IS_BETTER
//         "scoreFormat": "NUMERIC",           // NUMERIC / NUMERIC_FRACTIONAL / TIME / CURRENCY
//         "name": {
//           "en-US": "ELO Rating",
//           "ko-KR": "ELO 랭킹",
//           ...
//         }
//       }
//     ],
//     "achievements": [
//       {
//         "vendorId": "com.example.app.first_win",
//         "type": "STANDARD",                  // STANDARD or INCREMENTAL
//         "initialState": "REVEALED",          // REVEALED or HIDDEN
//         "points": 10,
//         "stepsToUnlock": 1,                  // INCREMENTAL only
//         "name": { "en-US": "First Victory", "ko-KR": "첫 승리", ... },
//         "description": { "en-US": "Win your first game.", "ko-KR": "...", ... }
//       }
//     ]
//   }
//
// Locales follow Play's hyphen-region form (`en-US`, `ko-KR`, `zh-CN`, …).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JWT } from 'google-auth-library';

const APPLICATION_ID = process.env.PLAY_GAMES_APPLICATION_ID;
if (!APPLICATION_ID) {
  console.error('❌ PLAY_GAMES_APPLICATION_ID env var required (numeric).');
  process.exit(2);
}
const SA_KEY_PATH =
  process.env.PLAY_GAMES_SA_KEY ||
  path.join(os.homedir(), '.playconsole/play-games-sa.json');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    if (!a.startsWith('--')) return [a, true];
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  }),
);
const VALIDATE_ONLY = !!args.validate;
const CONFIG_PATH = path.resolve(
  args.config || path.join(process.cwd(), 'store-listings', 'play-game-services.json'),
);
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`❌ Config not found: ${CONFIG_PATH}`);
  process.exit(2);
}
if (!fs.existsSync(SA_KEY_PATH)) {
  console.error(`❌ SA key not found: ${SA_KEY_PATH}`);
  process.exit(2);
}
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const LEADERBOARDS = cfg.leaderboards || [];
const ACHIEVEMENTS = cfg.achievements || [];

// Side-load previously assigned server-IDs (vendorId → server-id) so that
// renames don't accidentally create duplicate entries. Subsequent runs match
// existing items by ID first (vendorId stays stable across renames).
const IDS_PATH = CONFIG_PATH.replace(/\.json$/, '-ids.json');
if (fs.existsSync(IDS_PATH)) {
  const ids = JSON.parse(fs.readFileSync(IDS_PATH, 'utf8'));
  for (const lb of LEADERBOARDS) {
    if (ids.leaderboards?.[lb.vendorId]) lb._assignedId = ids.leaderboards[lb.vendorId];
  }
  for (const ach of ACHIEVEMENTS) {
    if (ids.achievements?.[ach.vendorId]) ach._assignedId = ids.achievements[ach.vendorId];
  }
}
if (!LEADERBOARDS.length && !ACHIEVEMENTS.length) {
  console.error('❌ Config has neither `leaderboards` nor `achievements`.');
  process.exit(2);
}

const API = 'https://gamesconfiguration.googleapis.com/games/v1configuration';

async function newAuthClient() {
  const key = JSON.parse(fs.readFileSync(SA_KEY_PATH, 'utf8'));
  const client = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  await client.authorize();
  return client;
}

async function call(client, method, pathname, body) {
  const r = await client.request({
    url: `${API}${pathname}`,
    method,
    data: body,
  });
  return r.data;
}

function bundle(map) {
  return {
    kind: 'gamesConfiguration#localizedStringBundle',
    translations: Object.entries(map).map(([locale, value]) => ({
      kind: 'gamesConfiguration#localizedString',
      locale,
      value,
    })),
  };
}

function validate() {
  const errs = [];
  for (const lb of LEADERBOARDS) {
    if (!lb.vendorId) errs.push('leaderboard missing vendorId');
    if (!lb.scoreOrder) errs.push(`${lb.vendorId}: missing scoreOrder`);
    if (!lb.scoreFormat) errs.push(`${lb.vendorId}: missing scoreFormat`);
    if (!lb.name || !Object.keys(lb.name).length)
      errs.push(`${lb.vendorId}: missing name translations`);
  }
  for (const ach of ACHIEVEMENTS) {
    if (!ach.vendorId) errs.push('achievement missing vendorId');
    if (!ach.type) errs.push(`${ach.vendorId}: missing type`);
    if (ach.points == null) errs.push(`${ach.vendorId}: missing points`);
    if (!ach.name || !Object.keys(ach.name).length)
      errs.push(`${ach.vendorId}: missing name translations`);
    if (!ach.description || !Object.keys(ach.description).length)
      errs.push(`${ach.vendorId}: missing description translations`);
    if (ach.type === 'INCREMENTAL' && !ach.stepsToUnlock)
      errs.push(`${ach.vendorId}: INCREMENTAL type requires stepsToUnlock`);
  }
  if (errs.length) {
    for (const e of errs) console.error('  ! ' + e);
    process.exit(1);
  }
}

async function fetchAllPages(client, pathname) {
  const all = [];
  let next = pathname;
  while (next) {
    const page = await call(client, 'GET', next);
    all.push(...(page.items || []));
    if (!page.nextPageToken) break;
    next = `${pathname}${pathname.includes('?') ? '&' : '?'}pageToken=${encodeURIComponent(page.nextPageToken)}`;
  }
  return all;
}

// Heuristic match: prefer existing _assignedId (in config), then fallback
// to en-US name match. Play Games doesn't expose a vendor-controlled
// identifier, so we have to map by display name.
function matchExisting(existing, spec) {
  if (spec._assignedId) {
    const byId = existing.find((e) => e.id === spec._assignedId);
    if (byId) return byId;
  }
  const enName = spec.name?.['en-US'];
  if (!enName) return null;
  return existing.find(
    (e) =>
      e.draft?.name?.translations?.find(
        (t) => t.locale === 'en-US' && t.value === enName,
      ),
  );
}

async function syncLeaderboards(client) {
  console.log('→ Listing existing leaderboards…');
  const existing = await fetchAllPages(
    client,
    `/applications/${APPLICATION_ID}/leaderboards`,
  );
  console.log(`  found ${existing.length}`);

  const results = {};
  for (const lb of LEADERBOARDS) {
    const draftDetail = {
      name: bundle(lb.name),
      scoreFormat: {
        kind: 'gamesConfiguration#gamesNumberFormatConfiguration',
        numberFormatType: lb.scoreFormat,
        // numDecimalPlaces is required even for non-fractional NUMERIC; 0 if absent.
        numDecimalPlaces: lb.numDecimalPlaces ?? 0,
        ...(lb.currencyCode ? { currencyCode: lb.currencyCode } : {}),
      },
    };
    const found = matchExisting(existing, lb);
    let id;
    if (found) {
      id = found.id;
      console.log(`  ↺ ${lb.vendorId} → ${id}`);
      // Re-fetch to get a fresh concurrency token, then PUT.
      const fresh = await call(client, 'GET', `/leaderboards/${id}`);
      const body = {
        kind: 'gamesConfiguration#leaderboardConfiguration',
        id,
        token: fresh.token,
        scoreOrder: lb.scoreOrder,
        draft: { kind: 'gamesConfiguration#leaderboardConfigurationDetail', ...draftDetail },
      };
      if (process.env.DEBUG_BODY) console.log('    body:', JSON.stringify(body, null, 2));
      await call(client, 'PUT', `/leaderboards/${id}`, body);
    } else {
      const body = {
        kind: 'gamesConfiguration#leaderboardConfiguration',
        scoreOrder: lb.scoreOrder,
        draft: { kind: 'gamesConfiguration#leaderboardConfigurationDetail', ...draftDetail },
      };
      console.log(`  + ${lb.vendorId}`);
      if (process.env.DEBUG_BODY) console.log('    body:', JSON.stringify(body, null, 2));
      const r = await call(
        client,
        'POST',
        `/applications/${APPLICATION_ID}/leaderboards`,
        body,
      );
      id = r.id;
    }
    results[lb.vendorId] = id;
  }
  if (Object.keys(results).length) {
    console.log('\n=== Play Games leaderboard IDs ===');
    for (const [k, v] of Object.entries(results)) console.log(`  ${k}: ${v}`);
  }
  return results;
}

async function syncAchievements(client) {
  console.log('→ Listing existing achievements…');
  const existing = await fetchAllPages(
    client,
    `/applications/${APPLICATION_ID}/achievements`,
  );
  console.log(`  found ${existing.length}`);

  const results = {};
  for (const ach of ACHIEVEMENTS) {
    const draftDetail = {
      name: bundle(ach.name),
      description: bundle(ach.description),
      pointValue: ach.points,
    };
    const found = matchExisting(existing, ach);
    let id;
    if (found) {
      id = found.id;
      console.log(`  ↺ ${ach.vendorId} → ${id}`);
      const fresh = await call(client, 'GET', `/achievements/${id}`);
      const body = {
        kind: 'gamesConfiguration#achievementConfiguration',
        id,
        token: fresh.token,
        achievementType: ach.type,
        initialState: ach.initialState || 'REVEALED',
        ...(ach.type === 'INCREMENTAL' ? { stepsToUnlock: ach.stepsToUnlock } : {}),
        draft: { kind: 'gamesConfiguration#achievementConfigurationDetail', ...draftDetail },
      };
      if (process.env.DEBUG_BODY) console.log('    body:', JSON.stringify(body, null, 2));
      await call(client, 'PUT', `/achievements/${id}`, body);
    } else {
      const body = {
        kind: 'gamesConfiguration#achievementConfiguration',
        achievementType: ach.type,
        initialState: ach.initialState || 'REVEALED',
        ...(ach.type === 'INCREMENTAL' ? { stepsToUnlock: ach.stepsToUnlock } : {}),
        draft: { kind: 'gamesConfiguration#achievementConfigurationDetail', ...draftDetail },
      };
      console.log(`  + ${ach.vendorId}`);
      if (process.env.DEBUG_BODY) console.log('    body:', JSON.stringify(body, null, 2));
      const r = await call(
        client,
        'POST',
        `/applications/${APPLICATION_ID}/achievements`,
        body,
      );
      id = r.id;
    }
    results[ach.vendorId] = id;
  }
  if (Object.keys(results).length) {
    console.log('\n=== Play Games achievement IDs ===');
    for (const [k, v] of Object.entries(results)) console.log(`  ${k}: ${v}`);
  }
  return results;
}

async function main() {
  console.log(`Loading config from ${CONFIG_PATH}`);
  validate();

  if (VALIDATE_ONLY) {
    console.log('✅ Config valid (no mutations).');
    return;
  }

  console.log(`→ Authenticating (SA: ${path.basename(SA_KEY_PATH)})…`);
  const client = await newAuthClient();
  console.log(`  applicationId: ${APPLICATION_ID}`);

  const lbIds = LEADERBOARDS.length ? await syncLeaderboards(client) : {};
  const achIds = ACHIEVEMENTS.length ? await syncAchievements(client) : {};

  // Write the vendorId → server-id mapping next to the config file. The
  // Android client uses the server-id (opaque base64) at runtime, while the
  // vendorId stays as the iOS GameCenter ID + repo-friendly key.
  const idMapPath = CONFIG_PATH.replace(/\.json$/, '-ids.json');
  fs.writeFileSync(
    idMapPath,
    JSON.stringify({ leaderboards: lbIds, achievements: achIds }, null, 2) +
      '\n',
  );
  console.log(`\n📝 Saved server-side ID map to ${path.basename(idMapPath)}`);

  console.log('\n✅ Play Games Services configuration synced (draft).');
  console.log(
    '   Promote draft → published in Play Console UI when ready: PGS → Configuration → Publish.\n' +
      '   (The Configuration API only writes the draft copy.)',
  );
}

main().catch((err) => {
  const data = err.response?.data;
  const text =
    typeof data === 'string'
      ? data
      : JSON.stringify(data?.error?.message || data || err.message);
  console.error('\n❌', err.response?.status || '', text.slice(0, 1500));
  process.exit(1);
});
