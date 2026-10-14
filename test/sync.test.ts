import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueue, transition, acknowledgesLocalVersion } from '../src/sync.ts';
import type { SyncOperation } from '../src/sync.ts';

const operation: SyncOperation = {
  protocol: 1, operationId: 'op-1', ownerId: 'owner', actorId: 'collaborator',
  appId: 'ark-kash', deviceId: 'phone', resourceId: 'doc-1', baseRevisionId: 'r0',
  ciphertextRef: 'local-object-1', ciphertextDigest: 'a'.repeat(64), localVersion: 3
};
const send = (item = enqueue(operation)) => transition(item, {type:'send',operationId:'op-1'});

test('offline queued edit survives transport failure with stable operation identity', () => {
  const original=enqueue(operation), sending=send(original);
  const retry=transition(sending,{type:'retry',operationId:'op-1',attempt:1});
  assert.equal(original.status,'queued'); assert.equal(sending.status,'sending');
  assert.equal(retry.operation.operationId,operation.operationId);
  assert.equal(retry.operation.ciphertextRef,operation.ciphertextRef);
  assert.equal(send(retry).attempt,2);
});
test('receipt for another operation or an obsolete attempt cannot mark an edit synced', () => {
  const sending=send();
  assert.equal(transition(sending,{type:'ack',operationId:'other',attempt:1,revisionId:'r1'}),sending);
  const retry=send(transition(sending,{type:'retry',operationId:'op-1',attempt:1}));
  assert.equal(transition(retry,{type:'ack',operationId:'op-1',attempt:1,revisionId:'r1'}),retry);
});
test('acknowledging version 3 never clears unsent version 4', () => {
  const saved=transition(send(),{type:'ack',operationId:'op-1',attempt:1,revisionId:'r1'});
  assert.equal(acknowledgesLocalVersion(saved,3),true);
  assert.equal(acknowledgesLocalVersion(saved,4),false);
});
test('conflict retains local edit and refuses blind resend', () => {
  const conflict=transition(send(),{type:'conflict',operationId:'op-1',attempt:1});
  assert.equal(conflict.status,'conflict'); assert.equal(send(conflict),conflict);
  assert.equal(conflict.operation.baseRevisionId,'r0');
  // Resolution creates a new operation from an explicitly reconciled revision.
  assert.equal(enqueue({...operation,operationId:'resolved',baseRevisionId:'r1'}).status,'queued');
});
test('revocation blocks retries and ignores a late acknowledgment', () => {
  const blocked=transition(send(),{type:'deny',operationId:'op-1',reason:'revoked'});
  assert.equal(blocked.status,'blocked'); assert.equal(send(blocked),blocked);
  assert.equal(transition(blocked,{type:'ack',operationId:'op-1',attempt:1,revisionId:'r1'}),blocked);
  const renewed=transition(blocked,{type:'reauthorized',operationId:'op-1'});
  assert.equal(renewed.status,'queued'); assert.equal(send(renewed).attempt,2);
});
test('duplicate send and receipt do not create additional transitions', () => {
  const sending=send(); assert.equal(send(sending),sending);
  const saved=transition(sending,{type:'ack',operationId:'op-1',attempt:1,revisionId:'r1'});
  assert.equal(transition(saved,{type:'ack',operationId:'op-1',attempt:1,revisionId:'r1'}),saved);
});
test('operation snapshots are immutable and invalid envelopes fail before queueing', () => {
  const input={...operation}; const item=enqueue(input); input.ownerId='changed';
  assert.equal(item.operation.ownerId,'owner'); assert.ok(Object.isFrozen(item.operation));
  for(const bad of [{ciphertextRef:''},{ciphertextDigest:'plaintext'},{localVersion:0},
    {ownerId:''},{baseRevisionId:''},{protocol:2}])
    assert.throws(()=>enqueue({...operation,...bad} as SyncOperation));
});
