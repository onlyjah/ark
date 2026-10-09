import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { Store } from '../src/store.ts';
import { createApi } from '../src/api.ts';
import { replicate } from '../src/peer.ts';

// Jah Noah [Q002]: "three or more people are required to sign off on the creation of a room"
// Engineering: tests exercise actual HTTP permission and persistence boundaries, not only helper functions.
test('two nodes: approvals, isolation, revisions, replication, revocation, restart and recovery',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ark-test-'));
  let a=new Store(join(dir,'a')); const b=new Store(join(dir,'b'));
  const server=createApi(a); server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  const people=Array.from({length:5},(_,i)=>a.issue(`collaborator-${i}`));
  const outsider=a.issue('outsider'), peer=a.issue('independent node',false);
  async function request(person:any,path:string,body?:any,key=randomUUID()) {
    const response=await fetch(base+'/v1/'+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${person.token}`,'content-type':'application/json','idempotency-key':key},body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json()};
  }
  try {
    assert.equal((await fetch(base+'/v1/rooms')).status,401);
    const created=await request(people[0],'rooms',{name:'Shared project',charter:'Three founders approve; members edit; replicas require consent.'});
    assert.equal(created.status,200); const room=created.body.id;
    for(const p of people.slice(1)) assert.equal((await request(people[0],`rooms/${room}/members`,{identity_id:p.id,role:'editor',active:true})).status,200);
    assert.equal((await request(outsider,`rooms/${room}`)).status,403);
    assert.equal((await request(people[0],`rooms/${room}/activate`,{})).status,409);
    await request(people[0],`rooms/${room}/members`,{identity_id:peer.id,role:'editor',active:true});
    assert.equal((await request(peer,`rooms/${room}/approve`,{charter_id:created.body.charter_id})).status,403);
    await request(people[0],`rooms/${room}/members`,{identity_id:peer.id,role:'reader',active:false});
    for(const p of people.slice(0,3)) assert.equal((await request(p,`rooms/${room}/approve`,{charter_id:created.body.charter_id})).status,200);
    const revised=await request(people[0],`rooms/${room}/charter`,{charter:'Changed charter requires fresh consent.'});
    assert.equal((await request(people[0],`rooms/${room}/activate`,{})).status,409);
    assert.equal((await request(people[1],`rooms/${room}/approve`,{charter_id:created.body.charter_id})).status,409);
    for(const p of people.slice(0,3)) await request(p,`rooms/${room}/approve`,{charter_id:revised.body.charter_id});
    await request(people[0],`rooms/${room}/members`,{identity_id:people[2].id,role:'editor',active:false});
    assert.equal((await request(people[0],`rooms/${room}/activate`,{})).status,409);
    await request(people[0],`rooms/${room}/members`,{identity_id:people[2].id,role:'editor',active:true});
    assert.equal((await request(people[0],`rooms/${room}/activate`,{})).status,200);
    const bytes=Buffer.from('Human original, version one.'),key=randomUUID();
    const payload={title:'Archive A',kind:'document',content_base64:bytes.toString('base64')};
    const resource=await request(people[0],`rooms/${room}/resources`,payload,key);
    assert.equal(resource.status,200); const rid=resource.body.id;
    assert.deepEqual((await request(people[0],`rooms/${room}/resources`,payload,key)).body,resource.body);
    assert.equal((await request(people[0],`rooms/${room}/resources`,{...payload,title:'different'},key)).status,409);
    assert.equal((await request(outsider,`resources/${rid}/content`)).status,403);
    const next=await request(people[1],`resources/${rid}/revisions`,{base_revision_id:resource.body.revision_id,content_base64:Buffer.from('Version two').toString('base64')});
    assert.equal(next.status,200);
    assert.equal((await request(people[2],`resources/${rid}/revisions`,{base_revision_id:resource.body.revision_id,content_base64:bytes.toString('base64')})).status,409);
    assert.equal((await request(people[0],`resources/${rid}/content?revision=${resource.body.revision_id}`)).body.content_base64,bytes.toString('base64'));
    const peers=join(dir,'peers.json');writeFileSync(peers,JSON.stringify({a:{url:base,node_id:a.nodeId(),token:peer.token}}),{mode:0o600});
    await assert.rejects(replicate(b,peers,'a',rid));
    await request(people[0],`resources/${rid}/grants`,{identity_id:peer.id,action:'read',expires_at:Date.now()+60000});
    await assert.rejects(replicate(b,peers,'a',rid));
    await request(people[0],`resources/${rid}/grants`,{identity_id:peer.id,action:'replicate',expires_at:Date.now()+60000});
    const copy=await replicate(b,peers,'a',rid,resource.body.revision_id);
    assert.equal(b.bytes(copy.digest).toString(),bytes.toString());
    assert.equal((await replicate(b,peers,'a',rid,resource.body.revision_id)).id,copy.id);
    assert.equal(b.all('SELECT * FROM resources').length,0);
    await request(people[0],`resources/${rid}/grants`,{identity_id:peer.id,action:'replicate',expires_at:0});
    await assert.rejects(replicate(b,peers,'a',rid));
    assert.equal(b.bytes(copy.digest).toString(),bytes.toString());
    await request(people[0],`rooms/${room}/members`,{identity_id:people[1].id,role:'reader',active:false});
    assert.equal((await request(people[1],`resources/${rid}/content`)).status,403);
    a.revoke(people[2].id); assert.equal((await request(people[2],`rooms/${room}`)).status,401);
    const events=await request(people[0],`rooms/${room}/events?after=0`);assert.ok(events.body.length>0);
    const node=a.nodeId(); await new Promise<void>(resolve=>server.close(()=>resolve())); a.close();
    a=new Store(join(dir,'a')); assert.equal(a.nodeId(),node);
    assert.equal(a.one('SELECT head FROM resources WHERE id=?',rid).head,next.body.id);
    assert.throws(()=>a.authenticate(people[2].token));
    const recovery=join(dir,'recovery');
    const {mkdirSync}=await import('node:fs');mkdirSync(recovery);
    a.db.prepare('VACUUM INTO ?').run(join(recovery,'ark.sqlite'));
    cpSync(join(dir,'a','blobs'),join(recovery,'blobs'),{recursive:true});
    const recovered=new Store(recovery);
    try {
      assert.equal(recovered.nodeId(),node);
      assert.equal(recovered.bytes(resource.body.digest).toString(),bytes.toString());
      assert.equal(recovered.one('SELECT head FROM resources WHERE id=?',rid).head,next.body.id);
      assert.throws(()=>recovered.authenticate(people[2].token));
    } finally {recovered.close();}
  } finally {server.close();a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});

// Jah Noah [Q001]: "you define the rules and scope of the room, and then you create it."
// Engineering: service identities cannot forge human founder eligibility; token expiry fails closed.
test('identity expiry and rollback',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ark-auth-'));const store=new Store(dir);
  try {
    const expired=store.issue('expired',true,false,1);
    store.run('UPDATE credentials SET expires_at=0 WHERE identity_id=?',expired.id);
    assert.throws(()=>store.authenticate(expired.token));
    assert.throws(()=>store.atomic(()=>{store.run('INSERT INTO meta VALUES(?,?)','rollback','x');throw new Error('abort');}));
    assert.equal(store.one('SELECT * FROM meta WHERE key=?','rollback'),undefined);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

// Jah Noah [Q023]: "we already know each other. We know we're aligned in our mission, our vision, our purpose."
// Engineering: only the verified local operator can enroll collaborators; room ownership stays separate.
test('protected remote enrollment and revoke',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ark-admin-'));const store=new Store(dir);
  const server=createApi(store);server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  const operator=store.issue('operator',true,true),member=store.issue('member');
  async function post(person:any,path:string,body:any,key=randomUUID()) {
    const r=await fetch(base+'/v1/admin/'+path,{method:'POST',headers:{authorization:`Bearer ${person.token}`,'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};
  }
  try {
    assert.equal((await post(member,'identities',{name:'No permission',human:true})).status,403);
    const token=randomBytes(32).toString('hex');
    const key=randomUUID(),body={name:'Collaborator',human:true,ttl_seconds:600,token_hash:createHash('sha256').update(token).digest('hex')};
    const issued=await post(operator,'identities',body,key);assert.equal(issued.status,200);
    assert.equal(store.authenticate(token).admin,0);
    assert.ok(!JSON.stringify(store.all('SELECT * FROM operations')).includes(token));
    assert.deepEqual((await post(operator,'identities',body,key)).body,issued.body);
    await post(operator,'revoke',{identity_id:issued.body.id});
    assert.throws(()=>store.authenticate(token));
    assert.equal((await post(operator,'revoke',{identity_id:operator.id})).status,400);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();rmSync(dir,{recursive:true,force:true});}
});
