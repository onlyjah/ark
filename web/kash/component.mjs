import { MAP_VERSION, validateSnapshot, makeDemo, demoTransition, protectionStats, protectionReady, actionState, isCurrent } from './model.mjs';
import { drawWorld, LIGHT_PALETTE } from './world.mjs';

const CSS = `
:host{display:block;width:100%;contain:layout style;font-family:ui-rounded,'Trebuchet MS',system-ui,sans-serif;color-scheme:inherit;font-size:14px;font-weight:400}
:host([theme=light]){color-scheme:light}:host([theme=dark]){color-scheme:dark}
*{box-sizing:border-box}button,input{font:inherit}button{cursor:var(--cursor-interaction,pointer)}
.shell{--ink:var(--foreground,light-dark(#354d43,#e5eddf));--dim:var(--muted-foreground,light-dark(#657565,#b1c3b4));--paper:var(--background,light-dark(#f9f5e8,#202d29));--panel:var(--muted,light-dark(#eee8d3,#2b3830));--edge:var(--border,light-dark(#c8c6af,#566453));--action:var(--primary,light-dark(#496b56,#b3ca94));--action-ink:var(--primary-foreground,light-dark(#fff7df,#17281e));--selection:light-dark(#9c752b,#f2cb70);--water:light-dark(#d0e8e0,#233e3d);--ripple:light-dark(#a9d1c9,#385a55);--grass:light-dark(#9dbd68,#638157);--grassLight:light-dark(#bfce88,#789561);--grassDark:light-dark(#719353,#486749);--earth:light-dark(#9b7755,#785d48);--earthDark:light-dark(#755c47,#564637);--sand:light-dark(#e5d49d,#988668);--path:light-dark(#dfc493,#aa956c);--pathEdge:light-dark(#b79969,#7d6d51);--stone:light-dark(#ded9bd,#b9bba1);--stoneDark:light-dark(#aaa88a,#8b967f);--roof:light-dark(#d0a557,#c7a65f);--roofDark:light-dark(#b38342,#967740);--wood:light-dark(#986d4e,#836951);--teal:light-dark(#4f9582,#7ca791);--leaf:light-dark(#467659,#416248);--leafLight:light-dark(#69936a,#678063);--flower:light-dark(#e4a5a7,#bd8b9b);--cream:light-dark(#fff4ce,#d7d6ac);--purple:light-dark(#9c84b5,#ac96c2);--purpleDark:light-dark(#796095,#78638f);--alert:light-dark(#b96955,#cc9677);--white:light-dark(#fff8e3,#e3dfbb);color:var(--ink);background:var(--paper);border:1px solid var(--edge);border-radius:20px;overflow:hidden}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid var(--edge)}
.brand{display:flex;align-items:center;gap:9px;min-width:0}.sun{color:var(--selection);font-size:24px}.brand b{font-weight:500;font-size:20px}.subbrand{font-size:12px;color:var(--dim);display:block;margin-top:1px}
.connection{font-size:12px;border:1px solid var(--edge);background:var(--panel);border-radius:30px;padding:6px 10px;white-space:nowrap}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 252px;min-width:0}
.map{position:relative;height:500px;min-width:0;overflow:hidden;background:var(--water)}canvas{display:block;width:100%;height:100%}
.places{position:absolute;inset:0;pointer-events:none}.place{position:absolute;transform:translate(-50%,16px);pointer-events:auto;padding:6px 9px;min-height:44px;max-width:112px;min-width:72px;border:1px solid var(--edge);border-radius:11px;background:var(--paper);color:var(--ink);box-shadow:0 3px 0 color-mix(in srgb,var(--earthDark) 17%,transparent);text-align:center}
.place[aria-pressed=true]{border-color:var(--selection);background:var(--panel);box-shadow:0 3px 0 color-mix(in srgb,var(--selection) 35%,transparent)}
.place span{display:block;font-size:11px;color:var(--dim);margin-top:2px}.place strong{font-weight:500;font-size:12px}
.map-note{position:absolute;bottom:9px;left:12px;right:12px;display:flex;justify-content:space-between;gap:8px;pointer-events:none;color:var(--ink);font-size:11px}.map-note span{background:var(--paper);padding:4px 7px;border-radius:6px}
.inspector{padding:20px 18px;min-width:0;border-left:1px solid var(--edge);display:flex;flex-direction:column;gap:14px;background:var(--paper)}
.eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}h2{font-size:24px;margin:3px 0 4px;font-weight:500}.site{color:var(--dim);font-size:12px}
.resource{padding:11px 0;border-top:1px solid var(--edge);border-bottom:1px solid var(--edge)}.resource-name{margin-top:5px;overflow-wrap:anywhere;font-size:13px}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:12px 10px}.facts span{font-size:11px;color:var(--dim);display:block;margin-bottom:4px}.facts b{font-weight:500;font-variant-numeric:tabular-nums;font-size:14px}
.state{padding:10px 11px;border-radius:10px;background:var(--panel);font-size:12px;min-height:34px}
.actions{display:grid;gap:8px}.action,.outage{min-height:42px;padding:10px 12px;border-radius:11px;border:1px solid var(--edge);font-weight:500}.action{background:var(--action);color:var(--action-ink);border-color:var(--action)}.outage{background:var(--paper);color:var(--ink)}button:disabled{opacity:.6;cursor:default}
.pin{display:flex;align-items:center;gap:8px;min-height:42px;font-size:12px}.pin input{width:18px;height:18px;accent-color:var(--action)}
.footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 18px;border-top:1px solid var(--edge);font-size:11px;color:var(--dim);flex-wrap:wrap}
.probe{position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden}.error{color:var(--alert);font-size:12px;overflow-wrap:anywhere}.fallback{position:absolute;inset:0;display:grid;place-content:center;color:var(--ink)}[hidden]{display:none!important}
.shell{container-name:kash-map;container-type:inline-size}
@container kash-map (max-width:680px){.layout{grid-template-columns:1fr}.map{height:465px}.inspector{border-left:0;border-top:1px solid var(--edge);display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px}.inspector .intro,.resource,.state,.error{grid-column:1/-1}.intro{display:flex;justify-content:space-between;align-items:center;gap:10px}.intro h2{font-size:22px}.facts{align-content:start}.actions{align-content:start}.pin{grid-column:1/-1}.bar{padding:12px 14px}.map-note{font-size:11px}.place{max-width:92px;min-width:70px;padding:5px 7px}.footer{padding:10px 14px}}
@container kash-map (max-width:360px){.map{height:450px}.brand b{font-size:18px}.connection{padding:5px 7px}.inspector{grid-template-columns:1fr}.facts,.actions{grid-column:1/-1}.facts{grid-template-columns:1fr 1fr}.place{min-width:67px;max-width:85px;padding:5px}.map-note span:last-child{display:none}}
`;

