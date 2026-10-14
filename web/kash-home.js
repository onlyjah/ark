// Home reads the current session's projection. No file deletion or device enrollment happens here.
(()=>{
 const map=document.getElementById('kash-map'),welcome=document.getElementById('kash-welcome-map');
 let generation=0,request=null,owner=null,inFlight=false;
 const element=id=>document.getElementById(id);
 function clear(){generation++;request?.abort();request=null;owner=null;inFlight=false;map.resetContext();for(const id of ['kash-documents','kash-projects','kash-storage'])element(id).textContent='—';element('kash-observation').textContent='Sign in for workspace observations';}
 function localState(snapshot){
  const state=window.KashWorkspace?.state?.();
  if(!state?.owner||state.owner!==owner||!state.current)return snapshot;
  // Authorized decrypted display metadata stays on the already trusted browser endpoint.
  snapshot.resource={...snapshot.resource,id:state.current.id,label:String(state.current.title||'Untitled').slice(0,100),revision:state.current.head||'local-draft',
   phase:state.current.head?'synced':'pending',protected_revision:'unverified',allowed_actions:[],
   local_copies:['working','thin'].map(place_id=>({place_id,present:true,pinned:true,dirty:!!state.dirty,revision:state.current.head||'local-draft'}))};
  return snapshot;
 }
 async function refresh(){
  if(!window.KashWorkspace?.state||!window.KashWorkspace.state().owner){clear();return;}
  const active=window.KashWorkspace.state();
  if(owner!==active.owner){clear();owner=active.owner;map.selectPlace('index');}
  if(inFlight)return;
  inFlight=true;const epoch=generation,expectedOwner=owner;
  request=new AbortController();
  try{
   const result=await window.KashWorkspace.api('kash/map',undefined,false,{},request.signal);
   if(epoch!==generation||expectedOwner!==window.KashWorkspace.state().owner)return;
   const observation=result.observation;
   const firstView=!map.snapshot;
   map.setSnapshot(localState(result));
   if(firstView)map.selectPlace('index');
   element('kash-documents').textContent=String(observation.documents);
   element('kash-projects').textContent=String(observation.projects);
   element('kash-storage').textContent=window.KashWorkspace.format(observation.used_bytes)+' / '+window.KashWorkspace.format(observation.quota_bytes);
   element('kash-observation').textContent='Workspace observed · backup protection unconfigured';
  }catch(error){if(epoch!==generation||error.name==='AbortError')return;if(error.status===401||error.status===403){clear();return;}map.setConnection(navigator.onLine?'stale':'offline');element('kash-observation').textContent='Last known workspace · reconnect to refresh';}
  finally{if(epoch===generation){inFlight=false;request=null;}}
 }
 map.addEventListener('kash:place-select',event=>{
  const kind=event.detail.place_id;
  element('kash-open-working').hidden=!['working','index'].includes(kind);
  element('kash-open-thin').hidden=kind!=='thin';
  element('kash-open-archive').hidden=kind!=='archive-a';
 });
 element('kash-open-working').onclick=()=>window.KashWorkspace.show('writing');
 element('kash-open-thin').onclick=()=>window.KashWorkspace.show('thin');
 element('kash-open-archive').onclick=()=>window.KashWorkspace.show('archive');
 element('kash-refresh').onclick=refresh;
 window.addEventListener('offline',()=>map.setConnection('offline'));
 window.addEventListener('kash:workspace-change',()=>{if(!window.KashWorkspace.state().owner)clear();else if(!element('home').hidden)refresh();});
 window.KashHome={refresh,clear};
 if(welcome)welcome.setAttribute('brand','KASH');
})();
