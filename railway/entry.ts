// Jah Noah [Q007]: "all my projects are sovereign"
// Engineering: refuse to initialize private data on Railway's ephemeral filesystem.
const bundleTest = process.env.ARK_BUNDLE_TEST === '1';
const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
requireThat(bundleTest || mount === '/data', 500, 'Ark Core requires a persistent Railway volume mounted at /data');
const runtime = (globalThis as any).Bun;
const env = runtime?.env || process.env;
const liveStore = new Store(env.ARK_DATA || '/data');
const bootstrapHash = env.ARK_BOOTSTRAP_TOKEN_HASH;
const bootstrapId = env.ARK_BOOTSTRAP_ID;
if (!liveStore.one('SELECT 1 FROM credentials LIMIT 1')) {
  requireThat(/^[a-f0-9]{64}$/.test(bootstrapHash || '') && /^[a-f0-9-]{36}$/.test(bootstrapId || ''),500,'operator enrollment configuration missing');
  liveStore.atomic(()=>{
    liveStore.run('INSERT INTO identities VALUES(?,?,1)',bootstrapId,'Ark pilot operator');
    liveStore.run('INSERT INTO credentials VALUES(?,?,1,?,0)',bootstrapHash,bootstrapId,Date.now()+30*86400000);
  });
}

// Jah Noah [Q017]: "if if I could use TCP plus Web Sockets for everything That'd be great"
// Engineering: the Bun entry forwards bounded requests to the existing Node-compatible HTTP handler.
const internalServer = createApi(liveStore);
await new Promise<void>((resolve,reject)=>{
  internalServer.once('error',reject);
  internalServer.listen(0,'127.0.0.1',()=>resolve());
});
const internalPort=(internalServer.address() as any).port;
// Jah Noah [Q005]: "we have the file backed up across these different places"
// Engineering: personal article bodies and attachments live in a private object bucket; metadata stays on the persistent volume.
const archiveClient=runtime?.S3Client && env.ARK_ARCHIVE_BUCKET ? new runtime.S3Client({endpoint:env.ARK_ARCHIVE_ENDPOINT,bucket:env.ARK_ARCHIVE_BUCKET,region:env.ARK_ARCHIVE_REGION,accessKeyId:env.ARK_ARCHIVE_ACCESS_KEY_ID,secretAccessKey:env.ARK_ARCHIVE_SECRET_ACCESS_KEY}) : null;
const webHandler=createWeb(liveStore,env.ARK_APP_ORIGIN||'http://test',webAssets,archiveClient?{
  async put(key:string,bytes:Buffer){await archiveClient.file(key).write(bytes,{type:'application/octet-stream'});},
  async get(key:string){return Buffer.from(await archiveClient.file(key).arrayBuffer());},
  async remove(key:string){await archiveClient.file(key).delete();}
}:null);
const application = {
  port: Number(env.PORT || 8080),
  hostname: '0.0.0.0',
  async fetch(request: Request): Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname==='/app')return Response.redirect(new URL('/app/',request.url),302);
    const webResponse=await webHandler(request);if(webResponse)return webResponse;
    if(request.method==='GET' && url.pathname==='/') return Response.json({service:'Ark Core',version:'0.1.0',health:'/health',api:'/v1',status:'pilot'});
    const advertised=Number(request.headers.get('content-length') || 0);
    if(advertised>1500000) return Response.json({error:'request too large'},{status:413});
    const chunks:Uint8Array[]=[];let length=0;
    if(request.body) {
      const reader=request.body.getReader();
      try {
        while(true) {
          const {done,value}=await reader.read();if(done)break;
          length+=value.length;
          if(length>1500000) {await reader.cancel();return Response.json({error:'request too large'},{status:413});}
          chunks.push(value);
        }
      } finally {reader.releaseLock();}
    }
    const headers=new Headers();
    for(const key of ['authorization','idempotency-key','content-type','origin']) {
      const value=request.headers.get(key);if(value)headers.set(key,value);
    }
    return fetch(`http://127.0.0.1:${internalPort}${url.pathname}${url.search}`,{
      method:request.method,headers,body:chunks.length?Buffer.concat(chunks):undefined,
      redirect:'error',signal:AbortSignal.timeout(15000)
    });
  }
};
export default application;
function shutdown() {internalServer.close(()=>{liveStore.close();process.exit(0);});}
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,shutdown);
console.log(JSON.stringify({service:'ark-core',node_id:liveStore.nodeId(),storage:'persistent',runtime:runtime?.version || 'node-test'}));

// Jah Noah [Q012]: "I- I want OnlyJah to be able to run lean"
// Engineering: tests can release the internal listener; this is never a remote API capability.
export async function disposeBundleForTest() {
  requireThat(bundleTest,403,'test disposal disabled');
  await new Promise<void>(resolve=>internalServer.close(()=>resolve()));
  liveStore.close();
}
