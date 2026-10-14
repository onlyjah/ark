import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Store, Fault, requireThat, digest } from './store.ts';

// Jah Noah [Q012]: "I- I want OnlyJah to be able to run lean"
// Engineering: bounded JSON requests and one embedded database avoid extra resident services.
const MAX_BODY = 1500000;
function text(value: any, field: string, max = 4096): string {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= max, 400, `invalid ${field}`);
  return value;
}
function bodyBytes(value: any): Buffer {
  requireThat(typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), 400, 'content must be canonical base64');
  const bytes = Buffer.from(value, 'base64');
  requireThat(bytes.length <= 1048576, 413, 'pilot files are limited to 1 MiB'); return bytes;
}
async function readJson(req: IncomingMessage) {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length; requireThat(size <= MAX_BODY, 413, 'request too large'); chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requireThat(value && typeof value === 'object' && !Array.isArray(value), 400, 'JSON object required');
    return value;
  } catch (e) { if (e instanceof Fault) throw e; throw new Fault(400, 'invalid JSON'); }
}
function send(res: ServerResponse, status: number, body: any) {
  res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
  res.end(JSON.stringify(body));
}
export function createApi(store: Store, options:{origin?:string;authenticate?:(req:IncomingMessage)=>Promise<any>}={}) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://ark.local');
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, {status:'ok'});
      requireThat(!req.headers.origin||!!options.authenticate&&req.headers.origin===options.origin, 403, 'browser origin denied');
      const authorization = req.headers.authorization || '';
      requireThat(authorization.startsWith('Bearer '), 401, 'bearer credential required');
      const actor = options.authenticate?await options.authenticate(req):store.authenticate(authorization.slice(7));
      const parts = url.pathname.split('/').filter(Boolean);
      requireThat(parts[0] === 'v1', 404, 'route not found');
      if (req.method === 'GET') return send(res, 200, read(store, actor, parts, url));
      requireThat(req.method === 'POST', 405, 'method not supported');
      const payload = await readJson(req);
      const operation = text(req.headers['idempotency-key'], 'Idempotency-Key', 128);
      const requestHash = digest(JSON.stringify([url.pathname, payload]));
      const response = store.atomic(() => {
        const old = store.one('SELECT * FROM operations WHERE actor_id=? AND operation_id=?', actor.id, operation);
        if (old) {
          requireThat(old.request_hash === requestHash, 409, 'operation ID reused with different input');
          // Jah Noah [Q007]: "all my projects are sovereign"
          // Engineering: recheck access before returning a persisted retry receipt after revocation.
          authorizeRetry(store, actor, parts);
          return JSON.parse(old.response);
        }
        const result = write(store, actor, parts, payload);
        store.run('INSERT INTO operations VALUES(?,?,?,?)', actor.id, operation, requestHash, JSON.stringify(result));
        return result;
      });
      send(res, 200, response);
    } catch (e) {
      send(res, e instanceof Fault ? e.status : 500, {error: e instanceof Fault ? e.message : 'internal error'});
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return server;
}
function authorizeRetry(s: Store, actor: any, p: string[]) {
  if (p[1] === 'admin') requireThat(actor.admin,403,'operator credential required');
  if (p[1] === 'resources') {
    const r = s.one('SELECT * FROM resources WHERE id=?', p[2]);
    requireThat(r,404,'resource not found');
    if (p[3] === 'grants') s.manage(r.room_id,actor); else s.allowed(r,actor,'write');
  } else if (p[1] === 'rooms' && p[2]) {
    requireThat(s.member(p[2],actor),403,'room permission denied');
  }
}
function read(s: Store, actor: any, p: string[], url: URL): any {
  if (p.length === 2 && p[1] === 'node') return {protocol:1,node_id:s.nodeId(),capabilities:['rooms','charter-approval','file-revisions','scoped-replication','event-polling']};
  if (p.length === 2 && p[1] === 'rooms') return s.all('SELECT r.* FROM rooms r JOIN memberships m ON m.room_id=r.id WHERE m.identity_id=? AND m.active=1 LIMIT 100', actor.id);
  if (p[1] === 'rooms' && p[2]) {
    requireThat(s.member(p[2],actor),403,'room permission denied');
    const room = s.room(p[2]);
    if (p.length === 3) return {...room,charter:s.one('SELECT * FROM charters WHERE id=?',room.charter_id),approvals:s.all('SELECT identity_id FROM approvals WHERE charter_id=?',room.charter_id)};
    if (p[3] === 'resources' && p.length === 4) {
      requireThat(room.status==='active',409,'room not active');
      return s.all('SELECT * FROM resources WHERE room_id=?',room.id);
    }
    if (p[3] === 'events' && p.length === 4) {
      const after = Number(url.searchParams.get('after') || 0);
      requireThat(Number.isSafeInteger(after) && after>=0,400,'invalid cursor');
      return s.all('SELECT * FROM events WHERE room_id=? AND sequence>? ORDER BY sequence LIMIT 100',room.id,after);
    }
  }
  if (p[1] === 'resources' && p[2]) {
    const resource = s.one('SELECT * FROM resources WHERE id=?',p[2]);
    requireThat(resource,404,'resource not found'); s.allowed(resource,actor,'read');
    if (p.length === 3) return {node_id:s.nodeId(),...resource,revisions:s.all('SELECT * FROM revisions WHERE resource_id=? ORDER BY created_at DESC,id LIMIT 100',resource.id)};
    if (p.length === 4 && p[3] === 'replica') {
      s.allowed(resource,actor,'replicate');
      const revisionId = url.searchParams.get('revision') || resource.head;
      const revision = s.one('SELECT * FROM revisions WHERE id=? AND resource_id=?',revisionId,resource.id);
      requireThat(revision,404,'revision not found');
      return {protocol:1,node_id:s.nodeId(),resource_id:resource.id,revision,content_base64:s.bytes(revision.digest).toString('base64')};
    }
    if (p.length === 4 && p[3] === 'content') {
      const revision = s.one('SELECT * FROM revisions WHERE resource_id=? AND id=?',resource.id,url.searchParams.get('revision') || resource.head);
      requireThat(revision,404,'revision not found');
      return {revision,content_base64:s.bytes(revision.digest).toString('base64')};
    }
  }
  throw new Fault(404,'route not found');
}
function write(s: Store, actor: any, p: string[], b: any): any {
  // Jah Noah [Q001]: "you define the rules and scope of the room, and then you create it."
  // Engineering: operator enrollment is distinct from authority over any member's room.
  if (p[1] === 'admin' && p.length === 3) {
    requireThat(actor.admin, 403, 'operator credential required');
    if (p[2] === 'identities') {
      const name = text(b.name, 'name', 256);
      requireThat(typeof b.human === 'boolean', 400, 'human boolean required');
      const ttl = b.ttl_seconds ?? 86400;
      requireThat(Number.isSafeInteger(ttl) && ttl > 0 && ttl <= 2592000, 400, 'identity lifetime must be 1 second to 30 days');
      requireThat(typeof b.token_hash === 'string' && /^[a-f0-9]{64}$/.test(b.token_hash), 400, 'SHA-256 token_hash required; generate a 32-byte random token locally');
      const id = randomUUID();
      s.run('INSERT INTO identities VALUES(?,?,?)', id, name, Number(b.human));
      s.run('INSERT INTO credentials VALUES(?,?,?,?,0)', b.token_hash, id, 0, Date.now() + ttl * 1000);
      return {id, name, expires_at: Date.now() + ttl * 1000};
    }
    if (p[2] === 'revoke') {
      const id = text(b.identity_id, 'identity_id');
      requireThat(id !== actor.id, 400, 'self-revocation requires local recovery; use another operator');
      s.revoke(id); return {revoked: id};
    }
  }
  if (p.length === 2 && p[1] === 'rooms') {
    requireThat(actor.human,403,'human account required');
    const name=text(b.name,'name',256), charter=text(b.charter,'charter',32768), id=randomUUID(), cid=randomUUID();
    s.run('INSERT INTO rooms VALUES(?,?,?,?,?)',id,actor.id,name,'draft',cid);
    s.run('INSERT INTO charters VALUES(?,?,?,?,?)',cid,id,digest(charter),charter,Date.now());
    s.run('INSERT INTO memberships VALUES(?,?,?,1)',id,actor.id,'owner');
    s.event(id,actor.id,'room.drafted',id); return {id,charter_id:cid,status:'draft'};
  }
  if (p[1] === 'rooms' && p[2]) {
    const room=s.room(p[2]);
    if (p[3] === 'members' && p.length === 4) {
      s.manage(room.id,actor); const identity=text(b.identity_id,'identity_id');
      requireThat(s.one('SELECT 1 FROM identities WHERE id=?',identity),400,'unknown identity');
      requireThat(['reader','editor'].includes(b.role),400,'role must be reader or editor');
      requireThat(identity!==room.owner_id,400,'cannot replace the owner membership');
      requireThat(typeof b.active==='boolean',400,'active boolean required');
      s.run('INSERT INTO memberships VALUES(?,?,?,?) ON CONFLICT(room_id,identity_id) DO UPDATE SET role=excluded.role, active=excluded.active',room.id,identity,b.role,Number(b.active));
      s.event(room.id,actor.id,'membership.changed',identity); return {identity_id:identity,active:b.active,role:b.role};
    }
    if (p[3] === 'charter' && p.length === 4) {
      s.manage(room.id,actor); requireThat(room.status==='draft',409,'active charters are immutable in this pilot');
      const charter=text(b.charter,'charter',32768),id=randomUUID();
      s.run('INSERT INTO charters VALUES(?,?,?,?,?)',id,room.id,digest(charter),charter,Date.now());
      s.run('UPDATE rooms SET charter_id=? WHERE id=?',id,room.id);
      s.event(room.id,actor.id,'charter.revised',id); return {charter_id:id};
    }
    // Jah Noah [Q002]: "three or more people are required to sign off on the creation of a room"
    // Engineering: three active, individually enrolled humans approve one exact charter revision.
    if (p[3] === 'approve' && p.length === 4) {
      requireThat(room.status==='draft',409,'room already active');
      requireThat(actor.human && s.member(room.id,actor),403,'human room member required');
      requireThat(b.charter_id===room.charter_id,409,'charter changed; reread before approving');
      s.run('INSERT OR IGNORE INTO approvals VALUES(?,?,?)',room.charter_id,actor.id,Date.now());
      s.event(room.id,actor.id,'charter.approved',room.charter_id); return {charter_id:room.charter_id,approved:true};
    }
    if (p[3] === 'activate' && p.length === 4) {
      s.manage(room.id,actor); requireThat(room.status==='draft',409,'room already active');
      const count=s.one(`SELECT COUNT(*) AS n FROM approvals a JOIN memberships m ON m.identity_id=a.identity_id AND m.room_id=?
        JOIN identities i ON i.id=a.identity_id WHERE a.charter_id=? AND m.active=1 AND i.human=1`,room.id,room.charter_id).n;
      requireThat(count>=3,409,'three active human approvals required');
      s.run('UPDATE rooms SET status=? WHERE id=?','active',room.id);
      s.event(room.id,actor.id,'room.activated',room.id); return {id:room.id,status:'active'};
    }
    if (p[3] === 'resources' && p.length === 4) {
      const member=s.member(room.id,actor);
      requireThat(room.status==='active' && member && ['owner','editor'].includes(member.role),403,'active room editor required');
      const id=randomUUID(), revision=randomUUID(), bytes=bodyBytes(b.content_base64);
      const title=text(b.title,'title',256),kind=text(b.kind,'kind',64),hash=s.put(bytes);
      s.run('INSERT INTO resources VALUES(?,?,?,?,?)',id,room.id,title,kind,revision);
      s.run('INSERT INTO revisions VALUES(?,?,?,?,?,?,?)',revision,id,null,hash,bytes.length,actor.id,Date.now());
      s.event(room.id,actor.id,'resource.created',id); return {id,revision_id:revision,digest:hash};
    }
  }
  if (p[1]==='resources' && p[2]) {
    const r=s.one('SELECT * FROM resources WHERE id=?',p[2]); requireThat(r,404,'resource not found');
    if (p[3]==='revisions' && p.length===4) {
      s.allowed(r,actor,'write');
      // Jah Noah [Q009]: "this file may be out of date, but we can always, you know, synchronize it"
      // Engineering: a stale edit gets a conflict; no silent overwrite or last-write-wins.
      requireThat(b.base_revision_id===r.head,409,'revision conflict; fetch current head and reconcile');
      const bytes=bodyBytes(b.content_base64), hash=s.put(bytes),id=randomUUID();
      s.run('INSERT INTO revisions VALUES(?,?,?,?,?,?,?)',id,r.id,r.head,hash,bytes.length,actor.id,Date.now());
      s.run('UPDATE resources SET head=? WHERE id=?',id,r.id);
      s.event(r.room_id,actor.id,'resource.revised',r.id); return {id,resource_id:r.id,digest:hash};
    }
    if (p[3]==='grants' && p.length===4) {
      s.manage(r.room_id,actor); const identity=text(b.identity_id,'identity_id');
      requireThat(s.one('SELECT 1 FROM identities WHERE id=?',identity),400,'unknown identity');
      requireThat(['read','replicate'].includes(b.action),400,'invalid grant action');
      requireThat(Number.isSafeInteger(b.expires_at) && b.expires_at<=Date.now()+86400000,400,'grants expire within 24 hours');
      s.run('INSERT INTO grants VALUES(?,?,?,?) ON CONFLICT(resource_id,identity_id,action) DO UPDATE SET expires_at=excluded.expires_at',r.id,identity,b.action,b.expires_at);
      s.event(r.room_id,actor.id,'grant.changed',r.id); return {resource_id:r.id,identity_id:identity,action:b.action,expires_at:b.expires_at};
    }
  }
  throw new Fault(404,'route not found');
}
