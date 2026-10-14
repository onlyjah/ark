import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import Stripe from 'stripe';
import { Fault, requireThat } from '../../packages/core/store.ts';
import { subscriptionEntitled, claimMatches } from '../../packages/billing/policy.ts';
import type { Member } from '../../packages/contracts.ts';
import { response, boundedBody as saasBody, requireOrigin } from '../../packages/http/request.ts';
const saasHash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function createBilling(env:Record<string,string|undefined>,origin:string,authenticate:(r:Request)=>Promise<Member|null>,adapters?:{sql?:any;stripeClient?:Stripe}) {
  const sql=adapters?.sql||(env.ARK_DATABASE_URL?neon(env.ARK_DATABASE_URL):null);
  const stripeClient=adapters?.stripeClient||(env.STRIPE_RESTRICTED_KEY?new Stripe(env.STRIPE_RESTRICTED_KEY,{maxNetworkRetries:2,timeout:15000}):null);
  const priceId=env.STRIPE_PRICE_ID||'',webhookSecret=env.STRIPE_WEBHOOK_SECRET||'',live=env.STRIPE_MODE==='live';
  const billingReady=!!(sql&&stripeClient&&priceId&&webhookSecret);
  const rate=new Map<string,{count:number,until:number}>();
  function checkoutLimit(r:Request){const key=r.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';const v=rate.get(key);const n=v&&v.until>Date.now()?v:{count:0,until:Date.now()+600000};requireThat(++n.count<=6,429,'Please wait before starting another checkout.');if(rate.size>10000)rate.clear();rate.set(key,n);}
  async function observeSubscription(subId:string,observedAt:number){
    const sub:any=await stripeClient!.subscriptions.retrieve(subId,{expand:['latest_invoice']});
    const claimId=sub.metadata?.ark_claim_id;
    if(sub.metadata?.ark_app!=='ark-kash'||!claimId||!/^[a-f0-9-]{36}$/.test(claimId))return;
    const rows=await sql!`SELECT * FROM ark_kash.purchases WHERE id=${claimId}::uuid`;
    const purchase=rows[0];if(!purchase)return;requireThat(purchase.checkout_id,503,'Checkout registration pending. Retry delivery.');
    const checkout:any=await stripeClient!.checkout.sessions.retrieve(purchase.checkout_id);
    requireThat(checkout.subscription===sub.id||checkout.subscription?.id===sub.id,400,'subscription mismatch');
    const customer=typeof sub.customer==='string'?sub.customer:sub.customer.id;
    const snap={status:sub.status,paid:sub.latest_invoice?.status==='paid',priceIds:sub.items.data.map((i:any)=>i.price.id),periodEnd:Math.min(...sub.items.data.map((i:any)=>i.current_period_end)),livemode:sub.livemode};
    const granted=subscriptionEntitled(snap,priceId,live)&&checkout.payment_status==='paid';
    await sql!`UPDATE ark_kash.purchases SET customer_id=${customer},subscription_id=${sub.id},payment_email=${checkout.customer_details?.email||checkout.customer_email||null},status=${granted?'active':sub.status==='active'?'unpaid':sub.status},entitled_until=${granted?snap.periodEnd:0},observed_at=${observedAt} WHERE id=${claimId}::uuid AND (observed_at<${observedAt} OR (observed_at=${observedAt} AND ${granted?'active':'denied'}<>'active'))`;
  }
  async function handle(r:Request):Promise<Response|null>{
    const path=new URL(r.url).pathname;
    if(!['/app/api/billing/checkout','/app/api/billing/claim','/app/api/billing/portal','/app/api/billing/webhook'].includes(path))return null;
    try {
      if(path==='/app/api/billing/webhook'&&r.method==='POST'){
        requireThat(billingReady,503,'billing not configured');
        const raw=await saasBody(r,1000000);let event:Stripe.Event;
        try{event=await stripeClient!.webhooks.constructEventAsync(raw,r.headers.get('stripe-signature')||'',webhookSecret);}catch{throw new Fault(400,'invalid webhook signature');}
        requireThat(event.livemode===live,400,'payment environment mismatch');
        if((await sql!`SELECT 1 FROM ark_kash.webhook_events WHERE event_id=${event.id}`).length)return response({received:true});
        const obj:any=event.data.object;let subId:string|undefined;
        if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&obj.payment_status==='paid')subId=typeof obj.subscription==='string'?obj.subscription:obj.subscription?.id;
        if(event.type.startsWith('customer.subscription.'))subId=obj.id;
        if(['invoice.paid','invoice.payment_failed'].includes(event.type))subId=obj.parent?.subscription_details?.subscription||obj.subscription;
        if(subId)await observeSubscription(subId,Date.now());
        await sql!`INSERT INTO ark_kash.webhook_events(event_id,event_type) VALUES(${event.id},${event.type}) ON CONFLICT DO NOTHING`;
        return response({received:true});
      }
      requireOrigin(r,origin);
      if(path==='/app/api/billing/checkout'&&r.method==='POST'){
        requireThat(billingReady,503,'Checkout is not connected yet.');checkoutLimit(r);
        const existing=r.headers.get('cookie')?.match(/(?:^|;\s*)__Host-ark-claim=([a-f0-9]{64})(?:;|$)/)?.[1];
        if(existing){const rows=await sql!`SELECT checkout_id FROM ark_kash.purchases WHERE claim_hash=${saasHash(existing)} AND user_id IS NULL AND status='pending'`;if(rows[0]?.checkout_id){const old=await stripeClient!.checkout.sessions.retrieve(rows[0].checkout_id);if(old.status==='open'&&old.url)return response({url:old.url});}}
        const id=randomUUID(),claim=randomBytes(32).toString('hex');
        const p=await stripeClient!.prices.retrieve(priceId);requireThat(p.active&&p.currency==='usd'&&p.unit_amount===2000&&p.recurring?.interval==='month'&&p.recurring.interval_count===1&&p.livemode===live,503,'monthly price configuration mismatch');
        const member=await authenticate(r);if(member)requireThat(!member.paid,409,'Your account already has paid access.');
        await sql!`INSERT INTO ark_kash.purchases(id,claim_hash,user_id) VALUES(${id}::uuid,${saasHash(claim)},${null}::uuid)`;
        const session=await stripeClient!.checkout.sessions.create({mode:'subscription',line_items:[{price:priceId,quantity:1}],client_reference_id:id,subscription_data:{metadata:{ark_app:'ark-kash',ark_claim_id:id}},metadata:{ark_app:'ark-kash',ark_claim_id:id},success_url:origin+'/app/?checkout=complete',cancel_url:origin+'/app/?checkout=cancelled',integration_identifier:'arkkash_'+Array.from(randomBytes(8),b=>String.fromCharCode(97+b%26)).join(''),...(member?{customer_email:member.email}:{})},{idempotencyKey:'ark-checkout-'+id});
        await sql!`UPDATE ark_kash.purchases SET checkout_id=${session.id} WHERE id=${id}::uuid`;
        return response({url:session.url},200,{'set-cookie':`__Host-ark-claim=${claim}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`});
      }
      const member=await authenticate(r);requireThat(member,401,'Sign in with OnlyJah.');
      if(path==='/app/api/billing/claim'&&r.method==='POST'){
        const claim=r.headers.get('cookie')?.match(/(?:^|;\s*)__Host-ark-claim=([a-f0-9]{64})(?:;|$)/)?.[1];requireThat(claim,400,'Open this page on the device that started checkout.');
        const rows=await sql!`SELECT * FROM ark_kash.purchases WHERE claim_hash=${saasHash(claim!)}`;const p=rows[0];requireThat(p,404,'purchase not found');
        requireThat(p.status==='active'&&p.entitled_until>Math.floor(Date.now()/1000),409,'Payment confirmation is pending.');requireThat(!p.user_id||p.user_id===member!.id,403,'purchase already claimed');
        requireThat(claimMatches(member!.emailVerified,member!.email,p.payment_email),403,'Verify the OnlyJah email matching your checkout email before claiming.');
        const claimed=await sql!`UPDATE ark_kash.purchases SET user_id=${member!.id}::uuid WHERE id=${p.id}::uuid AND (user_id IS NULL OR user_id=${member!.id}::uuid) RETURNING id`;
        requireThat(claimed.length,409,'purchase already claimed');return response({claimed:true},200,{'set-cookie':'__Host-ark-claim=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'});
      }
      if(path==='/app/api/billing/portal'&&r.method==='POST'){
        requireThat(billingReady,503,'billing not configured');const rows=await sql!`SELECT customer_id FROM ark_kash.purchases WHERE user_id=${member!.id}::uuid AND customer_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`;requireThat(rows[0],404,'billing account not found');const portal=await stripeClient!.billingPortal.sessions.create({customer:rows[0].customer_id,return_url:origin+'/app/'});return response({url:portal.url});
      }
      throw new Fault(405,'method not supported');
    }catch(e){return response({error:e instanceof Fault?e.message:'Account service unavailable. Please retry.'},e instanceof Fault?e.status:503);}
  }
  return {billingReady,handle};
}
