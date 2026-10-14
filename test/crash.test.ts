import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from '../packages/core/store.ts';

test('killed SQLite writer leaves committed metadata intact and rolls back unfinished transaction',()=>{
 const root=mkdtempSync(join(tmpdir(),'kash-crash-'));try{
  const store=new Store(root),node=store.nodeId();store.run('INSERT INTO meta VALUES(?,?)','committed','keep');store.close();
  const url=new URL('../packages/core/store.ts',import.meta.url).href;
  const source=`import {Store} from ${JSON.stringify(url)};const s=new Store(${JSON.stringify(root)});s.atomic(()=>{s.run('INSERT INTO meta VALUES(?,?)','unfinished','discard');process.kill(process.pid,'SIGKILL');});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8'});assert.ok(child.signal||child.status!==0);
  const recovered=new Store(root);try{assert.equal(recovered.nodeId(),node);assert.equal(recovered.one('SELECT value FROM meta WHERE key=?','committed').value,'keep');assert.equal(recovered.one('SELECT value FROM meta WHERE key=?','unfinished'),undefined);}finally{recovered.close();}
 }finally{rmSync(root,{recursive:true,force:true});}
});
