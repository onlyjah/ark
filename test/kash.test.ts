import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/store.ts';
import {createWeb} from '../src/web.ts';

test('KASH observations require a current owner session and never claim backup protection',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kash-view-')),store=new Store(root),origin='https://kash.example';
 const archive={async put(){},async get(){return Buffer.from('')},async remove(){}};
 const web=createWeb(store,origin,{},archive);
 async function login(token:string){const response=(await web(new Request(origin+'/app/api/login',{method:'POST',headers:{origin},body:JSON.stringify({token})})))!;assert.equal(response.status,200);return response.headers.get('set-cookie')!.split(';')[0];}
 const get=(cookie:string,path='kash/map')=>web(new Request(origin+'/app/api/'+path,{headers:{cookie,origin}}));
 try{
  assert.equal((await web(new Request(origin+'/app/api/kash/map')))!.status,401);
  const a=store.issue('A'),b=store.issue('B'),cookieA=await login(a.token),cookieB=await login(b.token);
  store.run('INSERT INTO web_documents VALUES(?,?,?,?,?,?)',randomUUID(),a.id,'Private metadata','document','revision-ref',Date.now());
  store.run('INSERT INTO web_projects VALUES(?,?,?,?)',randomUUID(),a.id,'Private project',Date.now());
  const first=(await get(cookieA))!;assert.equal(first.headers.get('cache-control'),'no-store');const av=await first.json();
  const bv=await (await get(cookieB))!.json();assert.equal(av.observation.documents,1);assert.equal(av.observation.projects,1);assert.equal(bv.observation.documents,0);assert.equal(bv.observation.projects,0);
  assert.notEqual(av.context_id,bv.context_id);assert.ok(!(JSON.stringify(av).includes('Private metadata')||JSON.stringify(av).includes('Private project')));
  assert.equal(av.observation.automatic_cleanup,false);assert.equal(av.observation.backup_state,'unconfigured');assert.deepEqual(av.resource.allowed_actions,[]);
  assert.equal(av.places.filter((p:any)=>p.has_copy).length,0);assert.equal(av.places.find((p:any)=>p.id==='archive-a').availability,'unknown');
  assert.ok((await (await get(cookieA))!.json()).sequence>av.sequence);
  const external=(await web(new Request(origin+'/app/api/kash/map',{headers:{cookie:cookieA,origin:'https://other.example'}})))!;assert.equal(external.status,403);
  store.revoke(a.id);assert.equal((await get(cookieA))!.status,401);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
test('KASH public shell preserves account/vault editor controls and isolates private API caching',()=>{
 const html=readFileSync('web/index.html','utf8'),sw=readFileSync('web/sw.js','utf8');
 assert.match(html,/<title>KASH/);for(const id of ['home','writing','archive','thin','kash-map','auth-form','vault-form','save'])assert.ok(html.includes('id="'+id+'"'));
 assert.ok(html.includes('/app/kash-map.js'));assert.ok(html.includes('/app/kash-home.js'));
 assert.ok(!sw.includes("'/app/api/kash/map'"));assert.match(sw,/kash-shell-0\.4\.0/);
});
