#!/usr/bin/env node
// Registers Game Center leaderboards via the App Store Connect API.
// Idempotent — re-run after editing the listings file to add/update.
//
// **Manual prerequisites (one-time, Xcode + ASC UI)**:
//   1. Xcode → target capabilities → enable "Game Center" (writes
//      `com.apple.developer.game-center` to Runner.entitlements).
//   2. App Store Connect → app → Services → Game Center → enable.
//      That creates the per-app `gameCenterDetail` resource the API needs.
//
// Required env vars (same as the other asc-* scripts):
//   ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID
//
// Optional:
//   ASC_KEY_PATH (default ~/.appstoreconnect/private_keys/AuthKey_<KEY>.p8)
//   --listings=<path>  default: ./store-listings/asc-game-center.json
//
// Listings schema (per-app, lives in <app>/store-listings/asc-game-center.json):
//   {
//     "leaderboards": [
//       {
//         "vendorIdentifier": "com.example.app.score.size6",
//         "referenceName": "App 6x6 Best",          // internal, ASC-unique
//         "submissionType": "BEST_SCORE",            // or MOST_RECENT_SCORE
//         "scoreSortType": "DESC",                   // or ASC
//         "defaultFormatter": "INTEGER",             // INTEGER / FIXED_POINT / TIME / etc.
//         "scoreRangeStart": "0",                    // optional
//         "scoreRangeEnd": "999999",                 // optional
//         "name": {
//           "en-US": "6×6 Best",
//           "ko": "6×6 최고",
//           ...
//         }
//       }
//     ],
//     "achievements": [
//       {
//         "vendorIdentifier": "com.example.app.first_win",
//         "referenceName": "first-win",
//         "points": 10,
//         "repeatable": false,            // optional, default false
//         "showBeforeEarned": true,       // optional, default true
//         "localizations": {
//           "en-US": {
//             "name": "First Victory",
//             "beforeEarnedDescription": "Win your first game.",
//             "afterEarnedDescription": "You won your first game."
//           },
//           "ko": { "name": "첫 승리", "beforeEarnedDescription": "...", "afterEarnedDescription": "..." }
//         }
//       }
//     ]
//   }
//
// Note: ASC Game Center uses Apple-style locale codes (e.g., `ko`, `ja`,
// `zh-Hans`, `zh-Hant`). Different from Play Games' hyphen-region form.
//
// Run from the Flutter project root:
//   ASC_API_KEY=... ASC_API_ISSUER=... ASC_BUNDLE_ID=... \
//     node $APPS_DEPLOY_DIR/flutter/scripts/asc-set-game-center.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const KEY_ID = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID) {
  console.error('❌ ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID env vars required.');
  process.exit(2);
}
const KEY_PATH =
  process.env.ASC_KEY_PATH ||
  path.join(os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => (a.startsWith('--') ? a.slice(2).split('=') : [a, true])),
);
const LISTINGS_PATH = path.resolve(
  args.listings || path.join(process.cwd(), 'store-listings', 'asc-game-center.json'),
);
if (!fs.existsSync(LISTINGS_PATH)) {
  console.error(`❌ Listings not found: ${LISTINGS_PATH}`);
  console.error('   Provide --listings=<path>, or place store-listings/asc-game-center.json.');
  process.exit(2);
}
const cfg = JSON.parse(fs.readFileSync(LISTINGS_PATH, 'utf8'));
const LEADERBOARDS = cfg.leaderboards || [];
const ACHIEVEMENTS = cfg.achievements || [];
if (!LEADERBOARDS.length && !ACHIEVEMENTS.length) {
  console.error('❌ Listings has neither `leaderboards` nor `achievements`.');
  process.exit(2);
}

const API = 'https://api.appstoreconnect.apple.com/v1';

function newToken() {
  const key = fs.readFileSync(KEY_PATH, 'utf8');
  return jwt.sign({}, key, {
    algorithm: 'ES256',
    expiresIn: '15m',
    audience: 'appstoreconnect-v1',
    issuer: ISSUER_ID,
    keyid: KEY_ID,
  });
}

