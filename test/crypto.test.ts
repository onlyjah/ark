import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createUnlockFile, unlock, seal, open } from '../packages/crypto/src/index.ts'
import { permits } from '../packages/contracts/src/index.ts'
// Jah Noah [Q007]: "all my projects are sovereign"
// Engineering: verify ciphertext cannot move between owners, objects or revisions, and grants fail closed.
test('bucket key files bind authenticated ciphertext to owner, bucket, object and revision',async()=>{
 const file=await createUnlockFile(),key=await unlock(file),context={ownerId:'owner',bucketId:'top-secret',objectId:'object',revisionId:'v1'},plain=new TextEncoder().encode('Private original');
 const box=await seal(key,file.keyId,plain,context);assert.deepEqual(await open(key,file.keyId,box,context),plain);assert.equal(key.extractable,false);
 for(const field of Object.keys(context))await assert.rejects(open(key,file.keyId,box,{...context,[field]:'different'}));
 const other=await createUnlockFile();await assert.rejects(open(await unlock(other),file.keyId,box,context));
 await assert.rejects(open(key,file.keyId,{...box,ciphertext:box.ciphertext.slice(0,-4)+'AAAA'},context));
 await assert.rejects(unlock({...file,keyId:'forged'}));
});
test('client grants require exact origin, subject, client, bucket, scope and expiry',()=>{
 const client={id:'jahnoah',origins:['https://jahnoah.com'],schemaVersion:1,active:true};const grant={subject:'owner',clientId:client.id,bucketId:'private',scopes:['objects.read' as const],expiresAt:200,revokedAt:null};const input={subject:'owner',origin:client.origins[0],bucketId:'private',scope:'objects.read' as const,now:100};assert.equal(permits(client,grant,input),true);
 for(const patch of [{origin:'https://evil.test'},{subject:'other'},{bucketId:'top-secret'},{scope:'plaintext.read' as const},{now:200}])assert.equal(permits(client,grant,{...input,...patch}),false);
 assert.equal(permits(client,{...grant,revokedAt:1},input),false);assert.equal(permits({...client,active:false},grant,input),false);
});
