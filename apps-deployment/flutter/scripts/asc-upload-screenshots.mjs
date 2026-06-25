#!/usr/bin/env node
// Uploads localized App Store screenshots via the ASC API.
//
// Required env vars:
//   ASC_API_KEY     ASC API Key ID, e.g. <KEY_ID>
//   ASC_API_ISSUER  Issuer UUID
//   ASC_BUNDLE_ID   App's bundleId, e.g. com.example.myapp
//
// Optional env vars:
//   ASC_KEY_PATH    p8 file path (default ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8)
//
// Directory layout:
//   <root>/
//     en-US/iphone_*.png  ipad_*.png   (any png/jpg sorted alphabetically)
//     ko/...
//     ja/...
//     zh-Hans/...
//     zh-Hant/...
//
// Device type auto-detected from dimensions:
//   1320×2868 / 1290×2796 / 1242×2688 → iPhone (APP_IPHONE_67/65)
//   2064×2752 / 2048×2732             → iPad Pro 13" (APP_IPAD_PRO_3GEN_129)
//
// Flags:
//   --dir=<path>      root (default: ./screenshots)
//   --locale=<code>   only this locale
//   --metadata=<path> locale list source when using --fallback-locale
//   --fallback-locale=<code>
//                    if a locale folder is missing, reuse screenshots from this locale
//   --clean           delete existing before upload
//   --dry-run         scan only

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const KEY_ID    = process.env.ASC_API_KEY;
const ISSUER_ID = process.env.ASC_API_ISSUER;
const BUNDLE_ID = process.env.ASC_BUNDLE_ID;
if (!KEY_ID || !ISSUER_ID || !BUNDLE_ID) {
  console.error('❌ ASC_API_KEY, ASC_API_ISSUER, ASC_BUNDLE_ID env vars required.');
  process.exit(2);
}
const PLATFORM = (process.env.ASC_PLATFORM || 'IOS').toUpperCase();
const PLATFORM_FILTER = PLATFORM === 'MACOS' ? 'MAC_OS' : PLATFORM;
const KEY_PATH = process.env.ASC_KEY_PATH ||
  path.join(os.homedir(), '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);

const API = 'https://api.appstoreconnect.apple.com/v1';

const argv = process.argv.slice(2);
function flag(name) { return argv.includes(name); }
function value(name, fallback) {
  for (const a of argv) {
    if (a === name) {
      const i = argv.indexOf(a);
      return argv[i + 1];
    }
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return fallback;
}
const ROOT     = path.resolve(value('--dir', path.join(process.cwd(), 'screenshots')));
const ONLY_LOC = value('--locale', null);
const METADATA_PATH = path.resolve(value('--metadata', path.join(process.cwd(), 'store-listings', 'asc-metadata.json')));
const FALLBACK_LOCALE = value('--fallback-locale', null);
const CLEAN    = flag('--clean');
const DRY_RUN  = flag('--dry-run');

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
  const retryStatuses = new Set([401, 429, 500, 502, 503, 504]);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = newToken();
    const res = await fetch(`${API}${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) {
      if (res.status === 204) return null;
      return res.json();
    }
    const text = await res.text();
    if (!retryStatuses.has(res.status) || attempt === 7) {
      throw new Error(`${method} ${pathname} → ${res.status}: ${text}`);
    }
    const retryAfter = Number.parseInt(res.headers.get('retry-after') || '', 10);
    const delayMs = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : (res.status === 429 ? 5000 : 1000) * 2 ** attempt;
    console.log(`    ↳ ASC ${res.status}; retrying in ${delayMs}ms (${attempt + 1}/7)`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

const DEVICE_TYPES = new Map([
  ['1320x2868', 'APP_IPHONE_67'],
  ['1290x2796', 'APP_IPHONE_67'],
  ['1242x2688', 'APP_IPHONE_65'],
  ['2064x2752', 'APP_IPAD_PRO_3GEN_129'],
  ['2048x2732', 'APP_IPAD_PRO_3GEN_129'],
  ['2868x1320', 'APP_IPHONE_67'],
  ['2796x1290', 'APP_IPHONE_67'],
  ['2688x1242', 'APP_IPHONE_65'],
  ['2752x2064', 'APP_IPAD_PRO_3GEN_129'],
  ['2732x2048', 'APP_IPAD_PRO_3GEN_129'],
  ['2880x1800', 'APP_DESKTOP'],
  ['2560x1600', 'APP_DESKTOP'],
  ['1440x900',  'APP_DESKTOP'],
  ['1280x800',  'APP_DESKTOP'],
  // Apple Watch
  ['422x514',   'APP_WATCH_ULTRA'],         // Ultra 3 / Series 11 49mm
  ['410x502',   'APP_WATCH_ULTRA'],         // Ultra / Ultra 2 49mm, S7+ 45mm
  ['416x496',   'APP_WATCH_SERIES_10'],     // Series 10 46mm
  ['396x484',   'APP_WATCH_SERIES_4'],      // Series 4-6 44mm, SE
  ['368x448',   'APP_WATCH_SERIES_4'],      // 40mm S4-6
  ['312x390',   'APP_WATCH_SERIES_3'],      // S3 38mm
]);

function readImageDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504E47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xFF) break;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if ((marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  throw new Error(`Unsupported image: ${filePath}`);
}

const detect = (d) => DEVICE_TYPES.get(`${d.width}x${d.height}`) || null;

async function findApp() {
  const r = await asc('GET', `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
  if (!r.data.length) throw new Error(`No app for bundleId=${BUNDLE_ID}`);
  return r.data[0];
}
async function findEditableVersion(appId) {
  const r = await asc('GET',
    `/apps/${appId}/appStoreVersions?filter[platform]=${PLATFORM_FILTER}&filter[appStoreState]=PREPARE_FOR_SUBMISSION,WAITING_FOR_REVIEW,METADATA_REJECTED,DEVELOPER_REJECTED,REJECTED,INVALID_BINARY&limit=5`);
  if (!r.data.length) throw new Error(`No editable ${PLATFORM_FILTER} appStoreVersion`);
  return r.data[0];
}
async function getOrCreateLoc(versionId, locale) {
  const r = await asc('GET', `/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200`);
  let loc = r.data.find(l => l.attributes.locale === locale);
  if (loc) return loc;
  const c = await asc('POST', '/appStoreVersionLocalizations', {
    data: { type: 'appStoreVersionLocalizations', attributes: { locale },
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } } }
  });
  return c.data;
}
async function getOrCreateSet(locId, displayType) {
  const r = await asc('GET', `/appStoreVersionLocalizations/${locId}/appScreenshotSets?limit=50`);
  let s = r.data.find(x => x.attributes.screenshotDisplayType === displayType);
  if (s) return s;
  const c = await asc('POST', '/appScreenshotSets', {
    data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: displayType },
      relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: locId } } } }
  });
  return c.data;
}
async function listShots(setId) {
  return (await asc('GET', `/appScreenshotSets/${setId}/appScreenshots?limit=50`)).data;
}
async function deleteShot(id) { await asc('DELETE', `/appScreenshots/${id}`); }
async function reserveShot(setId, fileName, fileSize) {
  return (await asc('POST', '/appScreenshots', {
    data: { type: 'appScreenshots', attributes: { fileName, fileSize },
      relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } } }
  })).data;
}
async function putChunk(op, buf) {
  const headers = {};
  for (const h of op.requestHeaders || []) headers[h.name] = h.value;
  const res = await fetch(op.url, { method: op.method, headers, body: buf.subarray(op.offset, op.offset + op.length) });
  if (!res.ok) throw new Error(`PUT chunk ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
async function commitShot(id, md5Hex) {
  await asc('PATCH', `/appScreenshots/${id}`, {
    data: { type: 'appScreenshots', id, attributes: { uploaded: true, sourceFileChecksum: md5Hex } }
  });
}
async function reorder(setId, ids) {
  await asc('PATCH', `/appScreenshotSets/${setId}/relationships/appScreenshots`, {
    data: ids.map(id => ({ type: 'appScreenshots', id }))
  });
}

async function main() {
  if (!fs.existsSync(ROOT)) {
    console.error(`❌ ${ROOT} not found`);
    process.exit(1);
  }
  const folderLocales = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name)
    .filter(n => !ONLY_LOC || n === ONLY_LOC);
  let locales = folderLocales;
  if (FALLBACK_LOCALE) {
    if (!fs.existsSync(path.join(ROOT, FALLBACK_LOCALE))) {
      throw new Error(`fallback locale folder not found: ${path.join(ROOT, FALLBACK_LOCALE)}`);
    }
    if (fs.existsSync(METADATA_PATH)) {
      const meta = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8'));
      locales = Object.keys(meta.locales || {}).filter(n => !ONLY_LOC || n === ONLY_LOC);
    }
  }

  console.log('→ Locating app…');
  const app = DRY_RUN ? null : await findApp();
  if (app) console.log(`  App: ${app.attributes.name} (id=${app.id})`);
  const version = DRY_RUN ? null : await findEditableVersion(app.id);
  if (version) console.log(`  Version: ${version.attributes.versionString} state=${version.attributes.appStoreState}`);

  for (const locale of locales) {
    const ownDir = path.join(ROOT, locale);
    const dir = fs.existsSync(ownDir) ? ownDir : path.join(ROOT, FALLBACK_LOCALE);
    const sourceLocale = path.basename(dir);
    const files = fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg)$/i.test(f)).sort();
    if (!files.length) { console.log(`— ${locale}: empty`); continue; }
    const groups = new Map();
    for (const f of files) {
      const full = path.join(dir, f);
      const dim = readImageDimensions(full);
      const t = detect(dim);
      if (!t) { console.log(`  ⚠  ${locale}/${f}: ${dim.width}×${dim.height} unrecognized`); continue; }
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push({ name: f, full });
    }
    const sourceNote = sourceLocale === locale ? '' : ` (using ${sourceLocale})`;
    console.log(`\n📦 ${locale}${sourceNote}: ${[...groups.entries()].map(([t, a]) => `${t}×${a.length}`).join(', ')}`);
    if (DRY_RUN) continue;

    const loc = await getOrCreateLoc(version.id, locale);
    for (const [type, items] of groups) {
      const set = await getOrCreateSet(loc.id, type);
      if (CLEAN) {
        const existing = await listShots(set.id);
        for (const sc of existing) await deleteShot(sc.id);
      } else {
        const existing = await listShots(set.id);
        if (existing.length) { console.log(`  ⏭  ${type}: already has ${existing.length}, skip`); continue; }
      }
      const ids = [];
      for (const item of items) {
        const buf = fs.readFileSync(item.full);
        const md5 = crypto.createHash('md5').update(buf).digest('hex');
        console.log(`  ↑ ${type}: ${item.name} (${(buf.length/1024).toFixed(0)} KB)`);
        const r = await reserveShot(set.id, item.name, buf.length);
        for (const op of r.attributes.uploadOperations) await putChunk(op, buf);
        await commitShot(r.id, md5);
        ids.push(r.id);
      }
      if (ids.length > 1) await reorder(set.id, ids);
    }
  }
  console.log(DRY_RUN ? '\n✅ Dry run complete.' : '\n✅ Upload complete.');
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
