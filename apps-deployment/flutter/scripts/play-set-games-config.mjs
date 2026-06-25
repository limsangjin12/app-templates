#!/usr/bin/env node
// Registers Google Play Games Services achievements + leaderboards via the
// Game Services Publishing API (gamesConfiguration v1).
//
// **Manual prerequisites (one-time, Play Console UI)**:
//   1. Play Console → Grow → Play Games Services → Setup and management →
//      Configuration → "Create new"
//      - Game name + link to Android package
//      - Auto-creates a 12-digit applicationId (e.g. 632158276743)
//   2. Open the new game's "Properties" tab → "Languages" → add the locales
//      you'll send translations for (en-US, ko-KR, ja-JP, zh-CN, zh-TW).
//   3. Enable the Google Play Games Services Publishing API in the SA's
//      Cloud project: https://console.cloud.google.com/apis/library/gameservices.googleapis.com
//
// Required env vars:
//   PLAY_GAMES_APP_ID     12-digit applicationId from Play Console
//   PLAY_SA_KEY           SA JSON path (default ~/.playconsole/<lastSegment>-sa.json)
//
// Listings source — pick one:
//   1) PLAY_GAMES_LISTINGS=path/to/listings.json
//   2) Default: ./store-listings/play-games.json
//
//   listings.json shape:
//     {
//       "leaderboards": [
//         { "leaderboardId": "com.example.app.score",
//           "scoreOrder": "LARGER_IS_BETTER",
//           "name": { "en-US":"Best Score", "ko-KR":"최고 점수", ... } },
//         ...
//       ],
//       "achievements": [
//         { "id": "first_play", "points": 5,
//           "l": { "en-US": ["First play", "Play once"],
//                  "ko-KR": ["첫 플레이", "한 번 플레이"], ... } },
//         ...
//       ]
//     }
//
// Note: Play Games uses HYPHEN locale format (en-US, ko-KR, ja-JP, zh-CN,
// zh-TW), NOT underscore. The script does not transform — supply hyphen
// keys directly.
//
// Run:
//   PLAY_GAMES_APP_ID=632158276743 \
//   PLAY_SA_KEY=~/.playconsole/myapp-sa.json \
//   node /path/to/apps-deployment/flutter/scripts/play-set-games-config.mjs
//
// Draft → Published is **not exposed by the Google Play Game Services
// Publishing API** — `gamesConfiguration.v1` only has list/get/insert/
// update/delete on leaderboards and achievements (no `publish` method).
// After running this script, one manual click is still required:
//   Play Console → Play Games Services → Setup and management → Publish.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JWT } from 'google-auth-library';

const APP_ID = process.env.PLAY_GAMES_APP_ID;
if (!APP_ID) {
  console.error('❌ PLAY_GAMES_APP_ID env var required.');
  process.exit(2);
}
const SA_KEY_PATH =
  process.env.PLAY_SA_KEY ||
  (process.env.PLAY_PACKAGE_NAME &&
    path.join(os.homedir(), `.playconsole/${process.env.PLAY_PACKAGE_NAME.split('.').pop()}-sa.json`));
if (!SA_KEY_PATH) {
  console.error('❌ Set PLAY_SA_KEY (path to SA JSON) or PLAY_PACKAGE_NAME so the default can be derived.');
  process.exit(2);
}

const ROOT = process.cwd();
const LISTINGS_PATH = process.env.PLAY_GAMES_LISTINGS || path.join(ROOT, 'store-listings/play-games.json');

const API = 'https://www.googleapis.com/games/v1configuration';

function loadListings() {
  if (!fs.existsSync(LISTINGS_PATH)) {
    console.error(`❌ Listings not found at ${LISTINGS_PATH}.`);
    console.error('   Provide PLAY_GAMES_LISTINGS=<json>, or place store-listings/play-games.json.');
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(LISTINGS_PATH, 'utf8'));
}

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

async function call(client, method, url, body) {
  const res = await client.request({ url, method, data: body });
  return res.data;
}

// Match existing resources by the en-US name (server-set token can't be
// controlled, so we use the unique English name as our anchor).
function findExisting(items, enUsName) {
  return (items || []).find((item) =>
    (item.draft?.name?.translations || []).some(
      (t) => t.locale === 'en-US' && t.value === enUsName,
    ),
  );
}

