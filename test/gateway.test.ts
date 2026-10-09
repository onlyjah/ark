import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createGateway} from '../apps/gateway/src/gateway.ts'
// Jah Noah [Q007]: "all my projects are sovereign"
// Engineering: test the HTTP boundary independently of provider credentials; actual provider wiring still requires deployment verification.
test('gateway denies unregistered origins, unverified sessions and satellite consent changes',async()=>{
 const origins=['https://onlyjah.com','https://jahnoah.com'];const db={async query(text:string,values:unknown[]){if(text.startsWith('SELECT * FROM ark_client_sites'))return [{id:values[0],origins,schema_version:1,active:true}];return []}};
 const app=createGateway(db,async(token)=>{if(token!=='valid')throw Error();return {subject:'user_verified'}},origins[0]);
 const req=(origin:string,token?:string,path='/v2/account/grants',method='GET')=>app.request(path,{method,headers:{origin,'x-ark-client':'jahnoah',...(token?{authorization:'Bearer '+token}:{})}});
 assert.equal((await req('https://evil.test','valid')).status,403);assert.equal((await req(origins[0])).status,401);assert.equal((await req(origins[0],'forged')).status,401);assert.equal((await req(origins[1],'valid','/v2/account/grants','POST')).status,403);assert.equal((await req(origins[0],'valid')).status,200);
 assert.equal((await req(origins[1],'valid','/v2/buckets/missing/objects')).status,403);
});
