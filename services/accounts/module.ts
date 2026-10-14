import { createRemoteJWKSet, jwtVerify } from 'jose';
import { neon } from '@neondatabase/serverless';
import { Fault, requireThat } from '../../packages/core/store.ts';
import type { Member } from '../../packages/contracts.ts';
import { response, jsonBody as saasJson, requireOrigin } from '../../packages/http/request.ts';
import { createSoilVerifier, requireSoilScope } from '../../xtp/soil/server.ts';
import { soilConfig } from '../../xtp/soil/config.ts';
export function createAccounts(env:Record<string,string|undefined>, origin:string, adapters?:{sql?:any}) {
  const authUrl=env.NEON_AUTH_BASE_URL||'';
  const sql=adapters?.sql||(env.ARK_DATABASE_URL?neon(env.ARK_DATABASE_URL):null);
  const jwks=authUrl?createRemoteJWKSet(new URL(authUrl+'/.well-known/jwks.json')):null;
  const config=soilConfig(env), soil=config.mode==='soil'?createSoilVerifier(env):null;
  const tokens=new WeakMap<Member,string>();
  async function authenticate(r:Request):Promise<Member|null> {
    if(soil){const session=await soil.authenticate(r);if(!session)return null;
      const member:Member={id:session.subject,name:'SO/IL account',email:'',emailVerified:false,
        paid:session.scopes.includes('kash:write'),human:1,admin:0,managed:true,soil:session};
      tokens.set(member,r.headers.get('authorization')!.slice(7));return member;}
    const header=r.headers.get('authorization');if(!header)return null;
    requireThat(header.startsWith('Bearer ')&&header.length<16384,401,'invalid identity token');
    requireThat(sql&&jwks,503,'OnlyJah account connection is not configured');
    let subject:string;
    try{const {payload}=await jwtVerify(header.slice(7),jwks!,{issuer:authUrl,algorithms:['EdDSA'],requiredClaims:['exp','sub'],maxTokenAge:'16m'});subject=payload.sub!;requireThat(/^[a-f0-9-]{36}$/i.test(subject),401,'invalid identity');}catch{throw new Fault(401,'OnlyJah session expired. Sign in again.');}
    const rows=await sql!`SELECT id,name,email,"emailVerified",banned FROM neon_auth."user" WHERE id=${subject}::uuid`;
    const u=rows[0];requireThat(u&&!u.banned,401,'account unavailable');
    await sql!`INSERT INTO ark_kash.accounts(user_id,handle) VALUES(${subject}::uuid,${u.name||'member'}) ON CONFLICT(user_id) DO NOTHING`;
    const entitlements=await sql!`SELECT 1 FROM ark_kash.purchases WHERE user_id=${subject}::uuid AND status='active' AND entitled_until>${Math.floor(Date.now()/1000)} LIMIT 1`;
    return {id:subject,name:u.name,email:u.email,emailVerified:u.emailVerified,paid:entitlements.length>0,human:1,admin:0,managed:true};
  }
  async function verifyEnvelope(member:Member,e:any,context:string){
    requireThat(e?.v===1&&e.context===context&&typeof e.ciphertext==='string'&&e.ciphertext.length<=1500000&&/^[A-Za-z0-9+/]+={0,2}$/.test(e.ciphertext)&&typeof e.iv==='string'&&Buffer.from(e.iv,'base64').length===12&&typeof e.signature==='string',400,'invalid ciphertext envelope');
    if(soil)requireSoilScope(member.soil,'vault:read');
    const keys=soil?[await soil.json(await soil.request(tokens.get(member)!,'/account/keys'))]:await sql!`SELECT signing_public_key FROM ark_kash.key_envelopes WHERE user_id=${member.id}::uuid`;requireThat(keys[0],409,'Create or unlock your vault first.');
    requireThat(!keys[0].signing_public_key?.d,503,'SO/IL public signing key required');
    try{const key=await crypto.subtle.importKey('jwk',keys[0].signing_public_key,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);const signed={v:e.v,context:e.context,iv:e.iv,ciphertext:e.ciphertext};requireThat(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,Buffer.from(e.signature,'base64'),Buffer.from(JSON.stringify(signed))),400,'ciphertext signature mismatch');}catch(e){if(e instanceof Fault)throw e;throw new Fault(400,'invalid signing key or envelope');}
  }
  async function handle(r:Request):Promise<Response|null> {
    const path=new URL(r.url).pathname;
    if(path!=='/app/api/account/keys')return null;
    try {
      requireOrigin(r,origin);
      const member=await authenticate(r); requireThat(member,401,'Sign in with OnlyJah.');
      if(soil){requireSoilScope(member!.soil,r.method==='GET'?'vault:read':'vault:write');
        requireThat(['GET','POST'].includes(r.method),405,'method not supported');
        const body=r.method==='POST'?await saasJson(r):undefined;
        const result=await soil.request(tokens.get(member!)!,'/account/keys',{
          method:r.method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
        const value=await soil.json(result);if(r.method==='GET'&&value){
          for(const key of [value.encryption_public_key,value.signing_public_key])requireThat(key?.kty==='EC'&&key.crv==='P-256'&&!key.d,503,'SO/IL public key required');
          return response({version:value.version,encrypted_bundle:value.encrypted_bundle,encryption_public_key:value.encryption_public_key,signing_public_key:value.signing_public_key});
        }return response(r.method==='GET'?null:{created:true});}
      if(path==='/app/api/account/keys'&&r.method==='GET'){const rows=await sql!`SELECT version,encrypted_bundle,encryption_public_key,signing_public_key FROM ark_kash.key_envelopes WHERE user_id=${member!.id}::uuid`;return response(rows[0]||null);}
      if(path==='/app/api/account/keys'&&r.method==='POST'){
        requireThat(member!.paid,402,'Paid access is required to create a vault.');const b=await saasJson(r);
        requireThat(b.version===1&&b.encrypted_bundle?.v===1&&b.encrypted_bundle?.iterations===600000&&typeof b.encrypted_bundle?.ciphertext==='string'&&typeof b.encrypted_bundle?.salt==='string'&&typeof b.encrypted_bundle?.iv==='string',400,'invalid encrypted key backup');
        for(const k of [b.encryption_public_key,b.signing_public_key])requireThat(k?.kty==='EC'&&k.crv==='P-256'&&typeof k.x==='string'&&typeof k.y==='string'&&!k.d,400,'public key required');
        const rows=await sql!`INSERT INTO ark_kash.key_envelopes(user_id,version,encrypted_bundle,encryption_public_key,signing_public_key) VALUES(${member!.id}::uuid,1,${JSON.stringify(b.encrypted_bundle)}::jsonb,${JSON.stringify(b.encryption_public_key)}::jsonb,${JSON.stringify(b.signing_public_key)}::jsonb) ON CONFLICT DO NOTHING RETURNING user_id`;
        requireThat(rows.length,409,'A vault already exists. Unlock its existing keys.');return response({created:true});
      }
      throw new Fault(405,'method not supported');
    }catch(e){return response({error:e instanceof Fault?e.message:'Account service unavailable. Please retry.'},e instanceof Fault?e.status:503);}
  }
  return {authUrl:soil?'':authUrl, identityReady:!!soil||!!(sql&&jwks), authenticate,verifyEnvelope,handle};
}
