const {JSDOM}=require('jsdom'),{indexedDB}=require('fake-indexeddb'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const {makeDemo}=await import('../../web/kash/model.mjs');const {createSoilClient}=await import('../../xtp/soil/client.js');
 const owner='55555555-5555-4555-8555-555555555555',doc='11111111-1111-4111-8111-111111111111';
 let sequence=Date.now(),hold=false,release;
 function projection(){const s=makeDemo();s.source='live';s.context_id='kash:workspace:'+owner;s.sequence=++sequence;s.resource.allowed_actions=[];s.observation={documents:1,projects:0,used_bytes:200,quota_bytes:5000000000};return s;}
 const dom=new JSDOM(fs.readFileSync(root+'/web/index.html','utf8'),{url:'https://kash.example/app/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 try{
  w.Soil={createClient:config=>createSoilClient(config,{host:w,send:w.fetch})};w.indexedDB=indexedDB;w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  w.ResizeObserver=class{constructor(cb){this.cb=cb}observe(){this.cb()}disconnect(){}};
  const context=new Proxy({}, {get:()=>()=>{},set:()=>true});w.HTMLCanvasElement.prototype.getContext=()=>context;
  w.Range.prototype.getBoundingClientRect=()=>({left:0,top:0,right:0,bottom:0,width:0,height:0});w.Range.prototype.getClientRects=()=>[];
  w.fetch=async(url,options={})=>{
   let value={ok:true};if(url.endsWith('/config'))value={soil:{mode:'compatible',app_url:'https://soil.example/app',audience:'kash'},pilot_access:true};else if(url.endsWith('/me'))value={id:owner,name:'A',managed:false,csrf:'test'};
   else if(url.endsWith('/projects')||url.endsWith('/publications'))value=[];
   else if(url.endsWith('/documents'))value=[{id:doc,title:'Private A title',body:'Private A body',kind:'document',head:'r1',updated_at:Date.now()}];
   else if(url.includes('/documents/'))value={id:doc,title:'Private A title',body:'Private A body',kind:'document',head:'r1',updated_at:Date.now()};
   else if(url.endsWith('/kash/map')){if(hold)await new Promise(r=>{release=r});value=projection();}
   return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  };
  for(const f of ['vendor/purify.min.js','vendor/marked.umd.js','vendor/easymde.min.js','kash-map.js','soil-view.js','app.js','kash-home.js'])w.eval(fs.readFileSync(root+'/web/'+f,'utf8'));
  const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,15))}throw Error('KASH UI did not reach expected state')};
  await wait(()=>w.document.getElementById('kash-documents').textContent==='1');
  const map=w.document.getElementById('kash-map');assert.equal(map.snapshot.source,'live');assert.equal(map.snapshot.resource.allowed_actions.length,0);
  assert.equal(w.document.getElementById('home').hidden,false);assert.equal(w.document.getElementById('writing').hidden,true);
  assert.match(map.shadowRoot.querySelector('.brand b').textContent,/KASH/);
  w.document.getElementById('thin-tab').click();assert.equal(w.document.getElementById('thin').hidden,false);
  w.document.getElementById('thin-open-working').click();assert.equal(w.document.getElementById('writing').hidden,false);
  await wait(()=>!w.KashWorkspace.state().saving);w.document.getElementById('thin-sync').click();await wait(()=>!w.document.getElementById('notice').hidden);assert.equal(w.document.getElementById('notice').hidden,false);w.document.getElementById('message-dismiss').click();assert.equal(w.document.getElementById('notice').hidden,true);w.document.getElementById('accounts-tab').click();assert.equal(w.document.querySelectorAll('#soil-frame iframe').length,1);const delayedFrameLoad=w.document.querySelector('#soil-frame iframe').onload;w.document.getElementById('soil-close').click();assert.doesNotThrow(()=>delayedFrameLoad());assert.equal(w.document.querySelectorAll('#soil-frame iframe').length,0);w.document.getElementById('accounts-tab').click();
  hold=true;const pending=w.KashHome.refresh();await wait(()=>!!release);
  w.document.getElementById('logout').click();await wait(()=>!w.KashWorkspace.state().owner);release();await pending;
  assert.equal(w.document.querySelectorAll('#soil-frame iframe').length,0);assert.equal(w.document.getElementById('files').childElementCount,0);assert.equal(w.document.getElementById('revisions').childElementCount,0);assert.equal(map.snapshot,null);assert.equal(w.document.getElementById('kash-documents').textContent,'—');assert.ok(!map.shadowRoot.textContent.includes('Private A title'));
  console.log('PASS: KASH Home consumes scoped live observations, thin navigation works, and logout rejects a delayed old-owner snapshot.');
 }finally{w.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
