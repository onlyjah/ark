import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Store } from '../src/store.ts';
import { createApi } from '../src/api.ts';

// Jah Noah [Q008]: "let's explore this nebula. Let's coalesce it into something that I can deploy"
// Engineering: run the documented terminal commands against disposable data, including actual credential boundaries.
test('guide helper: enrollment, three approvals, revisions, downloads and service access', async () => {
  const dir=mkdtempSync(join(tmpdir(),'ark-guide-'));
  const store=new Store(join(dir,'data'));
  const server=createApi(store);server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as any).port}`;
  const operator=store.issue('Guide test operator',true,true);
  const owner=join(dir,'operator.json');
  writeFileSync(owner,JSON.stringify({public_url:origin,token:operator.token}),{mode:0o600});
  const run=promisify(execFile);
  async function cli(command:string,access:string,...args:string[]) {
    const result=await run('python3',['examples/ark.py',command,access,...args]);
    assert.ok(!result.stdout.includes(operator.token));
    return JSON.parse(result.stdout);
  }
  const post=(access:string,path:string,body:any)=>cli('post',access,path,JSON.stringify(body));
  try {
    assert.equal((await cli('get',owner,'/v1/node')).node_id,store.nodeId());
    const members=[];
    for(const name of ['A','B']) {
      const access=join(dir,`${name}.json`);
      const receipt=await cli('enroll',owner,name,access,'--ttl','604800');
      assert.equal(statSync(access).mode & 0o777,0o600);
      assert.equal(JSON.parse(readFileSync(access,'utf8')).identity_id,receipt.identity_id);
      members.push({access,id:receipt.identity_id});
    }
    const room=await post(owner,'/v1/rooms',{name:'Guide room',charter:'Three founders agree.'});
    for(const m of members)await post(owner,`/v1/rooms/${room.id}/members`,{identity_id:m.id,role:'editor',active:true});
    await assert.rejects(post(owner,`/v1/rooms/${room.id}/activate`,{}),/HTTP 409/);
    for(const access of [owner,...members.map(m=>m.access)])await post(access,`/v1/rooms/${room.id}/approve`,{charter_id:room.charter_id});
    assert.equal((await post(owner,`/v1/rooms/${room.id}/activate`,{})).status,'active');
    const input=join(dir,'planning.txt');writeFileSync(input,'First plan.');
    const resource=await cli('upload',owner,room.id,'Planning document',input);
    const output=join(dir,'recovered.txt');
    await cli('download',members[0].access,resource.id,resource.revision_id,output);
    assert.equal(readFileSync(output,'utf8'),'First plan.');
    await assert.rejects(cli('download',owner,resource.id,resource.revision_id,output),/File exists/);
    writeFileSync(input,'Second plan.');
    const revision=await cli('revise',members[0].access,resource.id,resource.revision_id,input);
    assert.ok(revision.id);
    await assert.rejects(cli('revise',owner,resource.id,resource.revision_id,input),/HTTP 409/);
    const access=join(dir,'service.json');
    const service=await cli('enroll',owner,'Recovery node',access,'--kind','service','--ttl','3600');
    await assert.rejects(cli('get',access,`/v1/resources/${resource.id}`),/HTTP 403/);
    for(const action of ['read','replicate'])await post(owner,`/v1/resources/${resource.id}/grants`,{identity_id:service.identity_id,action,expires_at:Date.now()+60000});
    assert.equal((await cli('get',access,`/v1/resources/${resource.id}`)).id,resource.id);
    const peers=join(dir,'peers.json');await cli('peer-config',access,store.nodeId(),peers,'--peer-name','railway');
    assert.equal(JSON.parse(readFileSync(peers,'utf8')).railway.node_id,store.nodeId());
    await post(owner,'/v1/admin/revoke',{identity_id:service.identity_id});
    await assert.rejects(cli('get',access,'/v1/node'),/HTTP 401/);
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();rmSync(dir,{recursive:true,force:true});
  }
});
