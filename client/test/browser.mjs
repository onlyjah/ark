// A local integration fixture, not the real SO/IL provider. It exercises the
// actual Go verifier, React client, iframe nonce exchange and encrypted files.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'../..');
const binary=join(root,'backend/bin/kash');
const temporary=await mkdtemp(join(tmpdir(),'kash-browser-'));
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const jwk={...publicKey.export({format:'jwk'}),kid:'fixture',alg:'EdDSA',use:'sig'};
let appOrigin='',providerOrigin='',revoked=false,delay=0,sessionChecks=0;
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const token=client=>{const now=Math.floor(Date.now()/1000);const data=b64({alg:'EdDSA',kid:'fixture'})+'.'+b64({iss:providerOrigin,aud:'kash',sub:'browser-fixture-owner',sid:'browser-fixture-session',client_id:client,iat:now,exp:now+600,scope:'kash:read kash:write'});return data+'.'+sign(null,Buffer.from(data),privateKey).toString('base64url');};
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const provider=createServer(async(r,w)=>{
  if(r.url==='/.well-known/jwks.json'){w.setHeader('Content-Type','application/json');w.end(JSON.stringify({keys:[jwk]}));return;}
  if(r.url==='/app'){w.setHeader('Content-Type','text/html');w.end(`<!doctype html><title>SO/IL fixture</title><p>Local identity fixture</p><script>addEventListener('message',async e=>{if(e.origin!==${JSON.stringify(appOrigin)}||e.data?.type!=='soil:connect')return;const r=await fetch('/mint',{method:'POST',body:JSON.stringify({client:e.data.client.id})});const data=await r.json();e.source.postMessage({type:'soil:session',protocol:1,request_id:e.data.request_id,token:data.token},e.origin);});</script>`);return;}
  if(r.url==='/mint'){let raw='';for await(const c of r)raw+=c;const client=JSON.parse(raw).client;await new Promise(resolve=>setTimeout(resolve,delay));w.setHeader('Content-Type','application/json');w.end(JSON.stringify({token:token(client)}));return;}
  if(r.url==='/session'){sessionChecks++;const jwt=r.headers.authorization?.split(' ')[1];if(!jwt){w.writeHead(401);w.end();return;}const claims=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url'));w.setHeader('Content-Type','application/json');w.end(JSON.stringify({protocol:'soil.session.v1',active:!revoked,verified:true,id:claims.sid,client:{id:claims.client_id},subject:claims.sub,issuer:providerOrigin,audience:'kash',expires_at:claims.exp*1000,scopes:['kash:read','kash:write'],capabilities:['identity','accounts']}));return;}
  w.writeHead(404);w.end();
});
const providerPort=await listen(provider);providerOrigin='http://127.0.0.1:'+providerPort;
const reserve=createServer();const appPort=await listen(reserve);await new Promise(resolve=>reserve.close(resolve));appOrigin='http://127.0.0.1:'+appPort;
const app=spawn(binary,['serve'],{cwd:root,env:{...process.env,PORT:String(appPort),KASH_DATA:join(temporary,'data'),KASH_DATABASE_URL:'',KASH_OBJECT_STORE:'local',KASH_APP_ORIGIN:appOrigin,SOIL_API_URL:providerOrigin,SOIL_APP_URL:providerOrigin+'/app',SOIL_ISSUER:providerOrigin,SOIL_JWKS_URL:providerOrigin+'/.well-known/jwks.json',SOIL_AUDIENCE:'kash'},stdio:['ignore','ignore','pipe']});
let stderr='';app.stderr.on('data',b=>{stderr+=b;});
let browser;
try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(appOrigin+'/ready')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  assert.ok(ready,'Go service did not start: '+stderr);
  browser=await chromium.launch({headless:true,...(process.env.KASH_TEST_CHROMIUM?{executablePath:process.env.KASH_TEST_CHROMIUM}:{})});const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(appOrigin);await page.getByRole('heading',{name:'KA$H.app',exact:true}).waitFor();
  // Closing a slow identity view must suppress its late session response.
  delay=500;await page.getByRole('button',{name:'Sign in with SO/IL'}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.waitForTimeout(700);
  assert.equal(await page.locator('.verified').count(),0);assert.equal(await page.getByRole('dialog').count(),0);
  delay=0;await page.getByRole('button',{name:'Sign in with SO/IL'}).click();await page.locator('.verified').waitFor();await page.locator('jah-kash-map').waitFor();
  await page.getByRole('link',{name:'System',exact:true}).click();await page.getByRole('heading',{name:'What runs where'}).waitFor();
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile horizontal overflow');
  await page.getByRole('link',{name:'Files',exact:true}).click();
  const testKey=Buffer.from(Array.from({length:32},(_,i)=>i)).toString('base64');
  await page.getByLabel('Base64 content key').fill(testKey);await page.getByRole('button',{name:'Unlock',exact:true}).click();
  await page.locator('input[type=file]').setInputFiles({name:'private-fixture.txt',mimeType:'text/plain',buffer:Buffer.from('private browser fixture')});
  await page.getByRole('button',{name:'Decrypt and download'}).waitFor();
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Decrypt and download'}).click();const download=await downloaded;
  assert.equal(download.suggestedFilename(),'private-fixture.txt');let bytes='';for await(const b of await download.createReadStream())bytes+=b;assert.equal(bytes,'private browser fixture');
  const storage=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));assert.deepEqual(Object.keys(storage),['kash.client.id']);assert.ok(!JSON.stringify(storage).includes(testKey));
  revoked=true;await page.getByRole('button',{name:'Decrypt and download'}).click();await page.getByRole('button',{name:'Sign in with SO/IL'}).waitFor();
  assert.equal(await page.locator('.verified').count(),0);assert.ok(sessionChecks>=5);assert.deepEqual(errors,[]);
  console.log('Browser passed: iframe close/late response, verified login, lazy map, mobile layout, encrypted upload/download, memory-only secrets, revocation/logout.');
}finally{
  await browser?.close();app.kill('SIGTERM');await new Promise(resolve=>{if(app.exitCode!==null)resolve();else app.once('exit',resolve);});await new Promise(resolve=>provider.close(resolve));await rm(temporary,{recursive:true,force:true});
}
