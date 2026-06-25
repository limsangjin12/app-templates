#!/usr/bin/env node
// Verify S3 website URL-prefix properties with the Google Site Verification API.
//
// Configure properties with SEARCH_CONSOLE_PROPERTIES:
//   label=https_or_http_url;label2=https_or_http_url2
//
// Example:
//   SEARCH_CONSOLE_PROPERTIES='my-app=http://bucket.s3-website.region.amazonaws.com/my-app/' \
//   node verify-search-console.mjs

import { GoogleAuth } from 'google-auth-library';

const scopes = ['https://www.googleapis.com/auth/siteverification'];

function configuredProperties() {
  const raw = process.env.SEARCH_CONSOLE_PROPERTIES || '';
  return raw
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const eq = entry.indexOf('=');
      if (eq === -1) return { label: entry, site: entry };
      return {
        label: entry.slice(0, eq),
        site: entry.slice(eq + 1),
      };
    });
}

const properties = configuredProperties();

if (properties.length === 0) {
  console.error('Set SEARCH_CONSOLE_PROPERTIES before running this script.');
  console.error('Example: SEARCH_CONSOLE_PROPERTIES="my-app=http://bucket.s3-website.region.amazonaws.com/my-app/" node verify-search-console.mjs');
  process.exit(1);
}

const auth = new GoogleAuth({ scopes });
const client = await auth.getClient();

async function request(path, options = {}) {
  const url = `https://www.googleapis.com/siteVerification/v1${path}`;
  const response = await client.request({ url, ...options });
  return response.data;
}

for (const property of properties) {
  console.log(`Verifying ${property.label}: ${property.site}`);
  await request('/webResource?verificationMethod=FILE', {
    method: 'POST',
    data: {
      site: { type: 'SITE', identifier: property.site },
    },
  });
  console.log(`Verified ${property.site}`);
}

