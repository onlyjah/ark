import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createApp as accountsApp } from '../services/accounts/app.ts';
import { createApp as billingApp } from '../services/billing/app.ts';
import { createApp as workspaceApp } from '../services/workspace/app.ts';
import { createApp as clientApp } from '../services/client/app.ts';
import { createApp as portalizerApp } from '../services/portalizer/app.ts';
import { portalRequest } from '../plugins/so-il/authority.ts';

async function listen(app:any) {
 const server=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const r=new Request('http://service'+req.url,{method:req.method,headers:req.headers as any,body:req.method==='GET'?undefined:Buffer.concat(chunks)});const result=await app.fetch(r);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',()=>resolve()));
 return {url:'http://127.0.0.1:'+(server.address() as any).port,close:async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await app.close();}};
}
test('split services use HTTP portals, preserve legacy auth and fail closed without account/billing setup',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ark-services-'));const token=randomBytes(32).toString('hex');
 const env:Record<string,string>={ARK_APP_ORIGIN:'https://ark.example',ARK_BUNDLE_TEST:'1',ARK_DATA:root,ARK_BOOTSTRAP_ID:randomUUID(),ARK_BOOTSTRAP_TOKEN_HASH:createHash('sha256').update(token).digest('hex')};
 for(const name of ['ACCOUNTS_PORTAL','BILLING_PORTAL','WORKSPACE_PORTAL','CLIENT_PORTAL','ACCOUNTS_WORKSPACE','ACCOUNTS_BILLING','ACCOUNTS_PORTALIZER'])env[`ARK_${name}_KEY`]=randomBytes(32).toString('hex');
 const services:any[]=[];
 try {
  const accounts=await listen(accountsApp(env));services.push(accounts);env.ARK_ACCOUNTS_URL=accounts.url;
  const billing=await listen(billingApp(env));services.push(billing);env.ARK_BILLING_URL=billing.url;
  const workspace=await listen(await workspaceApp(env));services.push(workspace);env.ARK_WORKSPACE_URL=workspace.url;
  const client=await listen(clientApp(env,{'/app/':{body:'<title>Ark Kash</title>',type:'text/html'}}));services.push(client);env.ARK_CLIENT_URL=client.url;
  const portalizer=portalizerApp(env);
  assert.equal((await fetch(workspace.url+'/app/api/me')).status,403);
  assert.equal((await fetch(accounts.url+'/internal/identity',{method:'POST',headers:{authorization:'Bearer forged'},body:'{}'})).status,403);
  const forged=new Request(accounts.url+'/app/api/account/keys');
  const elevated=await portalRequest(forged,forged.url,env.ARK_ACCOUNTS_WORKSPACE_KEY,{app:'ark-kash',audience:'accounts',action:'account.keys'});
  assert.equal((await fetch(elevated)).status,403,'workspace verification key cannot impersonate gateway key capability');
  const cfg=await (await portalizer.fetch(new Request('https://ark.example/app/api/config'))).json();assert.equal(cfg.auth_url,null);assert.equal(cfg.billing_ready,false);
  assert.equal((await portalizer.fetch(new Request('https://ark.example/health'))).status,200);
  assert.match(await (await portalizer.fetch(new Request('https://ark.example/app/'))).text(),/Ark Kash/);
  assert.equal((await portalizer.fetch(new Request('https://ark.example/v1/node'))).status,401);
  assert.equal((await portalizer.fetch(new Request('https://ark.example/v1/node',{headers:{authorization:'Bearer '+token}}))).status,200);
  const login=await portalizer.fetch(new Request('https://ark.example/app/api/login',{method:'POST',headers:{origin:env.ARK_APP_ORIGIN,'content-type':'application/json'},body:JSON.stringify({token})}));
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const me=await portalizer.fetch(new Request('https://ark.example/app/api/me',{headers:{cookie}}));assert.equal(me.status,200);assert.equal((await me.json()).id,env.ARK_BOOTSTRAP_ID);
  assert.equal((await portalizer.fetch(new Request('https://ark.example/app/api/billing/checkout',{method:'POST',headers:{origin:env.ARK_APP_ORIGIN},body:'{}'}))).status,503);
 }finally{for(const service of services.reverse())await service.close();rmSync(root,{recursive:true,force:true});}
});
