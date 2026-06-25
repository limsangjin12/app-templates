#!/usr/bin/env node
// Uploads Play Store graphics (screenshots, icon, feature graphic) via the
// Android Publisher API.
//
// Required env vars:
//   PLAY_PACKAGE_NAME  e.g. com.example.myapp
//   PLAY_SA_KEY        path to SA JSON (default ~/.playconsole/<lastSegment>-sa.json)
//
// Optional env vars:
//   SCREENSHOTS_DIR    root dir for screenshots (default ./screenshots)
//   ICON_PATH          path to 512×512 icon (default ./store-assets/play_icon_512.png)
//   FEATURE_PATH       path to 1024×500 feature graphic (default ./store-assets/feature_graphic_1024x500.png)
//
// Directory layout expected:
//   <SCREENSHOTS_DIR>/
//     en-US/iphone_*.png   (phone shots, sorted)
//     en-US/ipad_*.png     (tablet shots, sorted)
//     ko/...
//     ja/...
//     zh-Hans/...
//     zh-Hant/...
//
// Filesystem locale → Play locale mapping:
//   en-US → en-US, ko → ko-KR, ja → ja-JP, zh-Hans → zh-CN, zh-Hant → zh-TW
//
// Override mapping via env: PLAY_LOCALE_MAP="en-US:en-US,ko:ko-KR,..."
//
// Flags:
//   --locale=<fs-or-play-locale>   only this locale
//   --dry-run                      scan + report, upload nothing

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JWT } from 'google-auth-library';

const PACKAGE_NAME = process.env.PLAY_PACKAGE_NAME;
if (!PACKAGE_NAME) {
  console.error('❌ PLAY_PACKAGE_NAME env var required.');
  process.exit(2);
}
const SA_KEY_PATH =
  process.env.PLAY_SA_KEY ||
  path.join(os.homedir(), `.playconsole/${PACKAGE_NAME.split('.').pop()}-sa.json`);

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const UPLOAD_API = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3';

const ROOT = process.cwd();
const SCREENSHOTS_DIR = path.resolve(process.env.SCREENSHOTS_DIR || path.join(ROOT, 'screenshots'));
const ICON_PATH = path.resolve(process.env.ICON_PATH || path.join(ROOT, 'store-assets/play_icon_512.png'));
const FEATURE_PATH = path.resolve(process.env.FEATURE_PATH || path.join(ROOT, 'store-assets/feature_graphic_1024x500.png'));

const LOCALE_MAP = (() => {
  if (process.env.PLAY_LOCALE_MAP) {
    const out = {};
    for (const pair of process.env.PLAY_LOCALE_MAP.split(',')) {
      const [k, v] = pair.split(':');
      if (k && v) out[k.trim()] = v.trim();
    }
    return out;
  }
  return {
    'en-US': 'en-US',
    'ko': 'ko-KR',
    'ja': 'ja-JP',
    'zh-Hans': 'zh-CN',
    'zh-Hant': 'zh-TW',
  };
})();

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    if (!a.startsWith('--')) return [a, true];
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  }),
);
const ONLY_LOCALE = args.locale;
const DRY_RUN = args['dry-run'] === true;

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

async function call(client, method, url, body, extra = {}) {
  const res = await client.request({ url, method, data: body, ...extra });
  return res.data;
}

async function commitEdit(client, editId) {
  const commitUrl = `${API}/applications/${PACKAGE_NAME}/edits/${editId}:commit`;
  try {
    await call(client, 'POST', commitUrl, {});
    return 'sent-for-review';
  } catch (e) {
    const message = e.response?.data?.error?.message || '';
    if (!message.includes('changesNotSentForReview')) throw e;
    await call(client, 'POST', `${commitUrl}?changesNotSentForReview=true`, {});
    return 'not-sent-for-review';
  }
}

async function deleteAllImages(client, editId, locale, imageType) {
  const url = `${API}/applications/${PACKAGE_NAME}/edits/${editId}/listings/${locale}/${imageType}`;
  try {
    await client.request({ url, method: 'DELETE' });
  } catch (e) {
    if (e.response?.status !== 404) throw e;
  }
}

async function uploadImage(client, editId, locale, imageType, filePath) {
  const buf = fs.readFileSync(filePath);
  const url = `${UPLOAD_API}/applications/${PACKAGE_NAME}/edits/${editId}/listings/${locale}/${imageType}?uploadType=media`;
  const res = await client.request({
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': buf.length,
    },
    body: buf,
  });
  return res.data;
}

function listFiles(dir, glob) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => glob.test(f)).sort().map((f) => path.join(dir, f));
}

