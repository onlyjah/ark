// R08: storage boundary. Only this adapter knows a local Git artifact exists.
// A later PostgreSQL approved-projection adapter must satisfy the same service
// interface and authorization tests. Do not add a DB URL to static client code.
import { readFile } from 'node:fs/promises';
import { publicProjection } from '../modules/catalogue.mjs';
export async function loadGitSnapshot(url = new URL('../../data/public-catalogue.json', import.meta.url)) {
  return publicProjection(JSON.parse(await readFile(url, 'utf8')));
}
