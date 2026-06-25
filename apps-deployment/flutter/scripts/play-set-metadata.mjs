#!/usr/bin/env node
// Registers Google Play store listings (title / short / full) per locale via
// the Android Publisher API.
//
// Required env vars:
//   PLAY_PACKAGE_NAME  e.g. com.example.myapp
//   PLAY_SA_KEY        SA JSON path (default ~/.playconsole/<lastSegment>-sa.json)
//
// Listing source — pick one:
//   1) PLAY_LISTINGS=path/to/listings.json
//      JSON shape: { "en-US": {"title":"...","short":"...","full":"..."}, ... }
//
//   2) Default: ./store-listings/play/<play-locale>.json
//      Each file: {"title":"...","short":"...","full":"..."}
//
// Constraints (Play Console):
//   title  ≤ 30 chars
//   short  ≤ 80 chars
//   full   ≤ 4000 chars
//
// Flags:
//   --validate   dry-run (validate + don't commit)
//
// Run:
//   PLAY_PACKAGE_NAME=com.example.myapp \
//   node /path/to/apps-deployment/flutter/scripts/play-set-metadata.mjs

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

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const VALIDATE_ONLY = args.has('--validate');

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

function loadListings() {
  if (process.env.PLAY_LISTINGS) {
    return JSON.parse(fs.readFileSync(process.env.PLAY_LISTINGS, 'utf8'));
  }
  const dir = path.join(ROOT, 'store-listings/play');
  if (!fs.existsSync(dir)) {
    console.error(
      `❌ No listings source found.\n` +
        `   Provide PLAY_LISTINGS=<json file>, or place ` +
        `<play-locale>.json files under ${dir}/.`,
    );
    process.exit(2);
  }
  const out = {};
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.json')) continue;
    out[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  return out;
}

async function newAuthClient() {
  if (!fs.existsSync(SA_KEY_PATH)) {
    throw new Error(`SA key not found at ${SA_KEY_PATH}.`);
  }
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
  const res = await client.request({ url: `${API}${pathname}`, method, data: body });
  return res.data;
}

function validate(locale, listing) {
  const errs = [];
  if (!listing.title) errs.push('missing title');
  else if (listing.title.length > 30) errs.push(`title > 30 (${listing.title.length})`);
  if (!listing.short) errs.push('missing short');
  else if (listing.short.length > 80) errs.push(`short > 80 (${listing.short.length})`);
  if (!listing.full) errs.push('missing full');
  else if (listing.full.length > 4000) errs.push(`full > 4000 (${listing.full.length})`);
  if (errs.length) throw new Error(`${locale}: ${errs.join(', ')}`);
}

async function main() {
  const listings = loadListings();
  for (const [loc, l] of Object.entries(listings)) validate(loc, l);

  console.log(`→ Authorizing (SA: ${path.basename(SA_KEY_PATH)})…`);
  const client = await newAuthClient();

  console.log('→ Creating edit…');
  const edit = await call(client, 'POST', `/applications/${PACKAGE_NAME}/edits`, {});
  console.log(`  Edit ${edit.id}`);

  for (const [locale, listing] of Object.entries(listings)) {
    console.log(`  ↺ ${locale}: "${listing.title}"`);
    await call(
      client,
      'PUT',
      `/applications/${PACKAGE_NAME}/edits/${edit.id}/listings/${locale}`,
      {
        language: locale,
        title: listing.title,
        shortDescription: listing.short,
        fullDescription: listing.full,
      },
    );
  }

  if (VALIDATE_ONLY) {
    console.log('→ Validating (no commit)…');
    await call(client, 'POST', `/applications/${PACKAGE_NAME}/edits/${edit.id}:validate`, {});
    console.log('✅ Validation passed.');
  } else {
    console.log('→ Committing edit…');
    await call(client, 'POST', `/applications/${PACKAGE_NAME}/edits/${edit.id}:commit`, {});
    console.log('✅ Listings published.');
  }
}

main().catch((err) => {
  const msg = err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message;
  console.error('\n❌', msg);
  process.exit(1);
});
