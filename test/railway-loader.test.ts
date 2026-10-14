import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

test('bounded Railway loader restores the exact server and serves health', {skip: !globalThis.Bun}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ark-loader-'));
  const variables = JSON.parse(readFileSync('railway/release-variables.json','utf8'));
  const loader = readFileSync('railway/loader.function.ts','utf8');
  assert.ok(Buffer.byteLength(loader) * 4 / 3 < 8000);
  for (const value of Object.values(variables)) assert.ok(String(value).length <= 16000);
  Object.assign(process.env, variables, {ARK_BUNDLE_TEST:'1',ARK_DATA:root,ARK_BOOTSTRAP_ID:randomUUID(),ARK_BOOTSTRAP_TOKEN_HASH:createHash('sha256').update('test-only-token').digest('hex')});
  const release = await import('../railway/loader.function.ts');
  try {
    const response = await release.default.fetch(new Request('http://test/health'));
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{status:'ok'});
  } finally {
    await release.disposeBundleForTest();
    rmSync(root,{recursive:true,force:true});
    for(const key of [...Object.keys(variables),'ARK_BUNDLE_TEST','ARK_DATA','ARK_BOOTSTRAP_ID','ARK_BOOTSTRAP_TOKEN_HASH']) delete process.env[key];
  }
});
