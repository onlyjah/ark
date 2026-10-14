import Stripe from 'stripe';
import { createAccounts } from '../services/accounts/module.ts';
import { createBilling } from '../services/billing/module.ts';
import { response } from '../packages/http/request.ts';
import type { Saas } from '../packages/contracts.ts';
export type { Member, Saas } from '../packages/contracts.ts';
// Compatibility facade for the existing archive API and single-container mode.
export function createSaas(env:Record<string,string|undefined>,origin:string,adapters?:{sql?:any;stripeClient?:Stripe}):Saas {
 const accounts=createAccounts(env,origin,adapters);
 const billing=createBilling(env,origin,accounts.authenticate,adapters);
 return {authUrl:accounts.authUrl,billingReady:billing.billingReady,authenticate:accounts.authenticate,verifyEnvelope:accounts.verifyEnvelope,
  async handle(r:Request) {
   if(new URL(r.url).pathname==='/app/api/config'&&r.method==='GET')return response({auth_url:accounts.identityReady?accounts.authUrl:null,billing_ready:billing.billingReady,stripe_mode:env.STRIPE_MODE==='live'?'live':'test',monthly_usd:20});
   return await accounts.handle(r)||await billing.handle(r);
  }
 };
}