function pngSize(filePath) {
  const buf = fs.readFileSync(filePath);
  const signature = '89504e470d0a1a0a';
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== signature) {
    throw new Error(`${filePath} is not a PNG file.`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function assertPngSize(filePath, width, height, label) {
  const actual = pngSize(filePath);
  if (actual.width !== width || actual.height !== height) {
    throw new Error(
      `${label} must be ${width}×${height}; got ${actual.width}×${actual.height}: ${filePath}`,
    );
  }
}

async function main() {
  if (!fs.existsSync(SA_KEY_PATH)) {
    console.error(`❌ SA key not found: ${SA_KEY_PATH}`);
    process.exit(2);
  }

  if (fs.existsSync(ICON_PATH)) assertPngSize(ICON_PATH, 512, 512, 'Play icon');
  if (fs.existsSync(FEATURE_PATH)) {
    assertPngSize(FEATURE_PATH, 1024, 500, 'Play feature graphic');
  }

  console.log(`→ Authorizing (SA: ${path.basename(SA_KEY_PATH)})…`);
  const client = await newAuthClient();

  console.log('→ Creating edit…');
  const edit = await call(client, 'POST', `${API}/applications/${PACKAGE_NAME}/edits`, {});
  console.log(`  Edit ${edit.id}`);

  for (const [fsLoc, playLoc] of Object.entries(LOCALE_MAP)) {
    if (ONLY_LOCALE && ONLY_LOCALE !== fsLoc && ONLY_LOCALE !== playLoc) continue;

    const dir = path.join(SCREENSHOTS_DIR, fsLoc);
    const phones = listFiles(dir, /^iphone_.*\.png$/i);
    const tablets = listFiles(dir, /^ipad_.*\.png$/i);

    console.log(`\n📦 ${fsLoc} → ${playLoc}: phone×${phones.length}, tablet×${tablets.length}`);

    if (DRY_RUN) {
      phones.forEach((f) => console.log(`  · phoneScreenshots ${path.basename(f)}`));
      tablets.forEach((f) => console.log(`  · tenInchScreenshots ${path.basename(f)}`));
      continue;
    }

    if (phones.length > 0) {
      await deleteAllImages(client, edit.id, playLoc, 'phoneScreenshots');
      for (const f of phones) {
        await uploadImage(client, edit.id, playLoc, 'phoneScreenshots', f);
        console.log(`  ↑ phone: ${path.basename(f)}`);
      }
    }
    // Fill both 7" and 10" tablet slots so Play shows tablet shots
    // regardless of device class.
    if (tablets.length > 0) {
      for (const slot of ['sevenInchScreenshots', 'tenInchScreenshots']) {
        await deleteAllImages(client, edit.id, playLoc, slot);
        for (const f of tablets) {
          await uploadImage(client, edit.id, playLoc, slot, f);
          console.log(`  ↑ ${slot}: ${path.basename(f)}`);
        }
      }
    }
    if (playLoc === 'en-US') {
      if (fs.existsSync(ICON_PATH)) {
        await deleteAllImages(client, edit.id, playLoc, 'icon');
        await uploadImage(client, edit.id, playLoc, 'icon', ICON_PATH);
        console.log(`  ↑ icon: ${path.basename(ICON_PATH)}`);
      }
      if (fs.existsSync(FEATURE_PATH)) {
        await deleteAllImages(client, edit.id, playLoc, 'featureGraphic');
        await uploadImage(client, edit.id, playLoc, 'featureGraphic', FEATURE_PATH);
        console.log(`  ↑ featureGraphic: ${path.basename(FEATURE_PATH)}`);
      }
    }
  }

  if (DRY_RUN) {
    console.log('\n✅ Dry run complete. (Edit not committed.)');
    await client.request({
      url: `${API}/applications/${PACKAGE_NAME}/edits/${edit.id}`,
      method: 'DELETE',
    }).catch(() => {});
    return;
  }

  // Re-assert any non-production track release as draft so commit doesn't
  // try to promote inherited releases.
  for (const tname of ['internal', 'alpha', 'beta']) {
    try {
      const tracks = await call(
        client,
        'GET',
        `${API}/applications/${PACKAGE_NAME}/edits/${edit.id}/tracks/${tname}`,
      );
      if ((tracks.releases || []).length === 0) continue;
      // Play allows only one draft release per track — keep most recent.
      const all = tracks.releases;
      const releases = [{ ...all[all.length - 1], status: 'draft' }];
      await call(
        client,
        'PUT',
        `${API}/applications/${PACKAGE_NAME}/edits/${edit.id}/tracks/${tname}`,
        { track: tname, releases },
      );
    } catch (e) {
      if (e.response?.status !== 404) throw e;
    }
  }

  console.log('\n→ Committing edit…');
  const commitStatus = await commitEdit(client, edit.id);
  if (commitStatus === 'not-sent-for-review') {
    console.log('✅ Graphics committed. Play kept the edit out of review; send it for review in Play Console.');
  } else {
    console.log('✅ Graphics published.');
  }
}

main().catch((err) => {
  const msg = err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message;
  console.error('\n❌', msg);
  process.exit(1);
});
