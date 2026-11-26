import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoogleAuth} from '../src/auth.js';
import {DriveAPI} from '../src/drive-api.js';
test('renewal verifies account before replacing token and preserves previous identity on errors',async()=>{
  let next='first',mode='ok';
  const original=globalThis.google;
  globalThis.google={accounts:{oauth2:{
    initTokenClient:opts=>({requestAccessToken:()=>opts.callback({access_token:next,expires_in:3600})}),
    hasGrantedAllScopes:()=>true,revoke:(t,cb)=>cb({})
  }}};
  const auth=new GoogleAuth({},async(url,options)=>{
    assert.match(url,/drive\/v3\/about\?fields=user\(permissionId\)/);
    assert.equal(options.cache,'no-store');
    if(mode==='missing')return Response.json({user:{}});
    if(mode==='error')return new Response('',{status:503});
    return Response.json({user:{permissionId:options.headers.Authorization==='Bearer other'?'B':'A'}});
  });
  try {
    await assert.rejects(auth.renew(),/Connect/);
    await auth.connect();assert.equal(auth.token(),'first');
    next='other';await assert.rejects(auth.renew(),/Different Google account/);
    assert.equal(auth.token(),'first');
    next='second';mode='missing';await assert.rejects(auth.renew(),/identify/);
    assert.equal(auth.token(),'first');
    mode='error';await assert.rejects(auth.renew(),/verify/);
    mode='ok';auth.invalidate('first');assert.equal(auth.status,'expired');
    await auth.renew();assert.equal(auth.token(),'second');
    auth.invalidate('first');assert.equal(auth.token(),'second');
    auth.invalidate('second');assert.equal(auth.status,'expired');
    next='other';await auth.connect();assert.equal(auth.token(),'other');
    auth.disconnect();assert.equal(auth.hasAccount,false);
  } finally {globalThis.google=original;}
});
test('401 reports the exact rejected token, no automatic retry',async()=>{
  let count=0;let rejected;
  const api=new DriveAPI(()=> 'old-token',async()=>{count++;return new Response('',{status:401});},t=>{rejected=t;});
  await assert.rejects(api.metadata('x'),/Renew Google Drive authorization/);
  assert.equal(rejected,'old-token');assert.equal(count,1);
});
