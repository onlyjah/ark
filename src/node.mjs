// Host adapter only: Railway uses PORT, owned hosts can use the same OCI image.
// No Railway API token, database credential or implicit workspace authority.
import { serve } from '@hono/node-server';
import { createApp } from './app.mjs';
import { loadGitSnapshot } from './adapters/git-snapshot.mjs';
const instance = createApp(await loadGitSnapshot(), { commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? 'local' });
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const server = serve({ fetch: instance.app.fetch, hostname: '0.0.0.0', port });
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.maxHeadersCount = 64;
console.log(JSON.stringify({ service: 'ark-constellation', port, revision: instance.revision }));
let stopping = false;
function stop() {
  if (stopping) return; stopping = true; instance.close();
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
