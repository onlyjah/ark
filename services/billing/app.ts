import { createBilling } from './module.ts';
import { accountsClient } from '../accounts/client.ts';
import { protectPortal } from '../../plugins/so-il/authority.ts';
import { response } from '../../packages/http/request.ts';
import { requireThat } from '../../packages/core/store.ts';
export function createApp(env:Record<string,string|undefined>,send:typeof fetch=fetch) {
 const accounts=accountsClient({...env,ARK_SERVICE_ID:'billing'},send);
 const billing=createBilling(env,env.ARK_APP_ORIGIN!,accounts.authenticate);
 return {fetch:protectPortal(env.ARK_BILLING_PORTAL_KEY!,'billing',async(r,grant)=>{
  requireThat(grant.app==='ark-kash'||grant.app==='portalizer',403,'app has no billing capability');
  if(new URL(r.url).pathname==='/internal/status'&&r.method==='GET')return response({billing_ready:billing.billingReady,stripe_mode:env.STRIPE_MODE==='live'?'live':'test',monthly_usd:20});
  requireThat(grant.app==='ark-kash'&&grant.action==='billing',403,'billing capability required');
  return billing.handle(r);
 }),close:async()=>{}};
}
