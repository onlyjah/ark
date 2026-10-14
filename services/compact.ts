import { randomBytes } from 'node:crypto';
import { createApp as accountsApp } from './accounts/app.ts';
import { createApp as billingApp } from './billing/app.ts';
import { createApp as workspaceApp } from './workspace/app.ts';
import { createApp as clientApp, type Assets } from './client/app.ts';
import { createApp as portalizerApp } from './portalizer/app.ts';
import { response } from '../packages/http/request.ts';
import { soilVariables } from '../xtp/soil/config.ts';

// The budget profile runs separate handlers in one process. The split profile
// uses these same factories behind HTTP, without sharing database or disk handles.
export async function createCompact(input:Record<string,string|undefined>,assets:Assets) {
 const env={...input};
 for(const name of ['ACCOUNTS','BILLING','WORKSPACE','CLIENT']){
  env[`ARK_${name}_URL`]=`http://${name.toLowerCase()}.ark.internal`;
  env[`ARK_${name}_PORTAL_KEY`] ||= randomBytes(32).toString('hex');
 }
 const apps=new Map<string,{fetch:(r:Request)=>Promise<Response>;close:()=>Promise<void>}>();
 for(const caller of ['WORKSPACE','BILLING','PORTALIZER'])env[`ARK_ACCOUNTS_${caller}_KEY`] ||= randomBytes(32).toString('hex');
 const send=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const r=new Request(input,init),name=new URL(r.url).hostname.split('.')[0],app=apps.get(name);
  return app?app.fetch(r):response({error:'service unavailable'},503);
 }) as typeof fetch;
 const select=(names:string[])=>Object.fromEntries([...names,...soilVariables,'KASH_EMBED_ORIGINS','ARK_ARCHIVE_LOCAL'].map(name=>[name,env[name]]));
 const accounts=accountsApp({...select(['ARK_APP_ORIGIN','NEON_AUTH_BASE_URL','ARK_ACCOUNTS_PORTAL_KEY','ARK_ACCOUNTS_WORKSPACE_KEY','ARK_ACCOUNTS_BILLING_KEY','ARK_ACCOUNTS_PORTALIZER_KEY']),ARK_DATABASE_URL:env.ARK_ACCOUNTS_DATABASE_URL||env.ARK_DATABASE_URL});apps.set('accounts',accounts);
 const billing=billingApp({...select(['ARK_APP_ORIGIN','ARK_ACCOUNTS_URL','ARK_ACCOUNTS_BILLING_KEY','ARK_BILLING_PORTAL_KEY','STRIPE_MODE','STRIPE_PRICE_ID','STRIPE_RESTRICTED_KEY','STRIPE_WEBHOOK_SECRET']),ARK_DATABASE_URL:env.ARK_BILLING_DATABASE_URL||env.ARK_DATABASE_URL},send);apps.set('billing',billing);
 const client=clientApp(select(['NEON_AUTH_BASE_URL','ARK_CLIENT_PORTAL_KEY']),assets);apps.set('client',client);
 const workspace=await workspaceApp(select(['ARK_APP_ORIGIN','ARK_DATA','ARK_VOLUME_MOUNT_PATH','RAILWAY_VOLUME_MOUNT_PATH','ARK_BUNDLE_TEST','ARK_BOOTSTRAP_ID','ARK_BOOTSTRAP_TOKEN_HASH','ARK_ARCHIVE_BUCKET','ARK_ARCHIVE_ENDPOINT','ARK_ARCHIVE_REGION','ARK_ARCHIVE_ACCESS_KEY_ID','ARK_ARCHIVE_SECRET_ACCESS_KEY','ARK_WORKSPACE_PORTAL_KEY','ARK_ACCOUNTS_URL','ARK_ACCOUNTS_WORKSPACE_KEY']),send);apps.set('workspace',workspace);
 const portalizer=portalizerApp(select(['ARK_APP_ORIGIN','ARK_PORT_ENTRIES','ARK_ACCOUNTS_URL','ARK_BILLING_URL','ARK_WORKSPACE_URL','ARK_CLIENT_URL','ARK_ACCOUNTS_PORTAL_KEY','ARK_ACCOUNTS_PORTALIZER_KEY','ARK_BILLING_PORTAL_KEY','ARK_WORKSPACE_PORTAL_KEY','ARK_CLIENT_PORTAL_KEY']),send);
 return {fetch:portalizer.fetch,nodeId:workspace.nodeId,close:async()=>{for(const app of [...apps.values()].reverse())await app.close();}};
}
