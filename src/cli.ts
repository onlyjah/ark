import { Store } from './store.ts';
import { createApi } from './api.ts';
import { replicate } from './peer.ts';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, cpSync, writeFileSync } from 'node:fs';

// Jah Noah [Q008]: "let's explore this nebula. Let's coalesce it into something that I can deploy"
// Engineering: explicit local administration keeps enrollment separate from public room permissions.
const [command='help', ...args]=process.argv.slice(2);
const root=resolve(process.env.ARK_DATA || './data');
if (command==='help') {
  console.log(`Ark Core 0.1 pilot (Node 24)
ARK_DATA=./data node src/cli.ts serve
node src/cli.ts identity NAME [human|service] [admin] [TTL_SECONDS]
node src/cli.ts revoke IDENTITY_ID
node src/cli.ts node
node src/cli.ts replicate PEERS_JSON PEER_NAME RESOURCE_ID [REVISION_ID]
node src/cli.ts export NEW_DIRECTORY
Credentials are emitted once by identity. Protect local data and peer files.
Default listener: 127.0.0.1:8080. Set ARK_HOST/PORT only behind a TLS proxy.`);
} else {
  const store=new Store(root);
  try {
    if(command==='serve') {
      const server=createApi(store), port=Number(process.env.PORT || 8080),host=process.env.ARK_HOST || '127.0.0.1';
      server.listen(port,host,()=>console.log(JSON.stringify({service:'ark-core',node_id:store.nodeId(),host,port:server.address()})));
      for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
    } else {
      let result: any;
      if(command==='identity') result=store.issue(args[0] || '',args[1]!=='service',args[2]==='admin',Number(args[3] || 86400));
      else if(command==='revoke') { store.revoke(args[0]); result={revoked:args[0]}; }
      else if(command==='node') result={node_id:store.nodeId()};
      else if(command==='replicate') result=await replicate(store,args[0],args[1],args[2],args[3]);
      else if(command==='export') {
        const destination=resolve(args[0] || '');
        if(!args[0] || existsSync(destination) || destination.startsWith(root+'/')) throw new Error('export requires a new directory outside the data root');
        mkdirSync(destination,{mode:0o700});
        // Jah Noah [Q007]: "all my projects are sovereign"
        // Engineering: take the metadata snapshot before copying immutable objects; extra blobs are harmless.
        store.db.prepare('VACUUM INTO ?').run(join(destination,'ark.sqlite'));
        cpSync(join(root,'blobs'),join(destination,'blobs'),{recursive:true});
        writeFileSync(join(destination,'export.json'),JSON.stringify({format:1,node_id:store.nodeId(),created_at:new Date().toISOString()}));
        result={exported:destination};
      } else throw new Error('unknown command; use help');
      console.log(JSON.stringify(result)); store.close();
    }
  } catch(e) {store.close();console.error(e instanceof Error?e.message:'command failed');process.exitCode=1;}
}
