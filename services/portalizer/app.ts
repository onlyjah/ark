import { accountsClient } from '../accounts/client.ts';
import { portalRequest } from '../../plugins/so-il/authority.ts';
import { createRegistry, publicPort, type PortEntry } from '../../plugins/so-il/registry.ts';
import { boundedBody, requireOrigin, response } from '../../packages/http/request.ts';
import { Fault, requireThat } from '../../packages/core/store.ts';
import type { Member } from '../../packages/contracts.ts';
import { decodeJwt } from 'jose';
import { soilConfig } from '../../xtp/soil/config.ts';
import { requireSoilScope } from '../../xtp/soil/server.ts';
export function createApp(env:Record<string,string|undefined>,send:typeof fetch=fetch,options?:{entries?:PortEntry[];authenticate?:(r:Request)=>Promise<Member|null>}) {
 const ports=createRegistry(options?.entries||JSON.parse(env.ARK_PORT_ENTRIES||'[]'));
 const account=accountsClient({...env,ARK_SERVICE_ID:'portalizer'},send);
 const authenticate=options?.authenticate||account.authenticate;
 const soil=soilConfig(env);
 async function forward(r:Request,target:string,audience:string,action:string) {
  requireThat(target,503,'portal destination not configured');
  const url=new URL(r.url),outgoing=new URL(url.pathname+url.search,target);
  const bytes=await boundedBody(r,url.pathname.startsWith('/v1/')?1_500_000:url.pathname==='/app/api/files'&&r.method==='POST'?25*1024*1024:2_000_000);
  const signed=await portalRequest(r,outgoing.href,env[`ARK_${audience.toUpperCase()}_PORTAL_KEY`]!,{app:'ark-kash',audience,action},bytes);
  return send(signed,{redirect:'error',signal:AbortSignal.timeout(15000)});
 }
 async function status(target:string,audience:string) {
  const url=new URL('/internal/status',target);
  const r=await portalRequest(new Request(url),url.href,env[`ARK_${audience.toUpperCase()}_PORTAL_KEY`]!,{app:audience==='accounts'?'ark-kash':'portalizer',audience,action:'status'});
  const result=await send(r,{redirect:'error',signal:AbortSignal.timeout(15000)});requireThat(result.ok,503,'service configuration unavailable');return result.json();
 }
 return {fetch:async(r:Request):Promise<Response>=>{
  try {
   const path=new URL(r.url).pathname;
   if(path==='/app')return Response.redirect(new URL('/app/',r.url),302);
   if(path==='/'&&r.method==='GET')return Response.redirect(new URL('/app/',r.url),302);
   if(path==='/health'&&r.method==='GET')return await forward(r,env.ARK_WORKSPACE_URL!,'workspace','core');
   if(path==='/app/api/config'&&r.method==='GET') {
    const [identity,billing]=await Promise.all([status(env.ARK_ACCOUNTS_URL!,'accounts'),status(env.ARK_BILLING_URL!,'billing')]);
    return response({...identity,...billing,version:'0.4.0',soil:{mode:soil.mode,api_url:soil.apiUrl,app_url:soil.appUrl,audience:soil.audience},pilot_access:soil.mode==='compatible'});
   }
   if(path==='/ports'&&r.method==='GET') {
    requireOrigin(r,env.ARK_APP_ORIGIN!);const member=await authenticate(r);requireThat(member,401,'session required');
    if(soil.mode==='soil')requireSoilScope(member!.soil,'ports:read');
    const app=r.headers.get('x-ark-app-id');requireThat(app,403,'application identity required');
    return response([...ports.values()].filter(p=>p.app===app&&(p.owner===member!.id||p.subjects?.includes(member!.id))).map(publicPort));
   }
   const port=path.match(/^\/ports\/([a-z0-9-]{1,64})$/);
   if(port){
    requireOrigin(r,env.ARK_APP_ORIGIN!);
    const entry=ports.get(port[1]);requireThat(entry,404,'port not found');
    requireThat(r.headers.get('x-ark-app-id')===entry!.app&&entry!.methods.includes(r.method),403,'app or operation not permitted');
    const member=await authenticate(r);requireThat(member&&(member.id===entry!.owner||entry!.subjects?.includes(member.id)),403,'resource access denied');
    if(soil.mode==='soil')requireSoilScope(member!.soil,'ports:use');
    // Authentication above verifies this JWT. Its expiry bounds this request grant.
    const bearer=r.headers.get('authorization');requireThat(bearer?.startsWith('Bearer '),401,'session required');
    const session=decodeJwt(bearer!.slice(7));requireThat(typeof session.exp==='number'&&session.exp*1000>Date.now(),401,'session expired');
    const bytes=await boundedBody(r,entry!.maxBytes??2_000_000);
    const headers=new Headers();for(const name of ['content-type','origin','sec-fetch-site','idempotency-key']){const v=r.headers.get(name);if(v)headers.set(name,v);}
    // An application receives scoped authority, never the user's identity token or cookies.
    const clean=new Request(entry!.destination,{method:r.method,headers,body:['GET','HEAD'].includes(r.method)?undefined:bytes});
    const signed=await portalRequest(clean,entry!.destination,entry!.secret,{app:entry!.app,audience:entry!.audience,action:entry!.action,subject:member!.id,owner:entry!.owner,resource:entry!.resource},bytes,Math.min(Date.now()+30000,session.exp*1000));
    return await send(signed,{redirect:'error',signal:AbortSignal.timeout(15000)});
   }
   if(path.startsWith('/internal/')||path.startsWith('/ports'))return response({error:'route not found'},404);
   if(path.startsWith('/app/api/billing/'))return await forward(r,env.ARK_BILLING_URL!,'billing','billing');
   if(path==='/app/api/account/keys')return await forward(r,env.ARK_ACCOUNTS_URL!,'accounts','account.keys');
   if(path.startsWith('/app/api/')||path.startsWith('/v1/')||path==='/feed.xml'||path==='/publications'||/^\/publications\/[a-f0-9-]{36}(\.md)?$/.test(path))return await forward(r,env.ARK_WORKSPACE_URL!,'workspace',path.startsWith('/v1/')?'core':'workspace');
   if(path==='/app/'||path.startsWith('/app/')||/^\/p\/[a-f0-9-]{36}$/.test(path))return await forward(r,env.ARK_CLIENT_URL!,'client','client.read');
   return response({error:'route not found'},404);
  }catch(e){return response({error:e instanceof Fault?e.message:'Portal service unavailable.'},e instanceof Fault?e.status:503);}
 },close:async()=>{}};
}
