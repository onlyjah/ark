import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo,validateSnapshot,demoTransition,canRelease,actionState,protectionStats} from '../web/kash/model.mjs';
const protectedDemo=()=>demoTransition(demoTransition(makeDemo(),'sync','thin'),'protect','thin');
test('upload acknowledgement alone never releases local data',()=>{
  const s=demoTransition(makeDemo(),'sync','thin');assert.equal(canRelease(s,'thin'),false);
  assert.throws(()=>demoTransition(s,'release','thin'));
});
test('protected thin copy can be released and its index stays present',()=>{
  const s=protectedDemo();assert.equal(canRelease(s,'thin'),true);
  const n=demoTransition(s,'release','thin');assert.equal(n.resource.local_copies.find(c=>c.place_id==='thin').present,false);
  assert.equal(n.resource.id,s.resource.id);assert.ok(n.places.some(p=>p.kind==='index'));
  assert.deepEqual(protectionStats(n),{copies:3,sites:2});
});
test('offline pins keep a protected working copy',()=>{
  const s=protectedDemo();assert.equal(canRelease(s,'working'),false);
  assert.equal(canRelease(demoTransition(s,'pin','working'),'working'),true);
});
test('a site outage pauses release without silently restoring an evicted copy',()=>{
  const s=demoTransition(demoTransition(protectedDemo(),'release','thin'),'outage');
  assert.deepEqual(protectionStats(s),{copies:2,sites:1});assert.equal(canRelease(s,'working'),false);
  assert.equal(s.resource.local_copies.find(c=>c.place_id==='thin').present,false);
  assert.equal(actionState(s,'thin').action,'fetch');
});
test('a newer or dirty local revision cannot be evicted',()=>{
  const s=protectedDemo(),c=s.resource.local_copies.find(c=>c.place_id==='thin');c.revision='r2';
  assert.equal(canRelease(s,'thin'),false);c.revision='r1';c.dirty=true;assert.equal(canRelease(s,'thin'),false);
});
test('expired evidence and stale live data pause release',()=>{
  const s=protectedDemo();s.source='live';s.resource.protection_valid_until=new Date(Date.now()-1).toISOString();
  assert.equal(canRelease(s,'thin'),false);s.resource.protection_valid_until=new Date(Date.now()+60000).toISOString();
  s.observed_at=new Date(Date.now()-31000).toISOString();assert.equal(canRelease(s,'thin'),false);
  assert.equal(actionState(s,'thin').disabled,true);
});
test('archive profile has no local release action',()=>assert.equal(actionState(protectedDemo(),'archive-a').action,null));
test('simulation never mutates a live snapshot',()=>{
  const s=makeDemo();s.source='live';assert.throws(()=>demoTransition(s,'sync','thin'));
});
test('snapshots reject hidden graph references, duplicate IDs, and archive cache records',()=>{
  let s=makeDemo();s.edges.push({from:'secret-node',to:'thin'});assert.throws(()=>validateSnapshot(s));
  s=makeDemo();s.places.push({...s.places[0]});assert.throws(()=>validateSnapshot(s));
  s=makeDemo();s.resource.local_copies[0].place_id='archive-a';assert.throws(()=>validateSnapshot(s));
});
test('unknown fields are not retained in the renderer view',()=>{
  const s=makeDemo();s.vault_key='should never be supplied';s.places[0].private_path='/private';
  const n=validateSnapshot(s);assert.equal(n.vault_key,undefined);assert.equal(n.places[0].private_path,undefined);
});