async function asc(method, pathname, body) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${newToken()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${pathname} → ${res.status}: ${await res.text()}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function fetchAllPages(pathname) {
  const all = [];
  let next = `${pathname}${pathname.includes('?') ? '&' : '?'}limit=200`;
  while (next) {
    const page = await asc('GET', next);
    all.push(...page.data);
    const nextUrl = page.links?.next;
    if (!nextUrl) break;
    // links.next is absolute — strip the API base for our helper.
    next = nextUrl.startsWith(API) ? nextUrl.slice(API.length) : nextUrl;
  }
  return all;
}

async function main() {
  console.log(`Loading leaderboards from ${LISTINGS_PATH}`);

  console.log('→ Locating app by bundle ID…');
  const apps = await asc(
    'GET',
    `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`,
  );
  if (!apps.data.length) throw new Error(`No app found for bundleId=${BUNDLE_ID}`);
  const app = apps.data[0];
  console.log(`  App: ${app.attributes.name}  (id=${app.id})`);

  console.log('→ Ensuring gameCenterDetail…');
  let gcdRes = await asc('GET', `/apps/${app.id}/gameCenterDetail`);
  let gcdId;
  if (gcdRes.data) {
    gcdId = gcdRes.data.id;
    console.log(`  gameCenterDetail id=${gcdId}`);
  } else {
    console.log('  + creating gameCenterDetail…');
    const created = await asc('POST', '/gameCenterDetails', {
      data: {
        type: 'gameCenterDetails',
        relationships: { app: { data: { type: 'apps', id: app.id } } },
      },
    });
    gcdId = created.data.id;
    console.log(`  gameCenterDetail id=${gcdId}`);
  }

  if (!LEADERBOARDS.length) {
    console.log('→ No leaderboards in config, skipping leaderboard sync.');
  } else {
    console.log('→ Listing existing leaderboards…');
  }
  const existing = LEADERBOARDS.length
    ? await fetchAllPages(`/gameCenterDetails/${gcdId}/gameCenterLeaderboards`)
    : [];
  const byVendor = new Map(
    existing.map((lb) => [lb.attributes.vendorIdentifier, lb]),
  );

  const results = {};
  for (const lb of LEADERBOARDS) {
    const ven = lb.vendorIdentifier;
    const found = byVendor.get(ven);
    let id;
    const attrs = {
      vendorIdentifier: ven,
      referenceName: lb.referenceName,
      submissionType: lb.submissionType || 'BEST_SCORE',
      // ASC API attribute names (do not match the human "Sort Order" / "Format"
      // labels in the web UI):
      scoreSortType: lb.scoreSortType || lb.sortOrder || 'DESC',
      defaultFormatter: lb.defaultFormatter || lb.scoreFormat || 'INTEGER',
      ...(lb.scoreRangeStart != null && { scoreRangeStart: String(lb.scoreRangeStart) }),
      ...(lb.scoreRangeEnd != null && { scoreRangeEnd: String(lb.scoreRangeEnd) }),
    };
    if (found) {
      // PATCH only mutable fields. submissionType / defaultFormatter /
      // scoreSortType are immutable on existing leaderboards — skip them.
      const patchAttrs = { referenceName: attrs.referenceName };
      if (attrs.scoreRangeStart) patchAttrs.scoreRangeStart = attrs.scoreRangeStart;
      if (attrs.scoreRangeEnd) patchAttrs.scoreRangeEnd = attrs.scoreRangeEnd;
      await asc('PATCH', `/gameCenterLeaderboards/${found.id}`, {
        data: {
          type: 'gameCenterLeaderboards',
          id: found.id,
          attributes: patchAttrs,
        },
      });
      id = found.id;
      console.log(`  ↺ ${ven} → ${id}`);
    } else {
      const created = await asc('POST', '/gameCenterLeaderboards', {
        data: {
          type: 'gameCenterLeaderboards',
          attributes: attrs,
          relationships: {
            gameCenterDetail: {
              data: { type: 'gameCenterDetails', id: gcdId },
            },
          },
        },
      });
      id = created.data.id;
      console.log(`  + ${ven} → ${id}`);
    }
    results[ven] = id;

    // Localizations
    const locs = await fetchAllPages(
      `/gameCenterLeaderboards/${id}/localizations`,
    );
    const byLocale = new Map(locs.map((l) => [l.attributes.locale, l]));
    for (const [locale, name] of Object.entries(lb.name || {})) {
      const exists = byLocale.get(locale);
      if (exists) {
        await asc('PATCH', `/gameCenterLeaderboardLocalizations/${exists.id}`, {
          data: {
            type: 'gameCenterLeaderboardLocalizations',
            id: exists.id,
            attributes: { name },
          },
        });
        console.log(`    · ${locale} ↺ "${name}"`);
      } else {
        await asc('POST', '/gameCenterLeaderboardLocalizations', {
          data: {
            type: 'gameCenterLeaderboardLocalizations',
            attributes: { locale, name },
            relationships: {
              gameCenterLeaderboard: {
                data: { type: 'gameCenterLeaderboards', id },
              },
            },
          },
        });
        console.log(`    · ${locale} + "${name}"`);
      }
    }
  }

  if (Object.keys(results).length) {
    console.log('\n=== ASC Game Center leaderboard IDs ===');
    for (const [k, v] of Object.entries(results)) console.log(`  ${k}: ${v}`);
  }

  // ── Achievements ──
  if (ACHIEVEMENTS.length) {
    console.log('→ Listing existing achievements…');
    const exAch = await fetchAllPages(
      `/gameCenterDetails/${gcdId}/gameCenterAchievements`,
    );
    const byVendorAch = new Map(
      exAch.map((a) => [a.attributes.vendorIdentifier, a]),
    );
    const achResults = {};
    for (const ach of ACHIEVEMENTS) {
      const ven = ach.vendorIdentifier;
      const found = byVendorAch.get(ven);
      const attrs = {
        vendorIdentifier: ven,
        referenceName: ach.referenceName,
        points: ach.points,
        repeatable: ach.repeatable ?? false,
        showBeforeEarned: ach.showBeforeEarned ?? true,
      };
      let id;
      if (found) {
        // PATCH only mutable fields. vendorIdentifier is immutable.
        const patchAttrs = {
          referenceName: attrs.referenceName,
          points: attrs.points,
          repeatable: attrs.repeatable,
          showBeforeEarned: attrs.showBeforeEarned,
        };
        await asc('PATCH', `/gameCenterAchievements/${found.id}`, {
          data: { type: 'gameCenterAchievements', id: found.id, attributes: patchAttrs },
        });
        id = found.id;
        console.log(`  ↺ ${ven} → ${id}`);
      } else {
        const created = await asc('POST', '/gameCenterAchievements', {
          data: {
            type: 'gameCenterAchievements',
            attributes: attrs,
            relationships: {
              gameCenterDetail: { data: { type: 'gameCenterDetails', id: gcdId } },
            },
          },
        });
        id = created.data.id;
        console.log(`  + ${ven} → ${id}`);
      }
      achResults[ven] = id;

      const locs = await fetchAllPages(
        `/gameCenterAchievements/${id}/localizations`,
      );
      const byLocale = new Map(locs.map((l) => [l.attributes.locale, l]));
      for (const [locale, spec] of Object.entries(ach.localizations || {})) {
        const exists = byLocale.get(locale);
        const locAttrs = {
          name: spec.name,
          beforeEarnedDescription: spec.beforeEarnedDescription,
          afterEarnedDescription: spec.afterEarnedDescription,
        };
        if (exists) {
          await asc('PATCH', `/gameCenterAchievementLocalizations/${exists.id}`, {
            data: {
              type: 'gameCenterAchievementLocalizations',
              id: exists.id,
              attributes: locAttrs,
            },
          });
          console.log(`    · ${locale} ↺ "${spec.name}"`);
        } else {
          await asc('POST', '/gameCenterAchievementLocalizations', {
            data: {
              type: 'gameCenterAchievementLocalizations',
              attributes: { locale, ...locAttrs },
              relationships: {
                gameCenterAchievement: {
                  data: { type: 'gameCenterAchievements', id },
                },
              },
            },
          });
          console.log(`    · ${locale} + "${spec.name}"`);
        }
      }
    }
    console.log('\n=== ASC Game Center achievement IDs ===');
    for (const [k, v] of Object.entries(achResults)) console.log(`  ${k}: ${v}`);
  }

  console.log('\n✅ Game Center synced (live).');
}

main().catch((err) => {
  console.error('\n❌', err.message || err);
  process.exit(1);
});