async function main() {
  const data = loadListings();
  const LEADERBOARDS = data.leaderboards || [];
  const ACHIEVEMENTS = data.achievements || [];

  console.log(`→ Authorizing (Play Games applicationId=${APP_ID})…`);
  const client = await newAuthClient();

  // --- Leaderboards -------------------------------------------------------
  console.log('→ Listing existing leaderboards…');
  const lbList = await call(client, 'GET', `${API}/applications/${APP_ID}/leaderboards`);
  const lbResults = {};
  for (const lb of LEADERBOARDS) {
    const enUsName = lb.name['en-US'];
    const existing = findExisting(lbList.items, enUsName);
    const body = {
      kind: 'gamesConfiguration#leaderboardConfiguration',
      scoreOrder: lb.scoreOrder || 'LARGER_IS_BETTER',
      draft: {
        kind: 'gamesConfiguration#leaderboardConfigurationDetail',
        scoreFormat: { numberFormatType: 'NUMERIC', numDecimalPlaces: 0 },
        sortRank: 0,
        name: {
          kind: 'gamesConfiguration#localizedStringBundle',
          translations: Object.entries(lb.name).map(([locale, value]) => ({
            kind: 'gamesConfiguration#localizedString',
            locale, value,
          })),
        },
      },
    };
    let id;
    if (existing) {
      // PUT requires the full existing resource (id + token) — Google's
      // gateway silently strips the path id otherwise and 404s with
      // "ID  was not found". Echo back the existing body and overwrite
      // the fields we want to mutate.
      const updated = JSON.parse(JSON.stringify(existing));
      updated.scoreOrder = body.scoreOrder;
      updated.draft.name = body.draft.name;
      await call(client, 'PUT', `${API}/leaderboards/${existing.id}`, updated);
      id = existing.id;
      console.log(`  ↺ ${lb.leaderboardId} → ${id}`);
    } else {
      const created = await call(client, 'POST', `${API}/applications/${APP_ID}/leaderboards`, body);
      id = created.id;
      console.log(`  + ${lb.leaderboardId} → ${id}`);
    }
    lbResults[lb.leaderboardId] = id;
  }

  // --- Achievements -------------------------------------------------------
  console.log('→ Listing existing achievements…');
  const achList = await call(client, 'GET', `${API}/applications/${APP_ID}/achievements`);
  const achResults = {};
  for (const a of ACHIEVEMENTS) {
    const enUsName = a.l['en-US'][0];
    const existing = findExisting(achList.items, enUsName);
    const body = {
      kind: 'gamesConfiguration#achievementConfiguration',
      achievementType: 'STANDARD',
      initialState: 'HIDDEN',
      stepsToUnlock: 1,
      draft: {
        kind: 'gamesConfiguration#achievementConfigurationDetail',
        pointValue: a.points,
        sortRank: 0,
        name: {
          kind: 'gamesConfiguration#localizedStringBundle',
          translations: Object.entries(a.l).map(([locale, [n]]) => ({
            kind: 'gamesConfiguration#localizedString',
            locale, value: n,
          })),
        },
        description: {
          kind: 'gamesConfiguration#localizedStringBundle',
          translations: Object.entries(a.l).map(([locale, [, d]]) => ({
            kind: 'gamesConfiguration#localizedString',
            locale, value: d,
          })),
        },
      },
    };
    let id;
    if (existing) {
      // Same gotcha as leaderboards — echo back the existing object and
      // overwrite only the mutable parts.
      const updated = JSON.parse(JSON.stringify(existing));
      updated.draft.pointValue = body.draft.pointValue;
      updated.draft.name = body.draft.name;
      updated.draft.description = body.draft.description;
      await call(client, 'PUT', `${API}/achievements/${existing.id}`, updated);
      id = existing.id;
      console.log(`  ↺ ${a.id} → ${id}`);
    } else {
      const created = await call(client, 'POST', `${API}/applications/${APP_ID}/achievements`, body);
      id = created.id;
      console.log(`  + ${a.id} → ${id}`);
    }
    achResults[a.id] = id;
  }

  // --- Output -------------------------------------------------------------
  console.log('\n=== Hash IDs (paste into your LeaderboardService Android map) ===');
  console.log('\n// Leaderboards');
  for (const [k, v] of Object.entries(lbResults)) console.log(`  ${k}: '${v}'`);
  console.log('\n// Achievements');
  for (const [k, v] of Object.entries(achResults)) console.log(`  ${k}: '${v}'`);

  console.log(
    '\n✅ Play Games Services config registered (draft).' +
      '\n   Final step (UI only — Google has no publish API for this):' +
      '\n   Play Console → Play Games Services → Setup and management →' +
      '\n   Publish.',
  );
}

main().catch((err) => {
  const msg = err.response?.data
    ? JSON.stringify(err.response.data, null, 2)
    : err.message;
  console.error('\n❌', msg);
  process.exit(1);
});
