import { portalRequest } from '../../plugins/so-il/authority.ts';
import type { Member, Saas } from '../../packages/contracts.ts';
import { Fault, requireThat } from '../../packages/core/store.ts';
export function accountsClient(env:Record<string,string|undefined>,send:typeof fetch=fetch):Saas {
 const base=env.ARK_ACCOUNTS_URL!,caller=env.ARK_SERVICE_ID||'portalizer';
 const secret=env[`ARK_ACCOUNTS_${caller.toUpperCase()}_KEY`]!;
 const tokens=new WeakMap<Member,string>();
 const clients=new WeakMap<Member,string>();
 async function rpc(path:string,r:Request,value?:any) {
  const url=new URL(path,base);
  const headers=new Headers();const token=r.headers.get('authorization');if(token)headers.set('authorization',token);
  const client=r.headers.get('x-soil-client-id');if(client)headers.set('x-soil-client-id',client);
  headers.set('content-type','application/json');
  const request=new Request(url,{method:'POST',headers,body:JSON.stringify(value??{})});
  const outgoing=await portalRequest(request,url.href,secret,{app:caller,audience:'accounts',action:'account.verify'});
  const result=await send(outgoing,{signal:AbortSignal.timeout(15000)});
  if(!result.ok){const v=await result.json().catch(()=>({}));throw new Fault(result.status,v.error||'account service unavailable');}
  return result.json();
 }
 return {authUrl:env.NEON_AUTH_BASE_URL||'',billingReady:false,
  async authenticate(r){const token=r.headers.get('authorization');if(!token)return null;const member=await rpc('/internal/identity',r) as Member;tokens.set(member,token);const client=r.headers.get('x-soil-client-id');if(client)clients.set(member,client);return member;},
  async verifyEnvelope(member,envelope,context){
   // This RPC needs the original token, attached only by authenticate on this request.
   const token=tokens.get(member);requireThat(token,401,'request identity missing');
   await rpc('/internal/envelope',new Request(base,{headers:{authorization:token,...(clients.has(member)?{'x-soil-client-id':clients.get(member)!}:{})}}),{envelope,context,member_id:member.id});
  },
  async handle(){return null;}
 };
}
