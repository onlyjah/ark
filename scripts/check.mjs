import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { loadGitSnapshot } from '../src/adapters/git-snapshot.mjs';
import { createApp } from '../src/app.mjs';
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await check(path);
    else if (path.endsWith('.mjs') && spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' }).status !== 0) process.exit(1);
  }
}
await check('src'); await check('tests');
const instance = createApp(await loadGitSnapshot());
const response = await instance.app.request('/api/v1/public/catalogue');
if (response.status !== 200) throw new Error('Catalogue failed');
const contract = await (await instance.app.request('/openapi.json')).json();
if (contract.openapi !== '3.1.0') throw new Error('Invalid contract');
instance.close();
console.log('Syntax, public projection and contract checks passed.');
