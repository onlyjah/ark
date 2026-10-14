import { response } from '../../packages/http/request.ts';
import { protectPortal } from '../../plugins/so-il/authority.ts';
import { requireThat } from '../../packages/core/store.ts';
import { soilConfig } from '../../xtp/soil/config.ts';
export type Assets=Record<string,{body?:string;type:string;key?:string}>;
export function createApp(env:Record<string,string|undefined>,assets:Assets) {
 const auth=env.NEON_AUTH_BASE_URL?new URL(env.NEON_AUTH_BASE_URL).origin:'';
 const soil=soilConfig(env),soilOrigin=new URL(soil.appUrl).origin;
 const embeds=(env.KASH_EMBED_ORIGINS||'https://jah.earth').split(',').filter(Boolean).map(value=>{
  const u=new URL(value);requireThat(u.protocol==='https:'&&u.href===u.origin+'/'&&!u.username&&!u.password,500,'invalid embed origin');return u.origin;
 }).join(' ');
 return {fetch:protectPortal(env.ARK_CLIENT_PORTAL_KEY!,'client',async(r,grant)=>{
  requireThat(grant.app==='ark-kash'&&grant.action==='client.read',403,'client capability required');
  const path=new URL(r.url).pathname;
  if(r.method!=='GET'&&r.method!=='HEAD')return response({error:'method not supported'},405);
  const name=/^\/p\/[a-f0-9-]{36}$/.test(path)?'/app/publication.html':path;
  const asset=assets[name];if(!asset||asset.key)return null;
  const body=asset.type==='image/png'?Buffer.from(asset.body||'','base64'):asset.body;
  return new Response(r.method==='HEAD'?null:body,{headers:{'content-type':asset.type,'cache-control':'no-cache','x-content-type-options':'nosniff','content-security-policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self' ${auth} ${new URL(soil.apiUrl).origin}; frame-src ${auth} ${soilOrigin}; object-src 'none'; base-uri 'none'; frame-ancestors 'self' ${embeds}; form-action 'self'`,'referrer-policy':'no-referrer',...(path==='/app/sw.js'?{'service-worker-allowed':'/app/'}:{}),...(path==='/app/client-copy.json'?{'access-control-allow-origin':'*'}:{})}});
 }),close:async()=>{}};
}
