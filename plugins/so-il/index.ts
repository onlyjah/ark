export { portalRequest,protectPortal,assertPortScope,PORTAL_HEADER } from './authority.ts';
export type { PortalAuthority,Fetcher } from './authority.ts';
export { createRegistry,publicPort } from './registry.ts';
export type { PortEntry } from './registry.ts';

export async function invokePort(origin:string,port:string,app:string,token:string,options:{method?:string;body?:string;signal?:AbortSignal;operationId?:string}={}) {
 if(!/^[a-z0-9-]{1,64}$/.test(port))throw Error('invalid port id');
 const url=new URL('/ports/'+port,origin);
 if(url.protocol!=='https:'&&url.hostname!=='localhost'&&url.hostname!=='127.0.0.1')throw Error('HTTPS portal required');
 if(options.operationId&&!/^[a-f0-9-]{36}$/i.test(options.operationId))throw Error('invalid operation id');
 return fetch(url,{method:options.method||'GET',headers:{authorization:'Bearer '+token,'x-ark-app-id':app,'content-type':'application/json',...(options.operationId?{'idempotency-key':options.operationId}:{})},body:options.body,credentials:'same-origin',redirect:'error',signal:options.signal});
}
