import {readFileSync,writeFileSync} from 'node:fs'
// Jah Noah [Q008]: "let's explore this nebula. Let's coalesce it into something that I can deploy"
// Engineering: produce a single Railway Function from the same tested Hono gateway, with explicit external package versions.
const contracts=readFileSync('packages/contracts/src/index.ts','utf8');
const gateway=readFileSync('apps/gateway/src/gateway.ts','utf8').replace(/^import .*from ['"]\.\.[^\n]+\n/gm,'').replaceAll("from 'hono'","from 'hono@4.13.13'").replaceAll("from 'hono/body-limit'","from 'hono@4.13.13/body-limit'");
const entry=readFileSync('apps/gateway/src/index.ts','utf8').replace(/^import .*from ['"]\.\/gateway.ts['"]\n/gm,'').replaceAll("from '@clerk/backend'","from '@clerk/backend@3.23.1'");
writeFileSync('railway/ark-gateway.function.ts',[contracts,gateway,entry].join('\n'));
