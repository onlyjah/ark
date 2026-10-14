import { Fault, requireThat } from '../core/store.ts';
export const response=(value:any,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
export async function boundedBody(r:Request,max=65536):Promise<Buffer> {
  requireThat(Number(r.headers.get('content-length')||0)<=max,413,'request too large');
  const reader=r.body?.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  if(reader)try{while(true){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>max){await reader.cancel();throw new Fault(413,'request too large');}chunks.push(v.value);}}finally{reader.releaseLock();}
  return Buffer.concat(chunks);
}
export async function jsonBody(r:Request,max=65536) {
  try{return JSON.parse((await boundedBody(r,max)).toString());}catch(e){if(e instanceof Fault)throw e;throw new Fault(400,'invalid JSON');}
}
export function requireOrigin(r:Request,origin:string) {
  requireThat(!['cross-site','same-site'].includes(r.headers.get('sec-fetch-site')||''),403,'cross-site request blocked');
  requireThat(!r.headers.get('origin')||r.headers.get('origin')===origin,403,'untrusted origin');
  if(!['GET','HEAD','OPTIONS'].includes(r.method))requireThat(r.headers.get('origin')===origin,403,'origin required');
}
