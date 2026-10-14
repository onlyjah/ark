import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { generateKeyPair,exportJWK,SignJWT } from 'jose';
import { createCompact } from '../services/compact.ts';

test('SO/IL-only service verifies real JWKS and fresh session status; legacy login cannot bypass it',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('EdDSA'),jwk={...await exportJWK(publicKey),kid:'soil-test',alg:'EdDSA'};
 let provider:any,active=true;
 const server=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url?.endsWith('/.well-known/jwks.json')?{keys:[jwk]}:{...provider,active}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const issuer='http://127.0.0.1:'+(server.address() as any).port+'/api/v1',root=mkdtempSync(join(tmpdir(),'kash-soil-services-'));
 const origin='https://kash.example',subject=randomUUID(),client='client-test',token=randomBytes(32).toString('hex'),iat=Math.floor(Date.now()/1000);
 provider={protocol:'soil.session.v1',issuer,audience:'kash',id:'session-test',client:{id:client},subject,verified:true,active:true,expires_at:(iat+600)*1000,scopes:['kash:read','ark:api'],capabilities:['identity','access','accounts','ark.api']};
 const jwt=await new SignJWT({sid:provider.id,client_id:client,scope:'kash:read ark:api'}).setProtectedHeader({alg:'EdDSA',kid:'soil-test'}).setIssuer(issuer).setAudience('kash').setSubject(subject).setIssuedAt(iat).setExpirationTime(iat+600).sign(privateKey);
 const app=await createCompact({ARK_APP_ORIGIN:origin,ARK_BUNDLE_TEST:'1',ARK_DATA:root,ARK_BOOTSTRAP_ID:subject,ARK_BOOTSTRAP_TOKEN_HASH:createHash('sha256').update(token).digest('hex'),SOIL_AUTH_MODE:'soil',SOIL_API_URL:issuer,SOIL_ISSUER:issuer},{});
 const call=(path:string,authorized=true,body?:any)=>app.fetch(new Request(origin+path,{method:body?'POST':'GET',headers:{origin,...(authorized?{authorization:'Bearer '+jwt,'x-soil-client-id':client}:{})},body:body?JSON.stringify(body):undefined}));
 try{
  assert.equal((await call('/app/api/login',false,{token})).status,403);
  assert.equal((await call('/app/api/me',false)).status,401);
  const session=await (await call('/app/api/soil/session')).json();assert.equal(session.id,provider.id);assert.equal(session.client.id,client);assert.equal(session.verified,true);
  assert.equal((await call('/app/api/kash/map')).status,200);
  assert.equal((await call('/v1/node')).status,200);
  assert.equal((await call('/app/api/projects',true,{name:'No write scope'})).status,403);
  active=false;assert.equal((await call('/app/api/me')).status,401);assert.equal((await call('/v1/node')).status,401);
 }finally{await app.close();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
});
