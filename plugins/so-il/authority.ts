import { createHmac, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { Fault, requireThat } from '../../packages/core/store.ts';
import { boundedBody, response } from '../../packages/http/request.ts';

export type PortalAuthority = {v:1; app:string; audience:string; subject?:string; owner?:string; resource?:string; action:string; expires:number; nonce:string; request:string};
export type Fetcher = (r:Request)=>Promise<Response>;
export const PORTAL_HEADER='x-ark-portal-authority';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const forwardedHeaders=['authorization','x-soil-client-id','cookie','origin','content-type','stripe-signature','x-ark-csrf','x-ark-operation','idempotency-key','sec-fetch-site','x-forwarded-for'];
function key(secret:string) {requireThat(/^[a-f0-9]{64}$/i.test(secret),503,'portal authority key not configured');return Buffer.from(secret,'hex');}
function binding(r:Request,body:Buffer) {
 const url=new URL(r.url);
 return hash(JSON.stringify([r.method,url.pathname+url.search,hash(body),forwardedHeaders.map(name=>[name,hash(r.headers.get(name)||'')])]));
}
function signature(value:string,secret:string){return createHmac('sha256',key(secret)).update(value).digest('base64url');}
export function issueAuthority(r:Request,body:Buffer,secret:string,scope:{app:string;audience:string;action:string;subject?:string;owner?:string;resource?:string},expires=Date.now()+30000) {
 requireThat(expires>Date.now()&&expires<=Date.now()+30000,403,'portal session expiry required');
 const grant:PortalAuthority={v:1,...scope,expires,nonce:randomUUID(),request:binding(r,body)};
 const value=Buffer.from(JSON.stringify(grant)).toString('base64url');
 return value+'.'+signature(value,secret);
}
export async function portalRequest(r:Request,url:string,secret:string,scope:{app:string;audience:string;action:string;subject?:string;owner?:string;resource?:string},body?:Buffer,expires?:number) {
 const bytes=body??await boundedBody(r,26_000_000);
 const headers=new Headers();
 for(const name of forwardedHeaders) {
  const value=r.headers.get(name);if(value)headers.set(name,value);
 }
 const outgoing=new Request(url,{method:r.method,headers,body:['GET','HEAD'].includes(r.method)?undefined:bytes,redirect:'error'});
 headers.set(PORTAL_HEADER,issueAuthority(outgoing,bytes,secret,scope,expires));
 return new Request(outgoing,{headers});
}
export function protectPortal(secret:string|Record<string,string>,audience:string,handler:(r:Request,grant:PortalAuthority)=>Promise<Response|null>):Fetcher {
 for(const value of typeof secret==='string'?[secret]:Object.values(secret))key(value);
 const used=new Map<string,number>();
 return async(r:Request)=>{
  if(r.method==='GET'&&new URL(r.url).pathname==='/health')return response({status:'ok'});
  try {
   const token=r.headers.get(PORTAL_HEADER)||'';
   requireThat(token.length>0&&token.length<8192,403,'portal authority required');
   const parts=token.split('.');requireThat(parts.length===2,403,'invalid portal authority');
   let grant:PortalAuthority;try{grant=JSON.parse(Buffer.from(parts[0],'base64url').toString());}catch{throw new Fault(403,'invalid portal authority');}
   const signingKey=typeof secret==='string'?secret:secret[grant.app];requireThat(signingKey,403,'app has no portal key');
   const expected=Buffer.from(signature(parts[0],signingKey)),actual=Buffer.from(parts[1]);
   requireThat(expected.length===actual.length&&timingSafeEqual(expected,actual),403,'invalid portal signature');
   requireThat(grant.v===1&&grant.audience===audience&&typeof grant.app==='string'&&typeof grant.action==='string'&&typeof grant.nonce==='string'&&grant.expires>Date.now()&&grant.expires<=Date.now()+30000,403,'expired or misdirected portal');
   const bytes=await boundedBody(r,26_000_000);
   requireThat(grant.request===binding(r,bytes),403,'portal request changed');
   for(const [nonce,until] of used)if(until<=Date.now())used.delete(nonce);
   requireThat(!used.has(grant.nonce),409,'portal request already used');
   requireThat(used.size<10000,429,'portal capacity reached');used.set(grant.nonce,grant.expires);
   const safe=new Request(r,{body:['GET','HEAD'].includes(r.method)?undefined:bytes});
   return await handler(safe,grant)||response({error:'portal route not found'},404);
  }catch(e){return response({error:e instanceof Fault?e.message:'Portal unavailable.'},e instanceof Fault?e.status:503);}
 };
}
export function assertPortScope(grant:PortalAuthority,scope:{app:string;audience:string;owner:string;resource:string;action:string;subjects?:string[]}) {
 requireThat(grant.subject&&grant.app===scope.app&&grant.audience===scope.audience&&grant.owner===scope.owner&&grant.resource===scope.resource&&grant.action===scope.action,403,'resource capability mismatch');
 requireThat(grant.subject===scope.owner||scope.subjects?.includes(grant.subject!),403,'recipient membership denied');
}
