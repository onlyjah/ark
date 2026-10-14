export type BillingSnapshot = { status:string; paid:boolean; priceIds:string[]; periodEnd:number; livemode:boolean };
export function subscriptionEntitled(s:BillingSnapshot,priceId:string,livemode:boolean,now=Math.floor(Date.now()/1000)) {
  return s.livemode===livemode && s.status==='active' && s.paid===true && s.priceIds.length===1 && s.priceIds[0]===priceId && Number.isSafeInteger(s.periodEnd) && s.periodEnd>now;
}
export function claimMatches(verified:boolean,accountEmail:string,paymentEmail:string|null) {
  return verified && !!paymentEmail && accountEmail.trim().toLowerCase()===paymentEmail.trim().toLowerCase();
}
