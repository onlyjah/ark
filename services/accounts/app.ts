import { createAccounts } from './module.ts';
import { Fault, requireThat } from '../../packages/core/store.ts';
import { protectPortal } from '../../plugins/so-il/authority.ts';
import { jsonBody, response } from '../../packages/http/request.ts';
export function createApp(env:Record<string,string|undefined>) {
 const accounts=createAccounts(env,env.ARK_APP_ORIGIN!);
 const handler=protectPortal({'ark-kash':env.ARK_ACCOUNTS_PORTAL_KEY!,workspace:env.ARK_ACCOUNTS_WORKSPACE_KEY!,billing:env.ARK_ACCOUNTS_BILLING_KEY!,portalizer:env.ARK_ACCOUNTS_PORTALIZER_KEY!},'accounts',async(r,grant)=>{
  const path=new URL(r.url).pathname;
  try {
   requireThat(['ark-kash','workspace','billing','portalizer'].includes(grant.app),403,'app has no account capability');
   if(path==='/internal/status'&&r.method==='GET')return response({auth_url:accounts.identityReady?accounts.authUrl:null});
   if(path==='/internal/identity'&&r.method==='POST'){
    requireThat(grant.action==='account.verify',403,'identity capability required');
    const member=await accounts.authenticate(r);requireThat(member,401,'Sign in with OnlyJah.');return response(member);
   }
   if(path==='/internal/envelope'&&r.method==='POST'){
    requireThat(grant.app==='workspace'&&grant.action==='account.verify',403,'workspace capability required');
    const member=await accounts.authenticate(r);requireThat(member,401,'Sign in with OnlyJah.');
    const value=await jsonBody(r,2_000_000);requireThat(value.member_id===member!.id,403,'account mismatch');
    requireThat(typeof value.context==='string'&&new RegExp('^'+member!.id+':[a-f0-9-]{36}:document$').test(value.context),403,'resource owner mismatch');
    await accounts.verifyEnvelope(member!,value.envelope,value.context);return response({verified:true});
   }
   if(path.startsWith('/internal/'))return response({error:'account route not found'},404);
   requireThat(grant.app==='ark-kash'&&grant.action==='account.keys',403,'key capability required');
   return accounts.handle(r);
  }catch(e){return response({error:e instanceof Fault?e.message:'Account service unavailable.'},e instanceof Fault?e.status:503);}
 });
 return {fetch:handler,close:async()=>{}};
}
