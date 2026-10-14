import { Store, requireThat } from '../../packages/core/store.ts';
import { createApi } from '../../packages/core/api.ts';
import { createWeb } from './web.ts';
import { accountsClient } from '../accounts/client.ts';
import { protectPortal } from '../../plugins/so-il/authority.ts';
import { boundedBody, response } from '../../packages/http/request.ts';
import { soilConfig } from '../../xtp/soil/config.ts';
import { requireSoilScope } from '../../xtp/soil/server.ts';
import { localArchive } from '../../packages/storage/local.ts';
import { join } from 'node:path';
export async function createApp(env:Record<string,string|undefined>,send:typeof fetch=fetch) {
 requireThat(env.ARK_BUNDLE_TEST==='1'||(env.RAILWAY_VOLUME_MOUNT_PATH||env.ARK_VOLUME_MOUNT_PATH)==='/data',500,'Workspace requires a persistent volume at /data');
 const store=new Store(env.ARK_DATA||'/data');
 try {
  if(!store.one('SELECT 1 FROM credentials LIMIT 1')){
   requireThat(/^[a-f0-9]{64}$/.test(env.ARK_BOOTSTRAP_TOKEN_HASH||'')&&/^[a-f0-9-]{36}$/.test(env.ARK_BOOTSTRAP_ID||''),500,'operator enrollment configuration missing');
   store.atomic(()=>{store.run('INSERT INTO identities VALUES(?,?,1)',env.ARK_BOOTSTRAP_ID,'Ark pilot operator');store.run('INSERT INTO credentials VALUES(?,?,1,?,0)',env.ARK_BOOTSTRAP_TOKEN_HASH,env.ARK_BOOTSTRAP_ID,Date.now()+30*86400000);});
  }
  const runtime=(globalThis as any).Bun;
  const s3=runtime?.S3Client&&env.ARK_ARCHIVE_BUCKET?new runtime.S3Client({endpoint:env.ARK_ARCHIVE_ENDPOINT,bucket:env.ARK_ARCHIVE_BUCKET,region:env.ARK_ARCHIVE_REGION,accessKeyId:env.ARK_ARCHIVE_ACCESS_KEY_ID,secretAccessKey:env.ARK_ARCHIVE_SECRET_ACCESS_KEY}):null;
  requireThat(!(s3&&env.ARK_ARCHIVE_LOCAL==='1'),500,'Choose one archive adapter explicitly');
  const archive=s3?{async put(k:string,b:Buffer){await s3.file(k).write(b,{type:'application/octet-stream'});},async get(k:string){return Buffer.from(await s3.file(k).arrayBuffer());},async remove(k:string){await s3.file(k).delete();}}:env.ARK_ARCHIVE_LOCAL==='1'?localArchive(join(env.ARK_DATA||'/data','objects')):null;
  const accounts=accountsClient({...env,ARK_SERVICE_ID:'workspace'},send);
  const soilRequired=soilConfig(env).mode==='soil';
  const web=createWeb(store,env.ARK_APP_ORIGIN!,{},archive,accounts,{soilRequired});
  const api=createApi(store,soilRequired?{origin:env.ARK_APP_ORIGIN,async authenticate(req){
   const headers=new Headers();for(const name of ['authorization','x-soil-client-id']){const v=req.headers[name];if(typeof v==='string')headers.set(name,v);}
   const member=await accounts.authenticate(new Request(env.ARK_APP_ORIGIN!+req.url,{headers}));
   requireSoilScope(member?.soil,'ark:api');
   const identity=store.one('SELECT * FROM identities WHERE id=?',member!.id);
   requireThat(identity,403,'SO/IL account is not enrolled on this Ark');return {...identity,admin:0};
  }}:{});
  await new Promise<void>((resolve,reject)=>{api.once('error',reject);api.listen(0,'127.0.0.1',()=>resolve());});
  const port=(api.address() as any).port;
  return {fetch:protectPortal(env.ARK_WORKSPACE_PORTAL_KEY!,'workspace',async(r,grant)=>{
   requireThat(grant.app==='ark-kash'&&['workspace','core'].includes(grant.action),403,'workspace capability required');
   const result=await web(r);if(result)return result;
   const path=new URL(r.url);if(path.pathname!=='/health'&&!path.pathname.startsWith('/v1/'))return response({error:'route not found'},404);
   const bytes=await boundedBody(r,1_500_000);const headers=new Headers();
   for(const name of ['authorization','x-soil-client-id','idempotency-key','content-type','origin']){const v=r.headers.get(name);if(v)headers.set(name,v);}
   return fetch(`http://127.0.0.1:${port}${path.pathname}${path.search}`,{method:r.method,headers,body:['GET','HEAD'].includes(r.method)?undefined:bytes,redirect:'error',signal:AbortSignal.timeout(15000)});
  }),close:async()=>{await new Promise<void>(resolve=>api.close(()=>resolve()));store.close();},nodeId:store.nodeId()};
 }catch(e){store.close();throw e;}
}
