// Shared configuration for infra/scripts/*.
//
// Add one object per app. Keep secrets outside the repo; values here are public
// identifiers and local secret file names only.

// Set APPS_WEB_BASE_URL to the chosen provider origin:
// - Netlify: https://example.netlify.app
// - Vercel: https://example.vercel.app
// - AWS S3 website: http://<bucket>.s3-website.<region>.amazonaws.com
const baseUrl = (process.env.APPS_WEB_BASE_URL || 'https://<hosting-provider-host>')
  .replace(/\/$/, '');

export function urls(prefix, opts = {}) {
  const base = `${baseUrl}/${prefix}`;
  return {
    home: `${base}/`,
    privacy: `${base}/privacy.html`,
    terms: opts.terms ? `${base}/terms.html` : null,
    accountDeletion: opts.accountDeletion ? `${base}/account-deletion.html` : null,
    support: opts.supportUrl || `${base}/`,
  };
}

export const APPS = [
  // Example:
  // {
  //   name: 'my-app',
  //   bundleId: 'com.example.myapp',
  //   packageName: 'com.example.myapp',
  //   playSaKey: 'my-play-service-account.json',
  //   gcpProjectId: null,
  //   hasOAuthConsent: false,
  //   urls: urls('my-app'),
  // },
];

export const ASC = {
  keyId: process.env.ASC_API_KEY || '',
  issuerId: process.env.ASC_API_ISSUER || '',
  keyPath: process.env.ASC_KEY_PATH || '',
};