export class JahKashMap extends HTMLElement {
  static get observedAttributes() { return ['theme','brand']; }
  constructor() {
    super();this.attachShadow({mode:'open'});this._snapshot=null;this._selected='working';this._frame=0;this._timer=0;this._pending=null;this._visible=true;this._connected=false;
    this.shadowRoot.innerHTML=`<style>${CSS}</style><section class="shell" part="shell" aria-label="Jah.earth KASH storage map">
      <header class="bar"><div class="brand"><span class="sun" aria-hidden="true">✦</span><div><b>jah.earth</b><span class="subbrand">KASH / Home</span></div></div><span class="connection">Unconfigured</span></header>
      <div class="layout"><div class="map" part="map"><canvas aria-hidden="true"></canvas><div class="places" role="group" aria-label="Storage places"></div><div class="fallback" hidden>Map unavailable · use the place buttons</div><div class="map-note"><span>Service map</span><span>Locations are schematic</span></div></div>
      <aside class="inspector" part="inspector"><div class="intro"><div><div class="eyebrow">Selected place</div><h2 data-name>Home</h2></div><div class="site" data-site>Awaiting connection</div></div>
      <div class="resource"><span class="eyebrow">Global resource</span><div class="resource-name">No resource selected</div></div>
      <div class="facts"><div><span>Verified online copies</span><b data-copies>—</b></div><div><span>Independent sites</span><b data-sites>—</b></div><div><span>Revision</span><b data-revision>—</b></div><div><span>Local copy</span><b data-local>—</b></div></div>
      <div class="actions"><button class="action" type="button" disabled>Awaiting data</button><button class="outage" type="button" hidden>Site A offline</button></div>
      <label class="pin" hidden><input type="checkbox"><span>Keep offline</span></label><div class="state" role="status" aria-live="polite">Unconfigured</div><div class="error" role="alert" hidden></div></aside></div>
      <footer class="footer"><span data-mode>No backend bound</span><span data-observed>Waiting for a snapshot</span></footer><span class="probe"></span></section>`;
    const q=selector=>this.shadowRoot.querySelector(selector);
    this._ui={shell:q('.shell'),map:q('.map'),canvas:q('canvas'),places:q('.places'),fallback:q('.fallback'),connection:q('.connection'),name:q('[data-name]'),site:q('[data-site]'),resource:q('.resource-name'),copies:q('[data-copies]'),sites:q('[data-sites]'),revision:q('[data-revision]'),local:q('[data-local]'),action:q('.action'),outage:q('.outage'),pin:q('.pin'),check:q('.pin input'),state:q('.state'),error:q('.error'),mode:q('[data-mode]'),observed:q('[data-observed]'),probe:q('.probe')};
    this._ui.places.addEventListener('click',e=>{const button=e.target.closest('button[data-place]');if(button)this.selectPlace(button.dataset.place)});
    this._ui.action.addEventListener('click',()=>{const a=actionState(this._snapshot,this._selected);if(a.action&&!a.disabled)this._request(a.action)});
    this._ui.outage.addEventListener('click',()=>this._request('outage'));
    this._ui.check.addEventListener('change',()=>this._request('pin'));
    this._onVisibility=()=>{if(document.visibilityState==='visible')this._invalidate();};
    this._onTheme=()=>this._invalidate();
    this._media=globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  }
  connectedCallback() {
    if(this._connected)return;this._connected=true;
    this._resize=new ResizeObserver(()=>this._invalidate());this._resize.observe(this._ui.map);
    if(globalThis.IntersectionObserver){this._intersection=new IntersectionObserver(entries=>{this._visible=entries[0]?.isIntersecting??true;if(this._visible)this._invalidate()});this._intersection.observe(this);}
    document.addEventListener('visibilitychange',this._onVisibility);this._media?.addEventListener('change',this._onTheme);
    if(this.hasAttribute('demo')&&!this._snapshot)this.loadDemo();
    this._render();this._invalidate();this._scheduleStale();
  }
  disconnectedCallback() {
    this._connected=false;this._resize?.disconnect();this._intersection?.disconnect();document.removeEventListener('visibilitychange',this._onVisibility);this._media?.removeEventListener('change',this._onTheme);
    cancelAnimationFrame(this._frame);this._frame=0;clearTimeout(this._timer);this._timer=0;
    this._ui.canvas.width=1;this._ui.canvas.height=1;
  }
  attributeChangedCallback(){if(this._ui){this.shadowRoot.querySelector('.brand b').textContent=this.getAttribute('brand')||'jah.earth';this._invalidate();}}
  loadDemo() { clearTimeout(this._timer);this._timer=0;this._pending=null;this._snapshot=makeDemo();this._selected='working';this._render();this._invalidate(); }
  get snapshot() { return this._snapshot?(globalThis.structuredClone?structuredClone(this._snapshot):JSON.parse(JSON.stringify(this._snapshot))):null; }
  set snapshot(value) { this.setSnapshot(value); }
  setSnapshot(value) {
    const s=validateSnapshot(value);
    if(this._snapshot&&s.context_id!==this._snapshot.context_id)throw new Error('Reset context before changing scoped views');
    if(this._snapshot&&s.sequence<=this._snapshot.sequence)throw new Error('Stale or duplicate snapshot');
    this._snapshot=s;
    if(!s.places.some(p=>p.id===this._selected))this._selected=s.places[0]?.id||'';
    this._ui.error.hidden=true;this._render();this._invalidate();this._scheduleStale();
  }
  resetContext() {
    this._snapshot=null;this._selected='';this._pending=null;clearTimeout(this._timer);this._timer=0;this._ui.places.replaceChildren();this._ui.error.hidden=true;this._ui.canvas.width=1;this._ui.canvas.height=1;this._render();this._invalidate();
  }
  resolveRequest(requestId, outcome) {
    if(!this._pending||this._pending.request_id!==requestId)return false;
    if(!['confirmed','rejected','unknown'].includes(outcome))throw new Error('Invalid request outcome');
    if(outcome==='unknown'){this._ui.state.textContent='Outcome uncertain · await reconciliation';return true;}
    this._pending=null;this._render();
    if(outcome==='rejected')this._ui.state.textContent='Request rejected · last confirmed state retained';
    return true;
  }
  setConnection(value) {
    if(!['online','stale','offline','unconfigured'].includes(value))throw new Error('Invalid connection state');
    if(!this._snapshot)return;
    // A current snapshot is required to clear stale/offline state; a reconnect alone is insufficient.
    if(value==='online'&&this._snapshot.connection!=='online')throw new Error('Apply a fresh snapshot to reconnect');
    this._snapshot={...this._snapshot,connection:value};this._render();this._invalidate();
  }
  selectPlace(id) {
    if(!this._snapshot?.places.some(p=>p.id===id))return;
    this._selected=id;this._render();this._invalidate();
    this.dispatchEvent(new CustomEvent('kash:place-select',{detail:{place_id:id,context_id:this._snapshot.context_id},bubbles:true,composed:true}));
  }
  _request(action) {
    if(!this._snapshot)return;
    if(this._snapshot.source==='demo'){
      try{this._snapshot=demoTransition(this._snapshot,action,this._selected);this._ui.error.hidden=true;}catch(e){this._ui.error.textContent=e.message;this._ui.error.hidden=false;}
      this._render();this._invalidate();return;
    }
    if(this._pending||!isCurrent(this._snapshot)||!this._snapshot.resource.allowed_actions.includes(action))return;
    if(action==='pin'){
      const c=this._snapshot.resource.local_copies.find(v=>v.place_id===this._selected);if(!c?.present)return;
    }else{const eligible=actionState(this._snapshot,this._selected);if(eligible.disabled||eligible.action!==action)return;}
    const detail={
      action,place_id:this._selected,context_id:this._snapshot.context_id,resource_id:this._snapshot.resource.id,
      revision:this._snapshot.resource.revision,policy_epoch:this._snapshot.resource.policy_epoch,
      request_id:globalThis.crypto.randomUUID(),sequence:this._snapshot.sequence};
    this._pending=detail;this._render();
    this.dispatchEvent(new CustomEvent('kash:action-request',{bubbles:true,composed:true,detail}));
    // No optimistic mutation. The host must return a newly authorized snapshot.
    this._ui.state.textContent='Request sent · awaiting confirmed state';
    this._ui.check.checked=this._snapshot.resource.local_copies.find(c=>c.place_id===this._selected)?.pinned||false;
  }
  _scheduleStale() {
    clearTimeout(this._timer);this._timer=0;
    if(!this._connected||this._snapshot?.source!=='live'||this._snapshot.connection!=='online')return;
    const expires=Math.min(Date.parse(this._snapshot.observed_at)+30001,Date.parse(this._snapshot.resource.protection_valid_until));
    this._timer=setTimeout(()=>{this._timer=0;this._render();this._invalidate()},Math.max(1,expires-Date.now()));
  }
  _render() {
    const s=this._snapshot,u=this._ui;
    if(!s){u.connection.textContent='Unconfigured';u.name.textContent='Home';u.site.textContent='Awaiting connection';u.resource.textContent='No resource selected';u.copies.textContent=u.sites.textContent=u.revision.textContent=u.local.textContent='—';u.action.disabled=true;u.action.textContent='Awaiting data';u.outage.hidden=true;u.pin.hidden=true;u.state.textContent='Unconfigured';u.mode.textContent='No backend bound';u.observed.textContent='Waiting for a snapshot';return;}
    const existing=new Map([...u.places.querySelectorAll('button')].map(b=>[b.dataset.place,b]));
    for(const p of s.places){
      let button=existing.get(p.id);if(!button){button=document.createElement('button');button.type='button';button.className='place';button.dataset.place=p.id;button.append(document.createElement('strong'),document.createElement('span'));u.places.append(button)}
      existing.delete(p.id);button.querySelector('strong').textContent=p.label;
      const local=s.resource.local_copies.find(c=>c.place_id===p.id);
      button.querySelector('span').textContent=!p.online?(p.availability==='unconfigured'?'Unconfigured':p.availability==='unknown'?'Unverified':'Offline'):p.kind==='archive'?(p.has_copy?'Verified copy':p.site):p.kind==='index'?'Global entry':local?.present?(local.pinned?'Pinned':'Cached'):'Remote-only';
      button.style.left=(p.x*100)+'%';button.style.top=(p.y*100)+'%';button.setAttribute('aria-pressed',String(this._selected===p.id));
      button.setAttribute('aria-label',p.label+', '+button.querySelector('span').textContent);
    }
    existing.forEach(b=>b.remove());
    const p=s.places.find(v=>v.id===this._selected),r=s.resource,local=r.local_copies.find(c=>c.place_id===this._selected),stats=protectionStats(s),a=actionState(s,this._selected);
    u.connection.textContent=s.source==='demo'?'Demo':isCurrent(s)?'Live':s.connection==='offline'?'Offline':'Stale';
    u.name.textContent=p?.label||'Home';u.site.textContent=p?.site||'';u.resource.textContent=r.label;
    u.copies.textContent=stats.copies+' / '+r.required_copies;u.sites.textContent=stats.sites+' / '+r.required_sites;u.revision.textContent=r.revision;
    u.local.textContent=local?(local.present?(local.pinned?'Pinned':'Cached'):'Remote-only'):p?.kind==='archive'?'Retained':'Index only';
    u.action.textContent=a.label;u.action.disabled=a.disabled;u.outage.hidden=s.source!=='demo';u.outage.textContent=s.places.find(v=>v.id==='archive-a')?.online?'Site A offline':'Restore site A';
    u.pin.hidden=!local;u.check.checked=local?.pinned||false;u.check.disabled=!local?.present||!isCurrent(s)||!r.allowed_actions.includes('pin');
    u.state.textContent=!isCurrent(s)?'Last known state · actions paused':protectionReady(s)?(local?.pinned?'Protected · offline pin retained':local&&!local.present?'Protected · global entry remains':'Protected · revision verified'):r.phase==='pending'?'Pending · local copy retained':r.phase==='synced'?'Synced · backups pending':'Protection degraded · release paused';
    if(this._pending){u.action.disabled=true;u.action.textContent='Awaiting confirmation';u.check.disabled=true;u.state.textContent='Request pending · last confirmed state retained';}
    u.mode.textContent=s.source==='demo'?'Simulated data · no files changed':'Scoped view · backend enforces actions';
    u.observed.textContent='Observed '+new Date(s.observed_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  }
  _invalidate() {
    if(!this._connected||this._frame||!this._visible||document.visibilityState==='hidden')return;
    this._frame=requestAnimationFrame(()=>{this._frame=0;this._paint()});
  }
  _paint() {
    const u=this._ui,box=u.map.getBoundingClientRect(),width=Math.max(1,box.width),height=Math.max(1,box.height),dpr=Math.min(1.5,globalThis.devicePixelRatio||1);
    const pixelW=Math.round(width*dpr),pixelH=Math.round(height*dpr);
    if(u.canvas.width!==pixelW||u.canvas.height!==pixelH){u.canvas.width=pixelW;u.canvas.height=pixelH;}
    const c=u.canvas.getContext('2d',{alpha:false});
    if(!c){u.fallback.hidden=false;this.setAttribute('data-render-ready','fallback');return;}
    u.fallback.hidden=true;c.setTransform(dpr,0,0,dpr,0,0);
    const palette={...LIGHT_PALETTE};
    for(const key of Object.keys(palette)){if(key==='shadow')continue;u.probe.style.color='var(--'+key+', var(--ink))';palette[key]=getComputedStyle(u.probe).color;}
    palette.ink=getComputedStyle(u.shell).color;
    drawWorld(c,width,height,this._snapshot,this._selected,palette);
    this.setAttribute('data-render-ready','true');
  }
}
if(!customElements.get('jah-kash-map'))customElements.define('jah-kash-map',JahKashMap);
