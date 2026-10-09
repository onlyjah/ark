// Jah Noah [Q007]: "all my projects are sovereign"
// Engineering: org membership alone never authorizes a client's access to a user's objects.
export type Scope = 'metadata.read' | 'objects.read' | 'objects.write' | 'plaintext.read'
export type ClientSite = { id: string; origins: string[]; schemaVersion: number; active: boolean }
export type ClientGrant = { subject: string; clientId: string; bucketId: string; scopes: Scope[]; expiresAt: number; revokedAt: number | null }
export function permits(client: ClientSite, grant: ClientGrant, input: { subject: string; origin: string; bucketId: string; scope: Scope; now: number }): boolean {
  return client.active && client.origins.includes(input.origin) && grant.subject === input.subject && grant.clientId === client.id && grant.bucketId === input.bucketId && grant.scopes.includes(input.scope) && grant.revokedAt === null && grant.expiresAt > input.now
}
export type CipherContext = { ownerId: string; bucketId: string; objectId: string; revisionId: string }
export type CipherEnvelope = { version: 1; algorithm: 'A256GCM'; keyId: string; iv: string; ciphertext: string }
export type ConsentRequest = { clientId: string; bucketId: string; requestedScopes: Scope[]; expiresAt: number }
export type ArkClientConfig = { clientId: string; origin: string; basePath: '/ark'; schemaVersion: number; auth: { primaryOrigin: string; satellite: boolean }; uiVersion: string }

import { Hono } from 'hono@4.13.13'
import { bodyLimit } from 'hono@4.13.13/body-limit'
import { randomUUID } from 'node:crypto'
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

import { SQL } from 'bun'
import { verifyToken } from '@clerk/backend@3.23.1'
// Jah Noah [Q042]: "Info is encrypted as it passes through to the client without the client site backend ever getting to read it unless granted permission by the user upon approving access to the client site to aspects of their data."
// Engineering: JWT verification and exact registered origins fail closed; no secret or unlock key is passed to a client site.
const {DATABASE_URL,CLERK_SECRET_KEY,CLERK_ISSUER,ARK_PRIMARY_ORIGIN}=Bun.env;
if(!DATABASE_URL||!CLERK_SECRET_KEY||!CLERK_ISSUER||!ARK_PRIMARY_ORIGIN)throw Error('Database, Clerk issuer/key and primary origin must be configured');
const sql=new SQL(DATABASE_URL,{max:5});
const app=createGateway({query:(text,values)=>sql.unsafe(text,values)},async(token,origins)=>{
 const claims=await verifyToken(token,{secretKey:CLERK_SECRET_KEY,authorizedParties:origins});
 if(claims.iss!==CLERK_ISSUER||typeof claims.sub!=='string')throw Error('Incorrect issuer or subject');
 return {subject:claims.sub};
},ARK_PRIMARY_ORIGIN);
Bun.serve({port:Number(Bun.env.PORT||8080),fetch:app.fetch});
