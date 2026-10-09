// R01-R03/R08: Fetch-compatible module assembly. Hono is the portable transport
// layer. Business data, event lifetime and host shutdown live in separate files.
// Authentication is NOT fabricated here. Private paths fail closed until the
// current issuer/principal/grant adapter is actually integrated and tested.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { catalogueService } from './modules/catalogue.mjs';
import { publicEvents } from './modules/public-events.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export function createApp(snapshot, { commit = 'local', maxStreams = 64 } = {}) {
  const app = new Hono();
  const catalogue = catalogueService(snapshot);
  const revision = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const streams = publicEvents({ revision, maxClients: maxStreams });
  let ready = true;
  const failure = (c, status, code) => c.json({ error: code, requestId: c.get('requestId') }, status);
  const json = (c, payload) => {
    const body = JSON.stringify(payload);
    const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
    c.header('ETag', etag); c.header('Cache-Control', 'public, max-age=0, must-revalidate');
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304);
    return c.body(body, 200, { 'Content-Type': 'application/json; charset=utf-8' });
  };
  app.use('*', async (c, next) => {
    c.set('requestId', crypto.randomUUID());
    c.header('X-Request-ID', c.get('requestId'));
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    c.header('Cache-Control', 'no-store');
    if (c.req.url.length > 8192) return failure(c, 414, 'request_too_long');
    await next();
  });
  app.use('/api/v1/public/*', cors({ origin: '*', allowMethods: ['GET', 'HEAD', 'OPTIONS'],
    exposeHeaders: ['ETag', 'X-Request-ID'], maxAge: 600 }));
  app.get('/', c => json(c, { name: 'Ark Constellation', version: '0.1.0',
    catalogue: '/api/v1/public/catalogue', projects: '/api/v1/public/projects',
    graph: '/api/v1/public/graph?root=onlyjah&depth=2',
    contract: '/openapi.json', capabilities: '/api/v1/capabilities' }));
  app.get('/health/live', c => c.json({ status: 'ok' }));
  app.get('/health/ready', c => c.json({ status: ready ? 'ready' : 'draining' }, ready ? 200 : 503));
  app.get('/api/v1/capabilities', c => json(c, { version: '0.1.0', revision, commit,
    authorityId: snapshot.authorityId, publicRead: true, boundedGraph: true,
    revisionNotifications: true, storage: 'git-approved-public-snapshot',
    privateCommands: false, identityIntegration: false, payments: false,
    distributedPrivateReplay: false, databaseMigration: false }));
  app.get('/api/v1/public/catalogue', c => json(c, { ...snapshot, revision }));
  app.get('/api/v1/public/projects', c => {
    const query = c.req.query('q') ?? ''; const stage = c.req.query('stage') ?? '';
    const limit = Number(c.req.query('limit') ?? 100); const offset = Number(c.req.query('offset') ?? 0);
    if (query.length > 128 || !['', 'research', 'development', 'production', 'unverified'].includes(stage) ||
        !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
      return failure(c, 400, 'invalid_query');
    }
    return json(c, { revision, ...catalogue.list({ query, stage, limit, offset }) });
  });
  app.get('/api/v1/public/projects/:id', c => {
    const project = catalogue.get(c.req.param('id'));
    return project ? json(c, { revision, authorityId: snapshot.authorityId,
      orgId: snapshot.orgId, project }) : failure(c, 404, 'project_not_found');
  });
  app.get('/api/v1/public/graph', c => {
    const root = c.req.query('root') ?? 'onlyjah';
    const depth = Number(c.req.query('depth') ?? 2); const limit = Number(c.req.query('limit') ?? 100);
    if (!Number.isInteger(depth) || depth < 0 || depth > 4 || !Number.isInteger(limit) || limit < 1 || limit > 200) {
      return failure(c, 400, 'invalid_graph_bounds');
    }
    const graph = catalogue.graph({ root, depth, limit });
    return graph ? json(c, { revision, ...graph }) : failure(c, 404, 'project_not_found');
  });
  app.get('/api/v1/public/events', c => streams.response(c.req.raw.signal));
  app.get('/openapi.json', async c => c.body(await readFile(new URL('../contracts/openapi.json', import.meta.url), 'utf8'), 200, { 'Content-Type': 'application/json' }));
  app.all('/api/v1/orgs/*', c => failure(c, 401, 'verified_session_and_resource_grant_required'));
  app.all('/api/*', c => failure(c, 405, 'operation_not_enabled'));
  app.notFound(c => failure(c, 404, 'not_found'));
  app.onError((_error, c) => failure(c, 500, 'internal_error'));
  return { app, revision, close() { ready = false; streams.close(); }, streams };
}
