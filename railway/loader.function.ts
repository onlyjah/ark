import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const count = Number(Bun.env.ARK_RELEASE_CHUNKS);
if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Invalid release chunk count');
const packed = Array.from({length: count}, (_, index) => {
  const value = Bun.env['ARK_RELEASE_' + index];
  if (!value || value.length > 16000 || !/^[A-Za-z0-9+/=]+$/.test(value)) throw new Error('Invalid release chunk');
  return value;
}).join('');
const source = gunzipSync(Buffer.from(packed, 'base64'), {maxOutputLength: 4000000});
const hash = createHash('sha256').update(source).digest('hex');
if (hash !== Bun.env.ARK_RELEASE_SHA256) throw new Error('Release integrity check failed');
const path = '/tmp/ark-release-' + hash + '.mjs';
writeFileSync(path, source, {mode: 0o600});
const release = await import('file://' + path);
export const disposeBundleForTest = release.disposeBundleForTest;
export default release.default;
