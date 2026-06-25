#!/usr/bin/env node
// "Update" the Google OAuth Consent Screen branding (homepage / privacy /
// terms URLs) for every app that uses Google OAuth.
//
// Honest disclosure: as of late 2025 the OAuth consent screen URL fields
// (Application home page, Privacy policy URL, Terms of service URL) are
// NOT exposed by any public Google Cloud API. The IAP brands API only
// surfaces applicationTitle + supportEmail. Other Google docs occasionally
// hint at an Identity API for branding, but it's preview-only and locked
// to allow-listed Workspace customers.
//
// So: this script is a thin helper that prints exactly what to paste where
// and (with --open) launches the right GCP Console URL in your browser.
// Treat it as "consistency check + clipboard prep" rather than automation.
//
// Run:
//   cd infra/scripts
//   node update-oauth-consent.mjs           # print todos for all OAuth apps
//   node update-oauth-consent.mjs --open    # also open the GCP Console pages
//   node update-oauth-consent.mjs --app=gomoku

import { execSync } from 'node:child_process';
import { APPS } from './apps-config.mjs';

const args = new Set(process.argv.slice(2));
const OPEN = args.has('--open');
const ONLY = [...args].find(a => a.startsWith('--app='))?.slice('--app='.length);

function brandingUrl(projectId) {
  // The new "Auth → Branding" page (replaces the older OAuth consent screen UI).
  return `https://console.cloud.google.com/auth/branding?project=${encodeURIComponent(projectId)}`;
}

function printApp(app) {
  console.log(`\n── ${app.name} (project: ${app.gcpProjectId})`);
  console.log(`   Application home page:  ${app.urls.home}`);
  console.log(`   Privacy policy URL:     ${app.urls.privacy}`);
  if (app.urls.terms) {
    console.log(`   Terms of service URL:   ${app.urls.terms}`);
  }
  const url = brandingUrl(app.gcpProjectId);
  console.log(`   Branding page:          ${url}`);
  console.log(`\n   Authorized domains tab — make sure this is listed:`);
  const hostname = new URL(app.urls.home).hostname;
  console.log(`     ${hostname}`);
  console.log(`   (S3 website endpoints are AWS-owned domains and Google may`);
  console.log(`    refuse to authorize them. If so, only Testing-mode publish`);
  console.log(`    works. For Production publish: bring your own custom domain`);
  console.log(`    + HTTPS via CloudFront + ACM, then re-verify in Search`);
  console.log(`    Console + add to Authorized domains here.)`);

  if (OPEN) {
    try {
      execSync(`open '${url}'`);
      console.log(`\n   (opened in browser)`);
    } catch {}
  }
}

function main() {
  let apps = APPS.filter(a => a.hasOAuthConsent);
  if (ONLY) apps = apps.filter(a => a.name === ONLY);

  if (apps.length === 0) {
    if (ONLY) {
      console.error(`No OAuth-enabled app matches --app=${ONLY}.`);
      console.error(`OAuth-enabled apps: ${APPS.filter(a => a.hasOAuthConsent).map(a => a.name).join(', ') || '(none)'}`);
    } else {
      console.log('No apps in apps-config.mjs have hasOAuthConsent: true.');
    }
    process.exit(ONLY ? 1 : 0);
  }

  console.log('OAuth Consent Screen URL fields are UI-only.');
  console.log('Paste the values below into each app\'s GCP Console branding page:');

  for (const app of apps) printApp(app);
}

main();
