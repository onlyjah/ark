import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync,readdirSync,symlinkSync,mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localArchive } from '../packages/storage/local.ts';

test('local archive snapshots mutable bytes, publishes complete immutable objects, and verifies corruption',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kash-local-'));try{
  const archive=localArchive(root),key='personal/owner/object',input=Buffer.from('captured revision');
  const saving=archive.put(key,input);input.fill(0);await saving;
  assert.equal((await archive.get(key)).toString(),'captured revision');
  await archive.put(key,Buffer.from('captured revision'));await assert.rejects(()=>archive.put(key,Buffer.from('newer file')),/immutable/);
  assert.ok(!readdirSync(join(root,'personal/owner')).some(n=>n.startsWith('.pending-')));
  const reopened=localArchive(root);assert.equal((await reopened.get(key)).toString(),'captured revision');
  writeFileSync(join(root,key,'body'),'corrupted');await assert.rejects(()=>reopened.get(key),/integrity/);
  await assert.rejects(()=>archive.get('../private'),/invalid object key/);
  mkdirSync(join(root,'outside'));symlinkSync(join(root,'outside'),join(root,'escape'));await assert.rejects(()=>archive.put('escape/object',Buffer.from('bad')),/not owned/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
