import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
const KEY_ID=process.env.ASC_API_KEY, ISSUER_ID=process.env.ASC_API_ISSUER, BUNDLE_ID=process.env.ASC_BUNDLE_ID;
const KEY_PATH=path.join(os.homedir(),'.appstoreconnect/private_keys',`AuthKey_${KEY_ID}.p8`);
function tok(){return jwt.sign({},fs.readFileSync(KEY_PATH,'utf8'),{algorithm:'ES256',expiresIn:'15m',audience:'appstoreconnect-v1',issuer:ISSUER_ID,keyid:KEY_ID});}
async function get(p){const r=await fetch('https://api.appstoreconnect.apple.com/v1'+p,{headers:{Authorization:`Bearer ${tok()}`}});return r.json();}
const a=(await get(`/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0];
const rd=await get(`/apps/${a.id}/betaAppReviewDetail`);
console.log('betaAppReviewDetail:', JSON.stringify(rd,null,2));
