import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVault, unlockVault, seal, open } from '../web/src/vault.js';
import { subscriptionEntitled, claimMatches } from '../src/billing.ts';

test('vault: encrypted private key backup restores on another device and rejects wrong account/passphrase',async()=>{
  const {record,vault}=await createVault('a long test recovery passphrase','owner');
  assert.equal(record.signing_public_key.d,undefined);assert.equal(record.encryption_public_key.d,undefined);
  assert.ok(!JSON.stringify(record).includes('signing_private'));
  const sealed=await seal(vault,{title:'Secret title',body:'Private writing'},'owner:doc:document');
  assert.ok(!JSON.stringify(sealed).includes('Private writing'));
  const restored=await unlockVault('a long test recovery passphrase','owner',JSON.parse(JSON.stringify(record)));
  assert.deepEqual(await open(restored,sealed,'owner:doc:document'),{title:'Secret title',body:'Private writing'});
  await assert.rejects(unlockVault('the wrong recovery passphrase','owner',record));
  await assert.rejects(unlockVault('a long test recovery passphrase','another-owner',record));
  await assert.rejects(open(restored,sealed,'owner:another-document:document'));
  const damaged={...sealed,ciphertext:sealed.ciphertext.slice(0,-4)+'AAAA'};
  await assert.rejects(open(restored,damaged,'owner:doc:document'));
});
test('billing: unpaid, expired, wrong-price and wrong-mode subscriptions never grant access',()=>{
  const valid={status:'active',paid:true,priceIds:['price_ark'],periodEnd:2000,livemode:false};
  assert.equal(subscriptionEntitled(valid,'price_ark',false,1000),true);
  for(const invalid of [{...valid,paid:false},{...valid,status:'past_due'},{...valid,status:'canceled'},{...valid,periodEnd:999},{...valid,livemode:true},{...valid,priceIds:['price_other']},{...valid,priceIds:['price_ark','price_other']}])assert.equal(subscriptionEntitled(invalid,'price_ark',false,1000),false);
  assert.equal(claimMatches(true,'BUYER@example.com','buyer@example.com'),true);
  assert.equal(claimMatches(false,'buyer@example.com','buyer@example.com'),false);
  assert.equal(claimMatches(true,'attacker@example.com','buyer@example.com'),false);
});
