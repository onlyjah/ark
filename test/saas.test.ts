import { test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { createSaas } from '../src/saas.ts';

test('SaaS routes fail closed when identity/billing secrets are absent',async()=>{
 const service=createSaas({},'https://ark.example');
 const config=await (await service.handle(new Request('https://ark.example/app/api/config')))! .json();
 assert.equal(config.auth_url,null);assert.equal(config.billing_ready,false);
 const checkout=await service.handle(new Request('https://ark.example/app/api/billing/checkout',{method:'POST',headers:{origin:'https://ark.example'},body:'{}'}));assert.equal(checkout!.status,503);
 await assert.rejects(service.authenticate(new Request('https://ark.example/app/api/me',{headers:{authorization:'Bearer forged'}})));
});

test('Stripe signed webhooks reject forgeries, dedupe receipts, and retry registration races',async()=>{
 const client=new Stripe('sk_test_local_fixture'),secret='whsec_test_fixture',purchaseId='11111111-1111-4111-8111-111111111111';
 const events=new Set<string>();let registered=false,updates=0,lookups=0;
 const sql=async(strings:TemplateStringsArray,...values:any[])=>{const q=strings.join('?');if(q.includes('SELECT 1 FROM ark_kash.webhook_events'))return events.has(values[0])?[{found:true}]:[];if(q.includes('SELECT * FROM ark_kash.purchases'))return [{id:purchaseId,checkout_id:registered?'cs_fixture':null}];if(q.includes('UPDATE ark_kash.purchases')){updates++;return []}if(q.includes('INSERT INTO ark_kash.webhook_events')){events.add(values[0]);return []}throw Error('unexpected database operation')};
 client.subscriptions.retrieve=async()=>{lookups++;return {id:'sub_fixture',status:'active',customer:'cus_fixture',metadata:{ark_app:'ark-kash',ark_claim_id:purchaseId},latest_invoice:{status:'paid'},items:{data:[{price:{id:'price_fixture'},current_period_end:Math.floor(Date.now()/1000)+3600}]},livemode:false} as any};
 client.checkout.sessions.retrieve=async()=>({id:'cs_fixture',subscription:'sub_fixture',payment_status:'paid',customer_details:{email:'buyer@example.com'}} as any);
 const service=createSaas({STRIPE_PRICE_ID:'price_fixture',STRIPE_WEBHOOK_SECRET:secret},'https://ark.example',{sql,stripeClient:client});
 const raw=JSON.stringify({id:'evt_fixture',type:'checkout.session.completed',livemode:false,data:{object:{subscription:'sub_fixture',payment_status:'paid'}}});
 const deliver=async(signature:string)=>service.handle(new Request('https://ark.example/app/api/billing/webhook',{method:'POST',headers:{'stripe-signature':signature},body:raw}));
 assert.equal((await deliver('forged'))!.status,400);assert.equal(lookups,0);
 const signature=await client.webhooks.generateTestHeaderStringAsync({payload:raw,secret});
 assert.equal((await deliver(signature))!.status,503);assert.equal(events.size,0);registered=true;
 assert.equal((await deliver(signature))!.status,200);assert.equal(updates,1);assert.equal(events.size,1);
 const before=lookups;assert.equal((await deliver(signature))!.status,200);assert.equal(lookups,before);assert.equal(updates,1);
});
