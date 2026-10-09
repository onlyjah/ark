import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGitSnapshot } from '../src/adapters/git-snapshot.mjs';
import { publicProjection, catalogueService } from '../src/modules/catalogue.mjs';
import { createApp } from '../src/app.mjs';
import { publicEvents } from '../src/modules/public-events.mjs';
const snapshot = await loadGitSnapshot();

test('public projection drops private fields and rejects hidden graph endpoints', () => {
  const input = structuredClone(snapshot);
  input.projects[0].invoice = 'private'; input.secret = 'private';
  assert.equal(JSON.stringify(publicProjection(input)).includes('private'), false);
  input.relationships.push({ source: 'ark', target: 'hidden-project', type: 'owns' });
  assert.throws(() => publicProjection(input), /unpublished endpoint/);
});

test('cycles and graph limits terminate without inventing unseen nodes', () => {
  const input = structuredClone(snapshot);
  input.relationships.push({ source: 'constellation', target: 'onlyjah', type: 'connected' });
  const service = catalogueService(publicProjection(input));
  const graph = service.graph({ root: 'onlyjah', depth: 4, limit: 3 });
  assert.equal(graph.nodes.length, 3); assert.equal(graph.truncated, true);
  assert.equal(new Set(graph.nodes.map(n => n.id)).size, graph.nodes.length);
  assert.ok(graph.edges.every(e => graph.nodes.some(n => n.id === e.source) && graph.nodes.some(n => n.id === e.target)));
});

test('private commands deny anonymous and forged bearer authority', async () => {
  const instance = createApp(snapshot);
  for (const headers of [{}, { Authorization: 'Bearer made-up-admin' }]) {
    const result = await instance.app.request('/api/v1/orgs/other/projects', { method: 'POST', headers });
    assert.equal(result.status, 401);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), null);
  }
  instance.close();
});

test('search and graph enforce bounds and no production evidence is fabricated', async () => {
  const instance = createApp(snapshot);
  for (const path of ['/api/v1/public/graph?depth=99', '/api/v1/public/graph?limit=201', '/api/v1/public/projects?limit=0','/api/v1/public/projects?stage=admin']) {
    assert.equal((await instance.app.request(path)).status, 400);
  }
  const result = await (await instance.app.request('/api/v1/public/projects?q=nebula')).json();
  assert.ok(result.items.every(p => `${p.id} ${p.name} ${p.quote ?? ''}`.toLowerCase().includes('nebula')));
  assert.equal(snapshot.projects.find(p => p.id === 'onlyjah').stage, 'unverified');
  instance.close();
});

test('public snapshot has deterministic revision and conditional reads', async () => {
  const instance = createApp(snapshot);
  const first = await instance.app.request('/api/v1/public/catalogue');
  const etag = first.headers.get('ETag');
  assert.ok(etag); assert.equal((await first.json()).revision, instance.revision);
  const cached = await instance.app.request('/api/v1/public/catalogue', { headers: { 'If-None-Match': etag } });
  assert.equal(cached.status, 304); assert.equal(await cached.text(), '');
  assert.equal((await instance.app.request('/api/v1/public/projects/does-not-exist')).status, 404);
  instance.close();
});

test('SSE capacity and cancellation do not retain unbounded clients', async () => {
  const streams = publicEvents({ revision: 'test', maxClients: 1, heartbeatMs: 100000 });
  const first = streams.response(new AbortController().signal);
  const reader = first.body.getReader();
  const message = new TextDecoder().decode((await reader.read()).value);
  assert.match(message, /event: revision/); assert.equal(streams.size, 1);
  assert.equal(streams.response().status, 429);
  await reader.cancel(); assert.equal(streams.size, 0);
  streams.close();
});

test('drain changes readiness and closes event streams', async () => {
  const instance = createApp(snapshot);
  assert.equal((await instance.app.request('/health/ready')).status, 200);
  instance.close();
  assert.equal((await instance.app.request('/health/ready')).status, 503);
});
