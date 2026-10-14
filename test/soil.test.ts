import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { createSoilVerifier } from '../xtp/soil/server.ts';
import { soilConfig } from '../xtp/soil/config.ts';
import { createSoilClient } from '../xtp/soil/client.js';

test('SO/IL checks signature, audience, client/session binding and revocation on every request',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('EdDSA');
 const issuer='https://soil.example/api/v1',subject='11111111-1111-4111-8111-111111111111',client='client-one';
 const seconds=Math.floor(Date.now()/1000),expires=(seconds+600)*1000;
 const token=await new SignJWT({sid:'session-one',client_id:client,scope:'kash:read vault:read'})
  .setProtectedHeader({alg:'EdDSA'}).setIssuer(issuer).setAudience('kash').setSubject(subject).setIssuedAt(seconds).setExpirationTime(seconds+600).sign(privateKey);
 let value:any={protocol:'soil.session.v1',id:'session-one',client:{id:client},subject,verified:true,active:true,issuer,audience:'kash',expires_at:expires,scopes:['kash:read'],capabilities:['identity','accounts','invented-power']},calls=0,outage=false;
 const verifier=createSoilVerifier({SOIL_API_URL:issuer,SOIL_ISSUER:issuer},{key:publicKey,send:(async(url,options)=>{calls++;assert.equal(url,issuer+'/session');assert.equal(options?.redirect,'error');assert.equal(options?.cache,'no-store');if(outage)throw Error('offline');return Response.json(value);}) as typeof fetch});
 const request=(bearer=token,id=client)=>new Request('https://kash.example/app/api/me',{headers:{authorization:'Bearer '+bearer,'x-soil-client-id':id}});
 assert.deepEqual((await verifier.authenticate(request()))?.capabilities,['identity','accounts']);
 assert.equal((await verifier.authenticate(request()))?.id,'session-one');assert.equal(calls,2);
 await assert.rejects(()=>verifier.authenticate(request('forged')),/invalid or expired/);
 await assert.rejects(()=>verifier.authenticate(request(token,'another-client')),/binding mismatch/);
 const original={...value};for(const change of [{verified:false},{active:false},{id:'another-session'},{subject:'22222222-2222-4222-8222-222222222222'},{expires_at:expires+1},{scopes:['kash:write']},{audience:'another-app'}]){
  value={...original,...change};await assert.rejects(()=>verifier.authenticate(request()));
 }
 value=original;outage=true;await assert.rejects(()=>verifier.authenticate(request()),/unavailable/);
 assert.equal(await verifier.authenticate(new Request('https://kash.example/app/api/me')),null);
});

test('SO/IL configuration rejects credentials and unsafe browser provider URLs',()=>{
 assert.equal(soilConfig({}).appUrl,'https://soil.jah.earth/app');
 for(const v of ['http://remote.example/app','https://user:password@soil.example/app','https://soil.example/app?token=secret','javascript:alert(1)'])assert.throws(()=>soilConfig({SOIL_APP_URL:v}));
});

test('browser SO/IL bridge accepts only the selected view and rejects late verification after disposal',async()=>{
 const listeners=new Set<any>(),messages:any[]=[];const view={postMessage:(data:any,origin:string)=>messages.push({data,origin})};
 const host:any={crypto,setTimeout,clearTimeout,addEventListener:(_:string,fn:any)=>listeners.add(fn),removeEventListener:(_:string,fn:any)=>listeners.delete(fn)};
 let release:any;const send=()=>new Promise<Response>(resolve=>release=resolve);
 const client=createSoilClient({app_url:'https://soil.example/app',audience:'kash'},{host,send,clientId:'client-one'});
 const connected=client.connect(view);const request=messages[0].data;
 const event={origin:'https://soil.example',source:view,data:{type:'soil:session',protocol:1,request_id:request.request_id,token:'candidate'}};
 for(const listener of listeners)await listener({...event,source:{}});assert.equal(release,undefined);
 for(const listener of listeners)await listener({...event,origin:'https://attacker.example'});assert.equal(release,undefined);
 const invoke=[...listeners][0](event);await Promise.resolve();client.dispose();
 release(Response.json({protocol:'soil.session.v1',id:'s1',client:{id:'client-one'},verified:true,expires_at:Date.now()+60000}));
 await invoke;await assert.rejects(connected,/closed/);assert.equal(client.session,null);assert.equal(listeners.size,0);
 await assert.rejects(client.headers());
});
