import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store,Fault } from '../src/store.ts';
import { createWeb } from '../src/web.ts';
import { createVault,seal,open } from '../web/src/vault.js';

test('encrypted web: opaque storage, replay receipts, paid gating and explicit published copy',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ark-e2ee-')),store=new Store(root),owner=randomUUID(),id=randomUUID();let paid=true;
 const {vault}=await createVault('test vault recovery passphrase',owner),objects=new Map<string,Buffer>();
 const archive={async put(k:string,b:Buffer){objects.set(k,b)},async get(k:string){return objects.get(k)!},async remove(k:string){objects.delete(k)}};
 const saas={authUrl:'',billingReady:false,async handle(){return null},async authenticate(r:Request){if(!r.headers.has('authorization'))return null;return {id:owner,name:'writer',email:'writer@example.com',emailVerified:true,paid,human:1,admin:0,managed:true}},async verifyEnvelope(actor:any,e:any,context:string){try{await open(vault,e,context)}catch{throw new Fault(400,'invalid envelope')}}};
 const origin='https://ark.example',web=createWeb(store,origin,{},archive,saas as any);
 const call=async(path:string,b?:any,op?:string)=> (await web(new Request(origin+'/app/api/'+path,{method:b?'POST':'GET',headers:{origin,authorization:'Bearer test',...(op?{'x-ark-operation':op}:{})},body:b?JSON.stringify(b):undefined})))!;
 try{
  const encrypted=await seal(vault,{title:'Secret title',body:'Secret writing',kind:'document'},`${owner}:${id}:document`),op=randomUUID();
  const payload={id,title:'Encrypted document',kind:'document',body:'',base_revision:null,encrypted_payload:encrypted};
  const saved=await call('documents',payload,op);assert.equal(saved.status,200);const receipt=await saved.json();
  assert.deepEqual(await (await call('documents',payload,op)).json(),receipt);assert.equal(objects.size,1);
  assert.ok(![...objects.values()][0].toString().includes('Secret writing'));
  assert.equal(store.one('SELECT title FROM web_documents WHERE id=?',id).title,'Encrypted document');
  assert.equal((await call('documents',{...payload,title:'Leaked title'},randomUUID())).status,409);
  paid=false;assert.equal((await call('documents',payload,op)).status,402);assert.equal((await call('documents/'+id)).status,200);paid=true;
  assert.equal((await call('publications',{document_id:id,revision_id:receipt.head,confirm_public:true})).status,400);
  const post=await (await call('publications',{document_id:id,revision_id:receipt.head,confirm_public:true,published_content:{title:'Published title',body:'Approved public words'}})).json();
  assert.ok([...objects.keys()].some(k=>k.startsWith('published/')));
  const publicDoc=(await web(new Request(origin+'/publications/'+post.id)))!;assert.equal((await publicDoc.json()).body,'Approved public words');
  await call('publications/'+post.id+'/withdraw',{});assert.equal((await web(new Request(origin+'/publications/'+post.id)))!.status,410);
 }finally{store.close();rmSync(root,{recursive:true,force:true})}
});
