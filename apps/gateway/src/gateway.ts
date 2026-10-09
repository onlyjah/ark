import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { randomUUID } from 'node:crypto'
import { permits } from '../../../packages/contracts/src/index.ts'
import type { ClientSite, ClientGrant, Scope } from '../../../packages/contracts/src/index.ts'
// Jah Noah [Q007]: "all my projects are sovereign"
// Engineering: this additive gateway never reads existing personal SQLite rows; callers need verified identity and explicit client grants.
export type Database = { query: (text: string, values: unknown[]) => Promise<any[]> }
export type Verify = (token: string, origins: string[]) => Promise<{ subject: string }>
type Env={Variables:{subject:string;client:ClientSite;origin:string}}
export function createGateway(db:Database,verify:Verify,primaryOrigin:string){
 const app=new Hono<Env>();app.get('/health',c=>c.json({service:'ark-gateway',status:'ok'}));
 app.use('/v2/*',bodyLimit({maxSize:2_000_000}));
 app.use('/v2/*',async(c,next)=>{
  const origin=c.req.header('origin')||'',id=c.req.header('x-ark-client')||'';
  const row=(await db.query('SELECT * FROM ark_client_sites WHERE id=$1 AND active=true',[id]))[0];
  if(!row||!row.origins.includes(origin))return c.json({error:'unregistered client origin'},403);
  const client:ClientSite={id:row.id,origins:row.origins,schemaVersion:row.schema_version,active:row.active};
  c.header('Access-Control-Allow-Origin',origin);c.header('Vary','Origin');c.header('Cache-Control','no-store');
  if(c.req.method==='OPTIONS'){c.header('Access-Control-Allow-Methods','GET, POST, OPTIONS');c.header('Access-Control-Allow-Headers','Authorization, Content-Type, X-Ark-Client');return c.body(null,204)}
  const token=c.req.header('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];if(!token)return c.json({error:'sign in required'},401);
  try{const identity=await verify(token,client.origins);if(!identity.subject)throw Error();c.set('subject',identity.subject)}catch{return c.json({error:'invalid session'},401)}
  c.set('client',client);c.set('origin',origin);await next();
 });
 async function can(c:any,bucketId:string,scope:Scope){
  const subject=c.get('subject'),client=c.get('client'),origin=c.get('origin');
  const bucket=(await db.query('SELECT * FROM ark_buckets WHERE id=$1 AND owner_subject=$2',[bucketId,subject]))[0];if(!bucket)return false;
  const rows=await db.query('SELECT * FROM ark_client_grants WHERE owner_subject=$1 AND client_id=$2 AND bucket_id=$3 AND revoked_at IS NULL AND expires_at>now()',[subject,client.id,bucketId]);
  return rows.some(row=>permits(client,{subject:row.owner_subject,clientId:row.client_id,bucketId:row.bucket_id,scopes:row.scopes,expiresAt:new Date(row.expires_at).getTime(),revokedAt:row.revoked_at?new Date(row.revoked_at).getTime():null} as ClientGrant,{subject,origin,bucketId,scope,now:Date.now()}));
 }
 app.get('/v2/account/grants',async c=>{if(c.get('origin')!==primaryOrigin)return c.json({error:'open the primary account panel'},403);return c.json(await db.query('SELECT id,client_id,bucket_id,scopes,expires_at,revoked_at FROM ark_client_grants WHERE owner_subject=$1',[c.get('subject')]))});
 app.post('/v2/account/grants',async c=>{
  if(c.get('origin')!==primaryOrigin)return c.json({error:'consent must be approved in the primary account panel'},403);
  const b=await c.req.json();if(b.confirm!==true||!Array.isArray(b.scopes)||!b.scopes.length||!b.scopes.every((s:string)=>['metadata.read','objects.read','objects.write'].includes(s)))return c.json({error:'explicit ciphertext access scopes required'},400);
  const expires=new Date(b.expires_at);if(!Number.isFinite(expires.getTime())||expires.getTime()<=Date.now()||expires.getTime()>Date.now()+90*86400000)return c.json({error:'grant expiry must be within 90 days'},400);
  const bucket=(await db.query('SELECT id FROM ark_buckets WHERE id=$1 AND owner_subject=$2',[b.bucket_id,c.get('subject')]))[0];const client=(await db.query('SELECT id FROM ark_client_sites WHERE id=$1 AND active=true',[b.client_id]))[0];if(!bucket||!client)return c.json({error:'bucket or client unavailable'},404);
  const id=randomUUID();await db.query('INSERT INTO ark_client_grants(id,owner_subject,client_id,bucket_id,scopes,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[id,c.get('subject'),b.client_id,b.bucket_id,b.scopes,expires]);return c.json({id});
 });
 app.post('/v2/account/grants/:id/revoke',async c=>{if(c.get('origin')!==primaryOrigin)return c.json({error:'open the primary account panel'},403);const rows=await db.query('UPDATE ark_client_grants SET revoked_at=now() WHERE id=$1 AND owner_subject=$2 RETURNING id',[c.req.param('id'),c.get('subject')]);return rows.length?c.json({ok:true}):c.json({error:'grant not found'},404)});
 app.get('/v2/buckets/:id/objects',async c=>{if(!await can(c,c.req.param('id'),'metadata.read'))return c.json({error:'client consent required'},403);return c.json(await db.query('SELECT id,head,encrypted_metadata FROM ark_cipher_objects WHERE bucket_id=$1 AND owner_subject=$2',[c.req.param('id'),c.get('subject')]))});
 app.get('/v2/buckets/:bucket/objects/:id',async c=>{if(!await can(c,c.req.param('bucket'),'objects.read'))return c.json({error:'client consent required'},403);const rows=await db.query('SELECT o.id,o.head,o.encrypted_metadata,r.envelope FROM ark_cipher_objects o JOIN ark_cipher_revisions r ON r.id=o.head AND r.object_id=o.id WHERE o.id=$1 AND o.bucket_id=$2 AND o.owner_subject=$3',[c.req.param('id'),c.req.param('bucket'),c.get('subject')]);return rows.length?c.json(rows[0]):c.json({error:'object not found'},404)});
 app.onError((_e,c)=>c.json({error:'gateway request failed'},503));return app;
}
