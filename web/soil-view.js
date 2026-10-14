// The account app is loaded on demand and can also be opened standalone.
(() => {
 const $=id=>document.getElementById(id);let config,client,frame,popup,onLogin,generation=0;
 function close(restore=true){generation++;client?.cancel();frame?.remove();frame=null;if(popup&&!popup.closed)popup.close();popup=null;$('soil-view').hidden=true;$('soil-state').textContent='';if(restore&&window.KashWorkspace?.state().owner)window.KashWorkspace.show('home');}
 async function connect(view,epoch){
  if(config.mode!=='soil'){$('soil-state').textContent='SO/IL provider login is not active in this staging profile.';return;}
  $('soil-state').textContent='Sign in with SO/IL';
  try{const session=await client.connect(view);if(epoch!==generation)return;
   $('soil-state').textContent='Session verified by SO/IL';await onLogin(session);close();
  }catch(error){if(epoch===generation)$('soil-state').textContent=error.message;}
 }
 function open(){if(!config)return;close(false);window.KashWorkspace?.show('accounts');const epoch=generation;$('soil-view').hidden=false;
  const panel=$('soil-frame');frame=document.createElement('iframe');frame.title='SO/IL identity and accounts';
  frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','allow-scripts allow-forms allow-same-origin allow-popups');
  frame.src=config.app_url;const mounted=frame;frame.onload=()=>{if(generation===epoch&&frame===mounted)connect(mounted.contentWindow,epoch);};panel.replaceChildren(frame);$('soil-close').focus();
 }
 window.KashSoil={configure(value,login){config=value;onLogin=login;client=window.Soil.createClient(value);$('soil-signin').hidden=value.mode!=='soil';$('soil-standalone').href=value.app_url;},
  open,close,headers:()=>client.headers(),get session(){return client?.session;},
  clear(){close(false);client?.dispose();if(config)client=window.Soil.createClient(config);},
  capabilities(session){const caps=session?.capabilities||[];for(const button of document.querySelectorAll('[data-soil-capability]'))button.hidden=!caps.includes(button.dataset.soilCapability);}
 };
 $('soil-signin').onclick=open;$('accounts-tab').onclick=open;$('soil-close').onclick=()=>close();
 $('soil-popup').onclick=()=>{if(!config)return;client.cancel();frame?.remove();frame=null;
  popup=window.open(config.app_url,'kash-soil','popup,width=480,height=720');
  if(!popup){$('soil-state').textContent='Popup blocked. Use the standalone account link.';return;}connect(popup,generation);
 };
 for(const button of document.querySelectorAll('[data-soil-capability]'))button.onclick=()=>{
  const view=frame?.contentWindow||popup;if(view)view.postMessage({type:'soil:view',protocol:1,view:button.dataset.soilCapability},new URL(config.app_url).origin);
 };
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('soil-view').hidden)close();});
})();
