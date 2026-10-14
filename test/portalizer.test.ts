import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { portalRequest, protectPortal, assertPortScope } from '../plugins/so-il/authority.ts';
import { createApp } from '../services/portalizer/app.ts';
import { createRegistry } from '../plugins/so-il/registry.ts';
const key=randomBytes(32).toString('hex'),otherKey=randomBytes(32).toString('hex');
const origin='https://ark.example';
const member={id:'11111111-1111-4111-8111-111111111111',name:'member',email:'member@example.com',emailVerified:true,paid:true,human:1 as const,admin:0 as const,managed:true as const};
function session(exp=Math.floor(Date.now()/1000)+600){return 'x.'+Buffer.from(JSON.stringify({sub:member.id,exp})).toString('base64url')+'.x';}
test('portal authority binds destination, operation, credentials and payload; rejects replay',async()=>{
 const handler=protectPortal(key,'archive',async(r,g)=>{assertPortScope(g,{app:'forge',audience:'archive',owner:member.id,resource:'doc-1',action:'document.write'});return Response.json({subject:g.subject,body:await r.text()});});
 const input=new Request('https://ark.example/ports/files',{method:'POST',headers:{origin,authorization:'Bearer test',cookie:'session=a'},body:'ciphertext'});
 const signed=await portalRequest(input,'http://private/archive',key,{app:'forge',audience:'archive',action:'document.write',subject:member.id,owner:member.id,resource:'doc-1'});
 const headers=new Headers(signed.headers);
 assert.equal((await handler(new Request('http://private/archive',{method:'POST',headers,body:'changed'}))).status,403);
 assert.equal((await handler(new Request('http://private/other',{method:'POST',headers,body:'ciphertext'}))).status,403);
 headers.set('cookie','session=b');assert.equal((await handler(new Request('http://private/archive',{method:'POST',headers,body:'ciphertext'}))).status,403);headers.set('cookie','session=a');
 const wrong=protectPortal(otherKey,'archive',async()=>Response.json({}));assert.equal((await wrong(new Request('http://private/archive',{method:'POST',headers,body:'ciphertext'}))).status,403);
 const audience=protectPortal(key,'billing',async()=>Response.json({}));assert.equal((await audience(new Request('http://private/archive',{method:'POST',headers,body:'ciphertext'}))).status,403);
 assert.equal((await handler(new Request('http://private/archive',{method:'POST',headers,body:'ciphertext'}))).status,200);
 assert.equal((await handler(new Request('http://private/archive',{method:'POST',headers,body:'ciphertext'}))).status,409);
 assert.equal((await handler(new Request('http://private/archive'))).status,403);
});
test('so/il entry requires matching app, authorized owner and unexpired session; strips user secrets',async()=>{
 const entry={id:'notes',app:'forge',audience:'notes',owner:member.id,resource:'document-1',destination:'https://notes.example/private/document-1',action:'document.read',methods:['GET'],secret:key};
 let calls=0;const backend=protectPortal(key,'notes',async(r,g)=>{
  calls++;assert.equal(r.headers.get('authorization'),null);assert.equal(r.headers.get('cookie'),null);assert.equal(g.owner,member.id);assert.equal(g.resource,'document-1');assert.equal(g.subject,member.id);return Response.json({body:'ciphertext'});
 });
 const app=createApp({ARK_APP_ORIGIN:origin,ARK_ACCOUNTS_URL:'http://accounts',ARK_ACCOUNTS_PORTAL_KEY:key},(async(r:any)=>backend(r)) as typeof fetch,{entries:[entry],authenticate:async()=>member});
 const request=(extra:Record<string,string>={})=>new Request(origin+'/ports/notes',{headers:{origin,'x-ark-app-id':'forge',authorization:'Bearer '+session(),cookie:'session=private',...extra}});
 assert.equal((await app.fetch(request({'x-ark-app-id':'other'}))).status,403);
 assert.equal((await app.fetch(request({authorization:'Bearer '+session(1)}))).status,401);
 assert.equal((await app.fetch(new Request(origin+'/internal/identity'))).status,404);
 assert.equal((await app.fetch(request())).status,200);assert.equal(calls,1);
 const denied=createApp({ARK_APP_ORIGIN:origin,ARK_ACCOUNTS_URL:'http://accounts',ARK_ACCOUNTS_PORTAL_KEY:key},fetch,{entries:[{...entry,owner:'different-owner'}],authenticate:async()=>member});
 assert.equal((await denied.fetch(request())).status,403);
 const list=await (await app.fetch(new Request(origin+'/ports',{headers:{'x-ark-app-id':'forge'}}))).json();assert.equal(list[0].secret,undefined);assert.equal(list[0].destination,undefined);
});
test('port registry rejects duplicate ports, embedded credentials and invalid methods',()=>{
 const e={id:'notes',app:'forge',audience:'notes',owner:'owner',resource:'doc',destination:'https://notes.example/doc',action:'document.read',methods:['GET'],secret:key};
 assert.throws(()=>createRegistry([e,e]));assert.throws(()=>createRegistry([{...e,destination:'https://password:secret@notes.example/doc'}]));assert.throws(()=>createRegistry([{...e,methods:['CONNECT']}]));
});
