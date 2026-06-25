#!/usr/bin/env node
// Uploads a signed AAB to Google Play and assigns it to a release track.
//
// Required env vars:
//   PLAY_PACKAGE_NAME  e.g. com.example.myapp
//   PLAY_SA_KEY        path to service account JSON (default ~/.playconsole/<package>-sa.json)
//
// Optional flags:
//   --bundle=<path>           Path to .aab (required)
//   --track=internal          internal | alpha | beta | production (default: internal)
//   --release-name=<text>     Defaults to versionCode
//   --release-notes-file=<p>  JSON {locale: "notes", ...}
//
// Run:
//   PLAY_PACKAGE_NAME=com.example.myapp \
//   node /path/to/apps-deployment/flutter/scripts/play-upload-bundle.mjs \
//     --bundle=build/app/outputs/bundle/release/app-release.aab

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

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    if (!a.startsWith('--')) return [a, true];
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  }),
);

const BUNDLE = args.bundle;
const TRACK = args.track || 'internal';
const RELEASE_NAME = args['release-name'];
const NOTES_FILE = args['release-notes-file'];

if (!BUNDLE) {
  console.error('Usage: --bundle=<path-to-aab>');
  process.exit(2);
}
if (!fs.existsSync(BUNDLE)) {
  console.error(`Bundle not found: ${BUNDLE}`);
  process.exit(2);
}
if (!fs.existsSync(SA_KEY_PATH)) {
  console.error(`SA key not found: ${SA_KEY_PATH}`);
  process.exit(2);
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

async function uploadBundle(client, editId) {
  const buf = fs.readFileSync(BUNDLE);
  const url = `${UPLOAD_API}/applications/${PACKAGE_NAME}/edits/${editId}/bundles?uploadType=media`;
  const res = await client.request({
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': buf.length,
    },
    body: buf,
  });
  return res.data;
}

async function main() {
  console.log(`→ Authorizing (SA: ${path.basename(SA_KEY_PATH)})…`);
  const client = await newAuthClient();

  console.log('→ Creating edit…');
  const edit = await call(client, 'POST', `${API}/applications/${PACKAGE_NAME}/edits`, {});
  console.log(`  Edit ${edit.id}`);

  console.log(`→ Uploading ${path.basename(BUNDLE)} (${(fs.statSync(BUNDLE).size / 1024 / 1024).toFixed(1)} MB)…`);
  const bundle = await uploadBundle(client, edit.id);
  console.log(`  versionCode=${bundle.versionCode}, sha256=${bundle.sha256}`);

  let releaseNotes = [];
  if (NOTES_FILE && fs.existsSync(NOTES_FILE)) {
    const map = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8'));
    releaseNotes = Object.entries(map).map(([language, text]) => ({ language, text }));
  } else {
    releaseNotes = [{ language: 'en-US', text: 'Initial release.' }];
  }

  console.log(`→ Assigning to track: ${TRACK}…`);
  await call(
    client,
    'PUT',
    `${API}/applications/${PACKAGE_NAME}/edits/${edit.id}/tracks/${TRACK}`,
    {
      track: TRACK,
      releases: [
        {
          name: RELEASE_NAME || `${bundle.versionCode}`,
          versionCodes: [String(bundle.versionCode)],
          status: TRACK === 'production' ? 'completed' : 'draft',
          releaseNotes,
        },
      ],
    },
  );

  console.log('→ Committing edit…');
  await call(client, 'POST', `${API}/applications/${PACKAGE_NAME}/edits/${edit.id}:commit`, {});

  console.log(`\n✅ Uploaded versionCode=${bundle.versionCode} to track ${TRACK}.`);
  if (TRACK !== 'production') {
    console.log(`   Promote later: Play Console → Testing → ${TRACK} → Promote release → Production`);
  }
}

main().catch((err) => {
  const msg = err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message;
  console.error('\n❌', msg);
  process.exit(1);
});
