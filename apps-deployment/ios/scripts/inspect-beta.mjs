import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
const KEY_ID=process.env.ASC_API_KEY, ISSUER_ID=process.env.ASC_API_ISSUER, BUNDLE_ID=process.env.ASC_BUNDLE_ID;
const KEY_PATH=path.join(os.homedir(),'.appstoreconnect/private_keys',`AuthKey_${KEY_ID}.p8`);
const API='https://api.appstoreconnect.apple.com/v1';
function tok(){return jwt.sign({},fs.readFileSync(KEY_PATH,'utf8'),{algorithm:'ES256',expiresIn:'15m',audience:'appstoreconnect-v1',issuer:ISSUER_ID,keyid:KEY_ID});}
async function get(p){const r=await fetch(API+p,{headers:{Authorization:`Bearer ${tok()}`}});return r.json();}
const a=(await get(`/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0];
console.log('App:',a.id);
const loc=await get(`/apps/${a.id}/betaAppLocalizations`);
console.log('betaAppLocalizations:', JSON.stringify(loc.data.map(d=>({locale:d.attributes.locale,...d.attributes})),null,2));
const li=await get(`/apps/${a.id}/betaLicenseAgreement`);
console.log('betaLicenseAgreement:', JSON.stringify(li.data?.attributes,null,2));
const builds=await get(`/builds?filter[app]=${a.id}&sort=-uploadedDate&limit=2`);
const b=builds.data[0];
console.log('latest build:',b.attributes.version, b.id);
const bbl=await get(`/builds/${b.id}/betaBuildLocalizations`);
console.log('betaBuildLocalizations:', JSON.stringify(bbl.data.map(d=>d.attributes),null,2));
const bd=await get(`/builds/${b.id}/betaBuildDetails`);
console.log('betaBuildDetails:', JSON.stringify(bd.data?.attributes,null,2));
