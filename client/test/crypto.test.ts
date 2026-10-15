import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importKey, openFile, sealFile, encode } from '../src/sealed.ts';

test('WebCrypto and Go share an authenticated envelope fixture',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('../../contracts/sealed.fixture.json',import.meta.url),'utf8'));
  const key=await importKey(fixture.test_key);
  const opened=await openFile(key,encode(new TextEncoder().encode(JSON.stringify(fixture.envelope))));
  assert.equal(opened.name,fixture.file.name);assert.equal(encode(opened.bytes),fixture.file.content_base64);
  const ciphertext=await sealFile(key,new File(['browser round trip'],'test.txt',{type:'text/plain'}));
  assert.equal(new TextDecoder().decode((await openFile(key,ciphertext)).bytes),'browser round trip');
  await assert.rejects(openFile(await importKey(encode(new Uint8Array(32).fill(9))),ciphertext));
});
