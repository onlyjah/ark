import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store, digest } from '../src/store.ts';
import { createWeb, PERSONAL_QUOTA } from '../src/web.ts';

// Jah Noah [Q007]: "all my projects are sovereign"
// Engineering: assert personal ownership, durable sessions, quota reservations and stale-edit refusal through actual browser routes.
test('phone app: sessions, archive revisions, isolation, rollback and capacity',async()=>{
  const root=mkdtempSync(join(tmpdir(),'ark-web-'));let s=new Store(root);
  const blobs=new Map<string,Buffer>();let fail=false;
  const archive={async put(k:string,b:Buffer){if(fail)throw Error('offline');blobs.set(k,b);},async get(k:string){return blobs.get(k)!;},async remove(k:string){blobs.delete(k);}};
  const staticBytes=Buffer.from('trusted library');
  const assets={'/app/vendor/test.js':{type:'text/javascript',key:`app-assets/${digest(staticBytes)}/test.js`}};
  const origin='https://ark.example';let web=createWeb(s,origin,assets,archive);
  const owner=s.issue('writer'),other=s.issue('another writer');
  async function login(token:string){const r=(await web(new Request(origin+'/app/api/login',{method:'POST',headers:{origin},body:JSON.stringify({token})})))!;assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie')!.split(';')[0],...(await r.json())};}
  async function call(who:any,path:string,body?:any,headers:Record<string,string>={}){return (await web(new Request(origin+'/app/api/'+path,{method:body===undefined?'GET':'POST',headers:{cookie:who.cookie,origin,'x-ark-csrf':who.csrf,...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)})))!;}
  try{
    assert.equal((await web(new Request(origin+'/app/api/me')))!.status,401);
    const a=await login(owner.token),b=await login(other.token);
    const operator=await login(s.issue('operator',true,true).token);
    assert.equal((await call(a,'admin/assets?path=/app/vendor/test.js','trusted library')).status,403);
    assert.equal((await call(operator,'admin/assets?path=/app/vendor/test.js','tampered library')).status,400);
    assert.equal((await call(operator,'admin/assets?path=/app/vendor/test.js','trusted library')).status,200);
    assert.equal(await (await web(new Request(origin+'/app/vendor/test.js')))!.text(),'trusted library');
    assert.equal((await call(a,'me')).status,200);
    assert.equal((await call(a,'documents',{}, {origin:'https://evil.example'})).status,403);
    assert.equal((await call(a,'documents',{}, {'x-ark-csrf':'wrong'})).status,403);
    const id=randomUUID();let r=await call(a,'documents',{id,title:'A human original',kind:'blog',body:'First words.',base_revision:null});assert.equal(r.status,200);const first=await r.json();
    assert.equal((await call(b,'documents/'+id)).status,404);
    assert.deepEqual(await (await call(b,'documents')).json(),[]);
    const next={id,title:'An article',kind:'article',body:'Revised words.',base_revision:first.head};
    r=await call(a,'documents',next);assert.equal(r.status,200);const second=await r.json();
    assert.notEqual(first.head,second.head);
    assert.equal((await call(a,'documents',next)).status,409);
    const historical=await (await call(a,'documents/'+id+'?revision='+first.head)).json();assert.equal(historical.body,'First words.');
    assert.equal((await (await call(a,'documents/'+id+'/history')).json()).length,2);
    const project=await (await call(a,'projects',{name:'First voyage'})).json();
    assert.deepEqual(await (await call(b,'projects')).json(),[]);
    assert.equal((await call(b,'documents/'+id+'/location',{project_id:project.id,folder:'notes'})).status,404);
    assert.equal((await call(a,'documents/'+id+'/location',{project_id:project.id,folder:'../escape'})).status,400);
    assert.equal((await call(a,'documents/'+id+'/location',{project_id:project.id,folder:'research/notes'})).status,200);
    assert.equal((await (await call(a,'documents/'+id)).json()).folder,'research/notes');
    assert.equal((await call(a,'publications',{document_id:id,revision_id:second.head})).status,409);
    assert.equal((await call(a,'publications',{document_id:id,revision_id:first.head,confirm_public:true})).status,409);
    assert.equal((await call(b,'publications',{document_id:id,revision_id:second.head,confirm_public:true})).status,404);
    const post=await (await call(a,'publications',{document_id:id,revision_id:second.head,confirm_public:true})).json();
    const publicRead=async()=> (await web(new Request(origin+'/publications/'+post.id)))!;
    assert.equal((await (await publicRead()).json()).body,'Revised words.');
    await call(a,'documents',{id,title:'Private next revision',kind:'article',body:'Private newer words.',base_revision:second.head});
    assert.equal((await (await publicRead()).json()).body,'Revised words.');
    assert.equal((await call(b,'publications/'+post.id+'/withdraw',{})).status,404);
    assert.equal((await call(a,'publications/'+post.id+'/withdraw',{})).status,200);
    assert.equal((await publicRead()).status,410);
    const imported=await call(a,'documents',{title:'Imported guide',kind:'document',body:'# Guide\n\n| A | B |',source_path:'GUIDE.md',base_revision:null});
    assert.equal(imported.status,200);const importedId=(await imported.json()).id;
    assert.equal((await (await call(a,'documents/'+importedId)).json()).source_path,'GUIDE.md');
    const upload=await (await call(a,'files?name=notes.txt','Private file bytes.')).json();
    assert.equal(await (await call(a,'files/'+upload.id)).text(),'Private file bytes.');
    assert.equal((await call(b,'files/'+upload.id)).status,404);
    const usage=await (await call(a,'storage')).json();assert.equal(usage.quota_bytes,5_000_000_000);assert.equal(usage.used_bytes,[...blobs.entries()].filter(([key])=>key.startsWith(`personal/${owner.id}/`)).reduce((n,[,v])=>n+v.length,0));
    fail=true;assert.equal((await call(a,'files?name=fail.txt','fail')).status,502);fail=false;
    assert.equal(s.one('SELECT COUNT(*) AS n FROM web_objects WHERE status=?','pending').n,0);
    const large=randomUUID();s.run('INSERT INTO web_objects VALUES(?,?,?,?,?,?)',large,owner.id,'reserved-test',PERSONAL_QUOTA,'pending',Date.now());
    assert.equal((await call(a,'files?name=over.txt','x')).status,507);s.run('DELETE FROM web_objects WHERE id=?',large);
    s.close();s=new Store(root);web=createWeb(s,origin,{},archive);
    assert.equal((await call(a,'me')).status,200);assert.equal((await (await call(a,'documents/'+id)).json()).body,'Private newer words.');
    s.revoke(owner.id);assert.equal((await call(a,'me')).status,401);
    await call(b,'logout',{});assert.equal((await call(b,'me')).status,401);
  }finally{s.close();rmSync(root,{recursive:true,force:true});}
});
