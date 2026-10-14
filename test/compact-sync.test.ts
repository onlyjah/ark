import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { createCompact } from '../services/compact.ts';

test('real gateway keeps operation receipts through restart and concurrent editors retain both revision choices',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kash-compact-')),origin='https://kash.example',token=randomBytes(32).toString('hex');
 const env={ARK_APP_ORIGIN:origin,ARK_BUNDLE_TEST:'1',ARK_DATA:root,ARK_ARCHIVE_LOCAL:'1',ARK_BOOTSTRAP_ID:randomUUID(),ARK_BOOTSTRAP_TOKEN_HASH:createHash('sha256').update(token).digest('hex')};
 let app=await createCompact(env,{}),cookie='',csrf='';
 const call=(path:string,body?:any,operation?:string)=>app.fetch(new Request(origin+'/app/api/'+path,{method:body?'POST':'GET',headers:{origin,cookie,'content-type':'application/json','x-ark-csrf':csrf,...(operation?{'x-ark-operation':operation}:{})},body:body?JSON.stringify(body):undefined}));
 try{
  const login=await call('login',{token});assert.equal(login.status,200);cookie=login.headers.get('set-cookie')!.split(';')[0];csrf=(await login.json()).csrf;
  const id=randomUUID(),operation=randomUUID(),payload={id,title:'Draft',kind:'document',body:'Captured first text',base_revision:null};
  const committed=await call('documents',payload,operation);assert.equal(committed.status,200);const receipt=await committed.json();
  await app.close();app=await createCompact(env,{});
  assert.deepEqual(await (await call('documents',payload,operation)).json(),receipt);
  const results=await Promise.all([call('documents',{...payload,body:'Editor A',base_revision:receipt.head},randomUUID()),call('documents',{...payload,body:'Editor B',base_revision:receipt.head},randomUUID())]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const history=await (await call('documents/'+id+'/history')).json();assert.equal(history.length,2);
  assert.equal((await (await call('documents/'+id+'?revision='+receipt.head)).json()).body,payload.body);
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
