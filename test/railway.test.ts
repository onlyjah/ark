import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

// Jah Noah [Q008]: "let's explore this nebula. Let's coalesce it into something that I can deploy"
// Engineering: exercise the bundled fetch entry, including bootstrap enrollment and live request forwarding.
test('Railway bundle enrollment, authentication and bounded forwarding',async()=>{
  const root=mkdtempSync(join(tmpdir(),'ark-bundle-'));
  const token=randomBytes(32).toString('hex');
  process.env.ARK_BUNDLE_TEST='1';process.env.ARK_DATA=root;
  process.env.ARK_BOOTSTRAP_ID=randomUUID();
  process.env.ARK_BOOTSTRAP_TOKEN_HASH=createHash('sha256').update(token).digest('hex');
  const bundle=await import('../railway/ark-core.function.ts');const app=bundle.default;
  try {
    assert.equal((await app.fetch(new Request('http://test/health'))).status,200);
    assert.equal((await app.fetch(new Request('http://test/v1/node'))).status,401);
    const authorized=await app.fetch(new Request('http://test/v1/node',{headers:{authorization:`Bearer ${token}`}}));
    assert.equal(authorized.status,200);assert.ok((await authorized.json()).node_id);
    const tooLarge=await app.fetch(new Request('http://test/v1/rooms',{method:'POST',headers:{'content-length':'1500001'},body:'{}'}));
    assert.equal(tooLarge.status,413);
  } finally {
    await bundle.disposeBundleForTest();
    delete process.env.ARK_BUNDLE_TEST;delete process.env.ARK_DATA;
    delete process.env.ARK_BOOTSTRAP_ID;delete process.env.ARK_BOOTSTRAP_TOKEN_HASH;
    rmSync(root,{recursive:true,force:true});
  }
});
