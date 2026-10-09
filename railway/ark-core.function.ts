import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Jah Noah [Q007]: "all my projects are sovereign"
// Engineering: node identity survives restarts; tokens are hashed at rest.
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export class Fault extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export const requireThat = (ok: unknown, status: number, message: string) => {
  if (!ok) throw new Fault(status, message);
};
export class Store {
  db: DatabaseSync;
  root: string;
  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(join(this.root, 'blobs'), { recursive: true, mode: 0o700 });
    chmodSync(this.root, 0o700);
    this.db = new DatabaseSync(join(this.root, 'ark.sqlite'));
    chmodSync(join(this.root, 'ark.sqlite'), 0o600);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS identities(id TEXT PRIMARY KEY, name TEXT NOT NULL, human INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials(hash TEXT PRIMARY KEY, identity_id TEXT REFERENCES identities(id), admin INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, owner_id TEXT REFERENCES identities(id), name TEXT NOT NULL, status TEXT NOT NULL, charter_id TEXT);
      CREATE TABLE IF NOT EXISTS charters(id TEXT PRIMARY KEY, room_id TEXT REFERENCES rooms(id), digest TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships(room_id TEXT REFERENCES rooms(id), identity_id TEXT REFERENCES identities(id), role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(room_id,identity_id));
      CREATE TABLE IF NOT EXISTS approvals(charter_id TEXT REFERENCES charters(id), identity_id TEXT REFERENCES identities(id), created_at INTEGER NOT NULL, PRIMARY KEY(charter_id,identity_id));
      CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY, room_id TEXT REFERENCES rooms(id), title TEXT NOT NULL, kind TEXT NOT NULL, head TEXT);
      CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, resource_id TEXT REFERENCES resources(id), parent_id TEXT, digest TEXT NOT NULL, size INTEGER NOT NULL, author_id TEXT REFERENCES identities(id), created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS grants(resource_id TEXT REFERENCES resources(id), identity_id TEXT REFERENCES identities(id), action TEXT NOT NULL CHECK(action IN ('read','replicate')), expires_at INTEGER NOT NULL, PRIMARY KEY(resource_id,identity_id,action));
      CREATE TABLE IF NOT EXISTS replicas(id TEXT PRIMARY KEY, source_node_id TEXT NOT NULL, source_resource_id TEXT NOT NULL, source_revision_id TEXT NOT NULL, digest TEXT NOT NULL, size INTEGER NOT NULL, verified_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, actor_id TEXT NOT NULL, kind TEXT NOT NULL, object_id TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(actor_id TEXT NOT NULL, operation_id TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(actor_id,operation_id));`);
    if (!this.one('SELECT value FROM meta WHERE key=?', 'node_id')) {
      this.run('INSERT INTO meta VALUES(?,?)', 'node_id', randomUUID());
    }
  }
  one(sql: string, ...args: any[]): any { return this.db.prepare(sql).get(...args); }
  all(sql: string, ...args: any[]): any[] { return this.db.prepare(sql).all(...args); }
  run(sql: string, ...args: any[]) { return this.db.prepare(sql).run(...args); }
  nodeId(): string { return this.one('SELECT value FROM meta WHERE key=?', 'node_id').value; }
  close() { this.db.close(); }

  // Jah Noah [Q001]: "you define the rules and scope of the room, and then you create it."
  // Engineering: commit durable metadata and the retry receipt in one transaction.
  atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  issue(name: string, human = true, admin = false, ttl = 86400) {
    requireThat(name.trim().length > 0 && ttl > 0 && ttl <= 31536000, 400, 'invalid identity or lifetime');
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    this.atomic(() => {
      this.run('INSERT INTO identities VALUES(?,?,?)', id, name, Number(human));
      this.run('INSERT INTO credentials VALUES(?,?,?,?,0)', digest(token), id, Number(admin), Date.now() + ttl * 1000);
    });
    return { id, token, name };
  }
  authenticate(token: string): any {
    const actor = this.one(`SELECT i.*, c.admin FROM credentials c JOIN identities i ON i.id=c.identity_id
      WHERE c.hash=? AND c.revoked=0 AND c.expires_at>?`, digest(token), Date.now());
    requireThat(actor, 401, 'credential absent, expired, or revoked');
    return actor;
  }
  revoke(identityId: string) { this.run('UPDATE credentials SET revoked=1 WHERE identity_id=?', identityId); }
  room(id: string): any {
    const room = this.one('SELECT * FROM rooms WHERE id=?', id);
    requireThat(room, 404, 'room not found'); return room;
  }
  member(roomId: string, actor: any): any {
    return this.one('SELECT * FROM memberships WHERE room_id=? AND identity_id=? AND active=1', roomId, actor.id);
  }
  manage(roomId: string, actor: any) {
    const room = this.room(roomId);
    requireThat(room.owner_id === actor.id, 403, 'room owner required');
    return room;
  }
  allowed(resource: any, actor: any, action: 'read' | 'write' | 'replicate') {
    const membership = this.member(resource.room_id, actor);
    const room = this.room(resource.room_id);
    const local = room.status === 'active' && membership &&
      (action === 'read' || (action === 'write' && ['owner', 'editor'].includes(membership.role)));
    const grant = action !== 'write' && room.status === 'active' && this.one(
      'SELECT 1 FROM grants WHERE resource_id=? AND identity_id=? AND action=? AND expires_at>?',
      resource.id, actor.id, action, Date.now());
    requireThat(local || grant, 403, 'resource permission denied');
  }

  // Jah Noah [Q005]: "we have the file backed up across these different places"
  // Engineering: immutable bytes are independent of their revision records and replica locations.
  put(bytes: Buffer) {
    const hash = digest(bytes), destination = join(this.root, 'blobs', hash);
    if (!existsSync(destination)) {
      // Jah Noah [Q012]: "I- I want OnlyJah to be able to run lean"
      // Engineering: this small pilot caps the physical object store at 256 MiB.
      const used = readdirSync(join(this.root, 'blobs')).reduce((n, file) => n + statSync(join(this.root, 'blobs', file)).size, 0);
      requireThat(used + bytes.length <= 256 * 1024 * 1024, 507, 'pilot object storage limit reached');
      const temporary = destination + '.' + randomUUID() + '.tmp';
      writeFileSync(temporary, bytes, {mode: 0o600, flag: 'wx'});
      renameSync(temporary, destination);
    }
    requireThat(digest(readFileSync(destination)) === hash, 500, 'stored blob integrity failure');
    return hash;
  }
  bytes(hash: string) {
    requireThat(/^[a-f0-9]{64}$/.test(hash), 400, 'invalid digest');
    const bytes = readFileSync(join(this.root, 'blobs', hash));
    requireThat(digest(bytes) === hash, 500, 'blob integrity failure'); return bytes;
  }
  event(room: string, actor: string, kind: string, object: string) {
    this.run('INSERT INTO events(room_id,actor_id,kind,object_id,created_at) VALUES(?,?,?,?,?)', room, actor, kind, object, Date.now());
  }
}


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
export function createApi(store: Store) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://ark.local');
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, {status:'ok'});
      requireThat(!req.headers.origin, 403, 'browser origins are disabled in the pilot');
      const authorization = req.headers.authorization || '';
      requireThat(authorization.startsWith('Bearer '), 401, 'bearer credential required');
      const actor = store.authenticate(authorization.slice(7));
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


type Archive = { put(key:string,bytes:Buffer):Promise<void>; get(key:string):Promise<Buffer>; remove(key:string):Promise<void> };
export const PERSONAL_QUOTA=5_000_000_000;
// Jah Noah [Q007]: "all my projects are sovereign"
// Engineering: personal drafts have their own ownership boundary; collaborative rooms keep their three-founder rule.
export function createWeb(s:Store, origin:string, assets:Record<string,{body?:string,type:string,key?:string}>, archive:Archive|null) {
  s.db.exec(`CREATE TABLE IF NOT EXISTS web_sessions(hash TEXT PRIMARY KEY, credential_hash TEXT NOT NULL, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS web_documents(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, head TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS web_objects(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS web_revisions(id TEXT PRIMARY KEY REFERENCES web_objects(id), document_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, parent_id TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS web_files(id TEXT PRIMARY KEY REFERENCES web_objects(id), owner_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  s.db.exec('CREATE TABLE IF NOT EXISTS web_document_sources(document_id TEXT PRIMARY KEY REFERENCES web_documents(id), source_path TEXT NOT NULL);');
  s.db.exec(`CREATE TABLE IF NOT EXISTS web_projects(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS web_locations(document_id TEXT PRIMARY KEY REFERENCES web_documents(id), project_id TEXT REFERENCES web_projects(id), folder TEXT NOT NULL DEFAULT '');`);
  s.db.exec(`CREATE TABLE IF NOT EXISTS web_publications(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, document_id TEXT NOT NULL, revision_id TEXT NOT NULL REFERENCES web_revisions(id), title TEXT NOT NULL, published_at INTEGER NOT NULL, withdrawn INTEGER NOT NULL DEFAULT 0);`);
  const xml=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
  s.db.exec("CREATE TABLE IF NOT EXISTS web_file_locations(file_id TEXT PRIMARY KEY REFERENCES web_files(id), project_id TEXT REFERENCES web_projects(id), folder TEXT NOT NULL DEFAULT '');");
  function location(actor:any, b:any) {
    const project_id=b.project_id||null, folder=b.folder||'';
    requireThat(typeof folder==='string'&&folder.length<=512&&!folder.split('/').some((part:string)=>part==='.'||part==='..'||/[\\\x00-\x1f]/.test(part)),400,'invalid folder path');
    if(project_id)requireThat(s.one('SELECT id FROM web_projects WHERE id=? AND owner_id=?',project_id,actor.id),404,'project not found');
    return {project_id,folder:folder.split('/').filter(Boolean).join('/')};
  }
  const busy=new Map<string,number>(), loginAttempts=new Map<string,{n:number,until:number}>();
  const json=(v:any,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
  async function bounded(r:Request,max:number) {
    requireThat(Number(r.headers.get('content-length')||0)<=max,413,'file/request too large');
    const chunks:Uint8Array[]=[];let size=0;const reader=r.body?.getReader();
    if(reader)try {while(true){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>max){await reader.cancel();throw new Fault(413,'file/request too large');}chunks.push(v.value);}}finally{reader.releaseLock();}
    return Buffer.concat(chunks);
  }
  async function payload(r:Request) {try{const v=JSON.parse((await bounded(r,1_100_000)).toString());requireThat(v&&typeof v==='object'&&!Array.isArray(v),400,'object required');return v;}catch(e){if(e instanceof Fault)throw e;throw new Fault(400,'invalid JSON');}}
  function owned(id:string,actor:any) {const d=s.one('SELECT d.*,s.source_path,l.project_id,l.folder AS folder FROM web_documents d LEFT JOIN web_document_sources s ON s.document_id=d.id LEFT JOIN web_locations l ON l.document_id=d.id WHERE d.id=? AND d.owner_id=?',id,actor.id);requireThat(d,404,'draft not found');return d;}
  function reserve(actor:any,bytes:Buffer) {
    requireThat(archive,503,'archive connection unavailable');
    const id=randomUUID(),key=`personal/${actor.id}/${id}`;
    s.atomic(()=>{
      const used=s.one('SELECT COALESCE(SUM(size),0) AS n FROM web_objects WHERE owner_id=?',actor.id).n;
      requireThat(used+bytes.length<=PERSONAL_QUOTA,507,'5 GB archive allowance reached');
      s.run('INSERT INTO web_objects VALUES(?,?,?,?,?,?)',id,actor.id,key,bytes.length,'pending',Date.now());
    });
    return {id,key};
  }
  async function storeObject(actor:any,bytes:Buffer,commit:(o:{id:string,key:string})=>any) {
    const o=reserve(actor,bytes);
    try {await archive!.put(o.key,bytes);return s.atomic(()=>{const result=commit(o);s.run('UPDATE web_objects SET status=? WHERE id=?','ready',o.id);return result;});}
    catch(e){try{await archive!.remove(o.key);s.run('DELETE FROM web_objects WHERE id=?',o.id);}catch{}throw e;}
  }
  return async (r:Request):Promise<Response|null>=>{
    const url=new URL(r.url), path=url.pathname;
    const asset=assets[path.match(/^\/p\/[a-f0-9-]{36}$/)?'/app/publication.html':path];
    const publicMatch=path.match(/^\/publications\/([a-f0-9-]{36})(\.md)?$/);
    if(publicMatch&&r.method==='GET') {
      const post=s.one('SELECT p.*,o.object_key FROM web_publications p JOIN web_objects o ON o.id=p.revision_id WHERE p.id=?',publicMatch[1]);
      if(!post)return json({error:'publication not found'},404);
      if(post.withdrawn)return json({error:'publication withdrawn'},410);
      if(!archive)return json({error:'archive unavailable'},503);
      try {const content=JSON.parse((await archive.get(post.object_key)).toString());
        if(publicMatch[2])return new Response(content.body,{headers:{'content-type':'text/markdown; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff'}});
        return json({id:post.id,title:post.title,body:content.body,published_at:post.published_at,revision_id:post.revision_id,url:origin+'/p/'+post.id});
      }catch{return json({error:'archive unavailable'},503)}
    }
    if((path==='/publications'||path==='/feed.xml')&&r.method==='GET') {
      const posts=s.all('SELECT id,title,published_at FROM web_publications WHERE withdrawn=0 ORDER BY published_at DESC,id LIMIT 1000');
      if(path==='/publications')return json(posts.map((p:any)=>({...p,url:origin+'/p/'+p.id})));
      const items=posts.map((p:any)=>`<item><title>${xml(p.title)}</title><link>${xml(origin+'/p/'+p.id)}</link><guid isPermaLink="true">${xml(origin+'/p/'+p.id)}</guid><pubDate>${new Date(p.published_at).toUTCString()}</pubDate></item>`).join('');
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Ark publications</title><link>${xml(origin+'/publications')}</link><description>Explicitly published Ark snapshots</description>${items}</channel></rss>`,{headers:{'content-type':'application/rss+xml; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff'}});
    }
    if(asset&&r.method==='GET') {
      let content:any=asset.type==='image/png'?new Uint8Array(Buffer.from(asset.body||'','base64')):asset.body;
      if(asset.key) {
        if(!archive)return json({error:'editor asset unavailable'},503);
        try {content=new Uint8Array(await archive.get(asset.key));}catch{return json({error:'editor asset unavailable'},503);}
      }
      return new Response(content,{headers:{'content-type':asset.type,'cache-control':'no-cache','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'referrer-policy':'no-referrer',...(path==='/app/client-copy.json'?{'access-control-allow-origin':'*'}:{}),...(path==='/app/sw.js'?{'service-worker-allowed':'/app/'}:{})}});
    }
    if(!path.startsWith('/app/api/'))return null;
    let actor:any, lock=false;
    try {
      requireThat(!r.headers.get('origin')||r.headers.get('origin')===origin,403,'untrusted origin');
      requireThat(!['cross-site','same-site'].includes(r.headers.get('sec-fetch-site')||''),403,'cross-site request blocked');
      if(path==='/app/api/login'&&r.method==='POST') {
        requireThat(r.headers.get('origin')===origin,403,'origin required');
        const ip=r.headers.get('x-forwarded-for')?.split(',')[0].trim()||'unknown';
        if(loginAttempts.size>10000)loginAttempts.clear();
        const old=loginAttempts.get(ip);const limit=old&&old.until>Date.now()?old:{n:0,until:Date.now()+600000};
        requireThat(limit.n<12,429,'too many sign-in attempts; wait ten minutes');limit.n++;loginAttempts.set(ip,limit);
        const b=await payload(r);requireThat(typeof b.token==='string'&&b.token.length<=128,400,'access file token required');
        actor=s.authenticate(b.token);requireThat(actor.human,403,'human account required');
        const session=randomBytes(32).toString('hex'), csrf=randomBytes(24).toString('hex'),credential=digest(b.token);
        s.run('DELETE FROM web_sessions WHERE expires_at<?',Date.now());
        s.run('INSERT INTO web_sessions VALUES(?,?,?,?)',digest(session),credential,csrf,Date.now()+7*86400000);
        return json({id:actor.id,name:actor.name,csrf},200,{'set-cookie':`__Host-ark-session=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`});
      }
      const cookie=r.headers.get('cookie')?.match(/(?:^|;\s*)__Host-ark-session=([a-f0-9]{64})(?:;|$)/)?.[1];
      requireThat(cookie,401,'sign in to your archive');
      const session=s.one('SELECT * FROM web_sessions WHERE hash=? AND expires_at>?',digest(cookie!),Date.now());
      requireThat(session,401,'session expired');
      actor=s.one(`SELECT i.*,c.admin FROM identities i JOIN credentials c ON c.identity_id=i.id WHERE c.hash=? AND c.revoked=0 AND c.expires_at>?`,session.credential_hash,Date.now());
      requireThat(actor,401,'account access expired or revoked');
      if(r.method!=='GET') {
        requireThat(r.headers.get('origin')===origin&&r.headers.get('x-ark-csrf')===session.csrf,403,'request verification failed');
        requireThat((busy.get(actor.id)||0)<2,429,'another upload is running');busy.set(actor.id,(busy.get(actor.id)||0)+1);lock=true;
      }
      if(path==='/app/api/me'&&r.method==='GET')return json({id:actor.id,name:actor.name,csrf:session.csrf,archive_connected:!!archive});
      // Jah Noah [Q006]: "when I add a new feature, I don't got to edit 15 different projects at once"
      // Engineering: only an operator may upload the exact hash-pinned static libraries declared by this release.
      if(path==='/app/api/admin/assets'&&r.method==='POST') {
        requireThat(actor.admin,403,'operator required');const target=assets[url.searchParams.get('path')||''];
        requireThat(target?.key&&archive,400,'unknown static asset');const bytes=await bounded(r,1_000_000);
        requireThat(target.key.split('/')[1]===digest(bytes),400,'asset digest mismatch');
        await archive!.put(target.key,bytes);return json({ok:true});
      }
      if(path==='/app/api/logout'&&r.method==='POST'){s.run('DELETE FROM web_sessions WHERE hash=?',session.hash);return json({ok:true},200,{'set-cookie':'__Host-ark-session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});}
      // Jah Noah [Q009]: "this file may be out of date, but we can always, you know, synchronize it"
      // Engineering: public links pin a reviewed revision; future private edits never change that snapshot.
      if(path==='/app/api/publications'&&r.method==='GET')return json(s.all('SELECT id,document_id,revision_id,title,published_at,withdrawn FROM web_publications WHERE owner_id=? ORDER BY published_at DESC',actor.id));
      if(path==='/app/api/publications'&&r.method==='POST') {
        const b=await payload(r);const doc=owned(b.document_id,actor);
        requireThat(b.confirm_public===true&&doc.head===b.revision_id,409,'confirm the current saved revision for public access');
        const id=randomUUID();s.run('INSERT INTO web_publications VALUES(?,?,?,?,?,?,0)',id,actor.id,doc.id,doc.head,doc.title,Date.now());return json({id,url:origin+'/p/'+id,revision_id:doc.head});
      }
      const withdrawMatch=path.match(/^\/app\/api\/publications\/([a-f0-9-]{36})\/withdraw$/);
      if(withdrawMatch&&r.method==='POST') {
        requireThat(s.one('SELECT id FROM web_publications WHERE id=? AND owner_id=?',withdrawMatch[1],actor.id),404,'publication not found');
        s.run('UPDATE web_publications SET withdrawn=1 WHERE id=?',withdrawMatch[1]);return json({ok:true});
      }
      if(path==='/app/api/projects'&&r.method==='GET')return json(s.all('SELECT * FROM web_projects WHERE owner_id=? ORDER BY name,id',actor.id));
      if(path==='/app/api/projects'&&r.method==='POST') {
        const b=await payload(r);requireThat(typeof b.name==='string'&&b.name.trim().length>0&&b.name.length<=128,400,'project name required');
        const id=randomUUID();s.run('INSERT INTO web_projects VALUES(?,?,?,?)',id,actor.id,b.name.trim(),Date.now());return json({id,name:b.name.trim()});
      }
      const locationMatch=path.match(/^\/app\/api\/documents\/([a-f0-9-]{36})\/location$/);
      if(locationMatch&&r.method==='POST') {
        owned(locationMatch[1],actor);const b=location(actor,await payload(r));
        s.run('INSERT INTO web_locations VALUES(?,?,?) ON CONFLICT(document_id) DO UPDATE SET project_id=excluded.project_id,folder=excluded.folder',locationMatch[1],b.project_id,b.folder);return json(b);
      }
      if(path==='/app/api/documents'&&r.method==='GET')return json(s.all('SELECT d.*,s.source_path,l.project_id,l.folder AS folder FROM web_documents d LEFT JOIN web_document_sources s ON s.document_id=d.id LEFT JOIN web_locations l ON l.document_id=d.id WHERE owner_id=? ORDER BY updated_at DESC LIMIT 1000',actor.id));
      if(path==='/app/api/documents'&&r.method==='POST') {
        const b=await payload(r);requireThat(typeof b.title==='string'&&b.title.trim().length>0&&b.title.length<=256,400,'title required (256 characters maximum)');
        requireThat(['blog','article','document'].includes(b.kind)&&typeof b.body==='string'&&Buffer.byteLength(b.body)<=1_000_000,400,'invalid draft');
        if(b.source_path!==undefined)requireThat(typeof b.source_path==='string'&&b.source_path.length>0&&b.source_path.length<=512,400,'invalid source path');
        const id=b.id||randomUUID();requireThat(/^[a-f0-9-]{36}$/.test(id),400,'invalid draft ID');
        const before=s.one('SELECT * FROM web_documents WHERE id=?',id);if(before){owned(id,actor);requireThat(before.head===b.base_revision,409,'a newer revision exists; your local draft is kept');}else requireThat(!b.base_revision,409,'draft not found');
        const bytes=Buffer.from(JSON.stringify({title:b.title,kind:b.kind,body:b.body}));
        const saved=await storeObject(actor,bytes,o=>{
          const current=s.one('SELECT * FROM web_documents WHERE id=?',id);
          requireThat(current?current.owner_id===actor.id&&current.head===b.base_revision:!b.base_revision,409,'a newer revision exists; your local draft is kept');
          const time=Date.now();
          if(current)s.run('UPDATE web_documents SET title=?,kind=?,head=?,updated_at=? WHERE id=?',b.title,b.kind,o.id,time,id);
          else s.run('INSERT INTO web_documents VALUES(?,?,?,?,?,?)',id,actor.id,b.title,b.kind,o.id,time);
          s.run('INSERT INTO web_revisions VALUES(?,?,?,?,?,?)',o.id,id,b.title,b.kind,b.base_revision||null,time);
          if(b.source_path!==undefined)s.run('INSERT INTO web_document_sources VALUES(?,?) ON CONFLICT(document_id) DO UPDATE SET source_path=excluded.source_path',id,b.source_path);
          return {id,head:o.id,updated_at:time};
        });return json(saved);
      }
      const docMatch=path.match(/^\/app\/api\/documents\/([a-f0-9-]{36})(\/history)?$/);
      if(docMatch&&r.method==='GET') {
        const d=owned(docMatch[1],actor);
        if(docMatch[2])return json(s.all('SELECT id,title,kind,created_at FROM web_revisions WHERE document_id=? ORDER BY created_at DESC LIMIT 100',d.id));
        const rev=url.searchParams.get('revision')||d.head;
        const item=s.one('SELECT o.* FROM web_objects o JOIN web_revisions v ON v.id=o.id WHERE v.document_id=? AND v.id=? AND o.status=?',d.id,rev,'ready');requireThat(item,404,'revision not found');requireThat(archive,503,'archive unavailable');
        const value=JSON.parse((await archive!.get(item.object_key)).toString());return json({...d,...value,revision_id:rev});
      }
      if(path==='/app/api/storage'&&r.method==='GET')return json({quota_bytes:PERSONAL_QUOTA,used_bytes:s.one('SELECT COALESCE(SUM(size),0) AS n FROM web_objects WHERE owner_id=?',actor.id).n,connected:!!archive,files:s.all('SELECT f.*,o.size,l.project_id,l.folder FROM web_files f JOIN web_objects o ON o.id=f.id LEFT JOIN web_file_locations l ON l.file_id=f.id WHERE f.owner_id=? AND o.status=? ORDER BY f.created_at DESC LIMIT 1000',actor.id,'ready'),revision_count:s.one('SELECT COUNT(*) AS n FROM web_revisions v JOIN web_documents d ON d.id=v.document_id WHERE d.owner_id=?',actor.id).n});
      if(path==='/app/api/files'&&r.method==='POST') {
        const name=url.searchParams.get('name');requireThat(name&&name.length<=256&&!/[\x00-\x1f]/.test(name),400,'filename required');
        const bytes=await bounded(r,25*1024*1024);requireThat(bytes.length>0,400,'empty file');
        const result=await storeObject(actor,bytes,o=>{s.run('INSERT INTO web_files VALUES(?,?,?,?)',o.id,actor.id,name,Date.now());return {id:o.id,name,size:bytes.length};});return json(result);
      }
      const fileLocationMatch=path.match(/^\/app\/api\/files\/([a-f0-9-]{36})\/location$/);
      if(fileLocationMatch&&r.method==='POST') {
        requireThat(s.one('SELECT id FROM web_files WHERE id=? AND owner_id=?',fileLocationMatch[1],actor.id),404,'file not found');const b=location(actor,await payload(r));
        s.run('INSERT INTO web_file_locations VALUES(?,?,?) ON CONFLICT(file_id) DO UPDATE SET project_id=excluded.project_id,folder=excluded.folder',fileLocationMatch[1],b.project_id,b.folder);return json(b);
      }
      const fileMatch=path.match(/^\/app\/api\/files\/([a-f0-9-]{36})$/);
      if(fileMatch&&r.method==='GET') {
        const file=s.one('SELECT f.*,o.object_key,o.size FROM web_files f JOIN web_objects o ON o.id=f.id WHERE f.id=? AND f.owner_id=? AND o.status=?',fileMatch[1],actor.id,'ready');requireThat(file,404,'file not found');requireThat(archive,503,'archive unavailable');
        return new Response(new Uint8Array(await archive!.get(file.object_key)),{headers:{'content-type':'application/octet-stream','content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'cache-control':'no-store','x-content-type-options':'nosniff'}});
      }
      throw new Fault(404,'route not found');
    }catch(e){return json({error:e instanceof Fault?e.message:'archive request failed; your local draft is kept'},e instanceof Fault?e.status:502);}
    finally{if(lock)busy.set(actor.id,Math.max(0,(busy.get(actor.id)||1)-1));}
  };
}

const webAssets={"/app/":{"body":"<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\"><meta name=\"theme-color\" content=\"#14251d\"><meta name=\"apple-mobile-web-app-capable\" content=\"yes\"><link rel=\"manifest\" href=\"/app/manifest.webmanifest\"><link rel=\"stylesheet\" href=\"/app/vendor/easymde.min.css\"><link rel=\"stylesheet\" href=\"/app/style.css\"><title>Ark • Write & Archive</title></head><body>\n<header><a href=\"/app/\" class=\"brand\">ARK<span>write & archive</span></a><button id=\"install\" hidden>Install app</button><button id=\"logout\" hidden>Sign out</button></header>\n<main><section id=\"login\" class=\"login\"><p class=\"eyebrow\">YOUR PERSONAL ARK</p><h1>Ark</h1><blockquote>“all my projects are sovereign”<cite>Jah Noah · Q007</cite></blockquote><p>Open your private drafts and archive with your Ark access file.</p><label class=\"primary file-label\">Choose access file<input id=\"access\" type=\"file\" accept=\".json,application/json\"></label><p class=\"muted\">Use operator-access.json from your private Ark package. Your credential stays out of browser storage.</p></section>\n<section id=\"workspace\" hidden><div class=\"welcome\"><div><p class=\"eyebrow\" id=\"account\">YOUR PERSONAL ARK</p><h1>Your workspace</h1></div><span class=\"pill\" id=\"network\">Online</span></div><nav aria-label=\"Workspace\"><button id=\"write-tab\" class=\"selected\">Writing</button><button id=\"archive-tab\">Archive</button></nav>\n<section id=\"writing\"><button id=\"library-toggle\" aria-expanded=\"true\" aria-controls=\"library\">Documents & projects</button><div class=\"layout\"><aside id=\"library\"><div class=\"row\"><h2>Documents</h2><button id=\"refresh\">Refresh</button><button id=\"new\" class=\"primary\">+ New</button></div><label class=\"file-label\">Import Markdown<input id=\"import-md\" type=\"file\" accept=\".md,.markdown,text/markdown,text/plain\" multiple></label><label class=\"sr\" for=\"search\">Find a draft</label><input id=\"search\" placeholder=\"Find a draft…\" type=\"search\"><div class=\"row\"><button id=\"new-project\">+ Project</button><span id=\"document-count\" class=\"muted\"></span></div><label class=\"sr\" for=\"project-filter\">Project</label><select id=\"project-filter\"><option value=\"all\">All projects</option><option value=\"\">Unfiled</option></select><div id=\"drafts\" class=\"list\" aria-label=\"Document tree\"></div></aside>\n<section id=\"editor\"><div class=\"editor-top\"><select id=\"kind\" aria-label=\"Publication type\"><option value=\"blog\">Blog</option><option value=\"article\">Article</option><option value=\"document\">Document</option></select><span class=\"pill\">Private draft</span></div><label class=\"sr\" for=\"title\">Title</label><input id=\"title\" class=\"title\" placeholder=\"Give it a title\" maxlength=\"256\"><div class=\"location-bar\"><label>Project<select id=\"document-project\"><option value=\"\">Unfiled</option></select></label><label>Folder path<input id=\"document-folder\" placeholder=\"research/notes\" maxlength=\"512\"></label><button id=\"move-document\">Move</button></div><div class=\"toolbar\" role=\"group\" aria-label=\"Editor view\"><button id=\"edit-mode\">Write</button><button id=\"preview-toggle\">Read</button><button id=\"split-mode\">Split view</button></div><label class=\"sr\" for=\"body\">Draft text</label><textarea id=\"body\" placeholder=\"Write in your own words…\" spellcheck=\"true\"></textarea><article id=\"preview\" class=\"markdown-view\" hidden></article><div class=\"editor-bottom\"><span id=\"words\">0 words</span><span id=\"draft-state\">Ready to write</span></div><div class=\"actions\"><button id=\"save\" class=\"primary\">Save to Ark</button><button id=\"export\">Export Markdown</button><button id=\"history\">Revisions</button><button id=\"publish\">Publish snapshot</button></div><div id=\"publication-links\" class=\"list\"></div><div id=\"revisions\" class=\"list\" hidden></div><p class=\"muted\">Save keeps a private revision. Publish snapshot explicitly makes the saved text public at a permanent link.</p></section></div></section>\n<section id=\"archive\" hidden><div class=\"storage-card\"><p class=\"eyebrow\">PERSONAL ARCHIVE</p><h2 id=\"usage\">Loading storage…</h2><progress id=\"meter\" max=\"5000000000\" value=\"0\"></progress><p id=\"storage-detail\" class=\"muted\"></p></div><div class=\"row\"><h2>Files</h2><label class=\"primary file-label\">Upload file<input id=\"upload\" type=\"file\"></label></div><p class=\"muted\">Up to 25 MiB per file. Article revisions also count toward your allowance.</p><label class=\"sr\" for=\"file-search\">Find archive file</label><input id=\"file-search\" type=\"search\" placeholder=\"Find archive file or folder…\"><div class=\"location-bar\"><label>Move files to project<select id=\"archive-target-project\"><option value=\"\">Unfiled</option></select></label><label>Folder path<input id=\"archive-target-folder\" placeholder=\"media/video\" maxlength=\"512\"></label></div><div id=\"files\" class=\"list\"></div></section></section><p id=\"message\" role=\"status\" aria-live=\"polite\"></p></main><footer>Ark Core<p id=\"install-help\">On Android: browser menu → Install app or Add to Home screen.</p></footer><script src=\"/app/vendor/purify.min.js\" defer></script><script src=\"/app/vendor/marked.umd.js\" defer></script><script src=\"/app/vendor/easymde.min.js\" defer></script><script src=\"/app/app.js\" defer></script></body></html>\n","type":"text/html; charset=utf-8"},"/app/app.js":{"body":"// Jah Noah [Q009]: \"this file may be out of date, but we can always, you know, synchronize it\"\n// Engineering: drafts persist on this phone; server saves use explicit revision checks and never silently overwrite.\nconst $=id=>document.getElementById(id);let me=null,csrf='',docs=[],current=null,saving=false,dirty=false,db,editor=null,loadingEditor=false,viewMode='write',projects=[],listLimit=100,expandedFolders=new Map();\n\nfunction bodyValue(){return editor?editor.value():$('body').value}\nfunction setBody(value){loadingEditor=true;if(editor)editor.value(value);else $('body').value=value;loadingEditor=false;}\nfunction safeMarkdown(text){if(!window.marked||!window.DOMPurify)return null;return DOMPurify.sanitize(marked.parse(text,{gfm:true,breaks:false}),{FORBID_TAGS:['img','style','iframe','svg','math','form','input','button','video','audio'],FORBID_ATTR:['style']});}\nfunction ensureEditor(){if(editor||!window.EasyMDE)return;loadingEditor=true;editor=new EasyMDE({element:$('body'),autoDownloadFontAwesome:false,spellChecker:false,forceSync:true,autosave:{enabled:false},status:false,minHeight:'350px',placeholder:'Write in your own words…',previewImagesInEditor:false,toolbar:[{name:'bold',action:EasyMDE.toggleBold,className:'ark-bold',title:'Bold'},{name:'italic',action:EasyMDE.toggleItalic,className:'ark-italic',title:'Italic'},{name:'heading',action:EasyMDE.toggleHeadingSmaller,className:'ark-heading',title:'Heading'},{name:'quote',action:EasyMDE.toggleBlockquote,className:'ark-quote',title:'Quote'},{name:'list',action:EasyMDE.toggleUnorderedList,className:'ark-list',title:'List'},{name:'link',action:EasyMDE.drawLink,className:'ark-link',title:'Link'},{name:'code',action:EasyMDE.toggleCodeBlock,className:'ark-code',title:'Code'}],previewRender:text=>safeMarkdown(text)||''});loadingEditor=false;editor.codemirror.on('change',()=>{if(loadingEditor||!current)return;dirty=true;counts();keep();if(viewMode==='split')renderPreview()});}\nfunction mode(value){viewMode=value;const container=editor?.codemirror.getWrapperElement().parentElement;if(container)container.hidden=value==='read';else $('body').hidden=value==='read';$('preview').hidden=value==='write';$('editor').classList.toggle('split-view',value==='split');for(const [id,m] of [['edit-mode','write'],['preview-toggle','read'],['split-mode','split']])$(id).classList.toggle('selected',value===m);if(value!=='write')renderPreview();editor?.codemirror.refresh();}\n\nconst ready=new Promise((resolve,reject)=>{const r=indexedDB.open('ark-writing-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts',{keyPath:'key'});r.onsuccess=()=>{db=r.result;resolve()};r.onerror=()=>reject(r.error)});\nasync function local(action,value){await ready;return new Promise((resolve,reject)=>{const t=db.transaction('drafts',action==='getAll'?'readonly':'readwrite'),s=t.objectStore('drafts');let result;const r=s[action](value);r.onsuccess=()=>result=r.result;t.oncomplete=()=>resolve(result);t.onerror=()=>reject(t.error)})}\nconst msg=text=>{$('message').textContent=text};const fmt=n=>n<1e6?(n/1000).toFixed(1)+' KB':n<1e9?(n/1e6).toFixed(1)+' MB':(n/1e9).toFixed(2)+' GB';\nasync function api(path,body,raw=false){const options={credentials:'same-origin',cache:'no-store',headers:{}};if(body!==undefined){options.method='POST';options.headers['x-ark-csrf']=csrf;if(!raw)options.headers['content-type']='application/json';options.body=raw?body:JSON.stringify(body)}const r=await fetch('/app/api/'+path,options);if(!r.ok){let v;try{v=await r.json()}catch{}throw new Error(v?.error||'Connection failed')}return r.json()}\nfunction stamp(){return {key:me.id+':'+current.id,owner:me.id,id:current.id,title:$('title').value,kind:$('kind').value,body:bodyValue(),head:current.head||null,source_path:current.source_path,project_id:current.project_id,folder:current.folder,dirty,updated_at:Date.now()}}\nasync function keep(){if(!me||!current)return;try{await local('put',stamp());$('draft-state').textContent=dirty?'Saved on this phone':'Saved to Ark'}catch{$('draft-state').textContent='Phone storage failed. Export your draft.';msg('Phone storage is unavailable. Export before leaving.')}}\nfunction counts(){$('words').textContent=(bodyValue().trim().match(/\\S+/g)||[]).length+' words'}\nfunction openEditor(d){current=d;dirty=!!d.dirty;$('document-project').value=d.project_id||'';$('document-folder').value=d.folder||'';$('title').value=d.title||'';$('kind').value=d.kind||'blog';setBody(d.body||'');mode(viewMode);$('revisions').hidden=true;$('publication-links').replaceChildren();counts();$('draft-state').textContent=dirty?'Saved on this phone':'Saved to Ark';renderList();loadPublications(d.id);}\nasync function select(d){if(saving){msg('Wait for the current save to finish.');return}await keep();try{const own=(await local('getAll')).find(v=>v.key===me.id+':'+d.id);if(own?.dirty){openEditor(own);msg('Recovered your unsaved phone draft.')}else{const remote=await api('documents/'+d.id);openEditor(remote);await keep()}}catch(e){const own=(await local('getAll')).find(v=>v.key===me.id+':'+d.id);if(own){openEditor(own);msg('Offline copy opened. Save to Ark when connected.')}else msg(e.message)}}\n// Jah Noah [Q007]: \"all my projects are sovereign\"\n// Engineering: nested disclosures keep a large library navigable; render bounded batches instead of thousands of cards.\nfunction renderList(){\n const list=$('drafts');list.replaceChildren();const q=$('search').value.toLowerCase(),filter=$('project-filter').value;\n const matches=docs.filter(d=>(filter==='all'||(d.project_id||'')===filter)&&((d.title||'Untitled')+' '+(d.folder||'')+' '+(d.source_path||'')).toLowerCase().includes(q));\n $('document-count').textContent=matches.length+' documents';const groups=new Map();\n for(const d of matches.slice(0,listLimit)){\n  const project=d.project_id||'',folder=d.folder||'';const key=project+'/'+folder;\n  let parent=list;\n  if(project||folder){\n   const parts=[projects.find(p=>p.id===project)?.name||'Unfiled',...folder.split('/').filter(Boolean)];let prefix=project;\n   for(const part of parts){prefix+='/'+part;if(!groups.has(prefix)){const detail=document.createElement('details'),summary=document.createElement('summary'),children=document.createElement('div');summary.textContent=part;detail.open=!!q||(expandedFolders.has(prefix)?expandedFolders.get(prefix):d.id===current?.id);const folderKey=prefix;detail.ontoggle=()=>expandedFolders.set(folderKey,detail.open);detail.append(summary,children);parent.append(detail);groups.set(prefix,children)}parent=groups.get(prefix)}\n  }\n  const button=document.createElement('button');button.className='item'+(current?.id===d.id?' active':'');button.setAttribute('aria-current',current?.id===d.id?'page':'false');\n  const box=document.createElement('div'),title=document.createElement('strong'),info=document.createElement('small');title.textContent=d.title||'Untitled';info.textContent=(d.kind||'blog')+' · '+(d.dirty?'On this phone':new Date(d.updated_at).toLocaleDateString());box.append(title,info);button.append(box);button.onclick=async()=>{await select(d);if(matchMedia('(max-width: 750px)').matches){$('library').hidden=true;$('library-toggle').setAttribute('aria-expanded','false');$('library-toggle').focus()}};parent.append(button);\n }\n if(matches.length>listLimit){const more=document.createElement('button');more.textContent='Show 100 more';more.onclick=()=>{listLimit+=100;renderList()};list.append(more)}\n if(!matches.length)list.textContent='No documents match this view.';\n}\nasync function loadProjects(){try{projects=await api('projects')}catch{}const previous=$('project-filter').value;for(const id of ['project-filter','document-project','archive-target-project']){const select=$(id);select.replaceChildren();if(id==='project-filter'){const all=document.createElement('option');all.value='all';all.textContent='All projects';select.append(all)}const none=document.createElement('option');none.value='';none.textContent='Unfiled';select.append(none);for(const p of projects){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;select.append(option)}}$('project-filter').value=previous||'all';if(current)$('document-project').value=current.project_id||'';}\n$('project-filter').onchange=()=>{listLimit=100;renderList()};\n$('library-toggle').onclick=()=>{const closed=!$('library').hidden;$('library').hidden=closed;$('library-toggle').setAttribute('aria-expanded',String(!closed));editor?.codemirror.refresh()};\n$('new-project').onclick=async()=>{const name=prompt('Project name');if(!name?.trim())return;try{await api('projects',{name});await loadProjects();renderList();msg('Project created. Select it above the document to move writing into it.')}catch(e){msg(e.message)}};\n$('move-document').onclick=async()=>{if(!current?.head){msg('Save the document before moving it.');return}try{const value=await api('documents/'+current.id+'/location',{project_id:$('document-project').value||null,folder:$('document-folder').value});current={...current,...value};await keep();await refresh();msg('Document location saved.')}catch(e){msg(e.message)}};\nasync function refresh(){let remote=[];try{remote=await api('documents')}catch(e){msg(e.message)}const saved=(await local('getAll')).filter(v=>v.owner===me.id);const map=new Map(remote.map(v=>[v.id,v]));for(const d of saved)if(d.dirty||!map.has(d.id))map.set(d.id,d);docs=[...map.values()].sort((a,b)=>b.updated_at-a.updated_at);renderList()}\nasync function newDraft(){if(saving)return;await keep();const d={id:crypto.randomUUID(),title:'',body:'',kind:'blog',dirty:true,updated_at:Date.now()};openEditor(d);dirty=true;await keep();await refresh();$('title').focus()}\nasync function start(profile){me=profile;csrf=profile.csrf||'';localStorage.setItem('ark-profile',JSON.stringify({id:me.id,name:me.name}));$('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;ensureEditor();await loadProjects();$('account').textContent=me.name+' · PERSONAL ARK';await refresh();if(docs.length)await select(docs[0]);else await newDraft()}\n$('access').onchange=async e=>{try{const f=e.target.files[0];if(!f||f.size>16384)throw new Error('Choose your Ark JSON access file.');const v=JSON.parse(await f.text());if(v.public_url&&new URL(v.public_url).origin!==location.origin)throw new Error('This access file belongs to another server.');const r=await api('login',{token:v.token});await start(r);msg('Your private workspace is open.')}catch(e){msg(e.message)}finally{e.target.value=''}};\n$('logout').onclick=async()=>{if(saving)return;await keep();try{await api('logout',{})}catch(e){msg(e.message);return}localStorage.removeItem('ark-profile');me=null;csrf='';current=null;$('title').value='';setBody('');$('preview').textContent='';$('workspace').hidden=true;$('login').hidden=false;$('logout').hidden=true;msg('Signed out. Unsaved drafts stay on this phone for your account.')};\nfor(const id of ['title','body','kind'])$(id).addEventListener('input',()=>{if(!current)return;dirty=true;counts();keep();});\n$('new').onclick=newDraft;$('refresh').onclick=()=>syncDocuments(true);$('search').oninput=()=>{listLimit=100;renderList()};\n$('save').onclick=async()=>{if(saving||!current)return;if(!navigator.onLine){await keep();msg('Saved on this phone. Reconnect to save to Ark.');return}saving=true;$('save').disabled=true;const draft=stamp();try{const saved=await api('documents',{id:draft.id,title:draft.title,kind:draft.kind,body:draft.body,base_revision:draft.head,...(draft.source_path?{source_path:draft.source_path}:{})});current.head=saved.head;const now=stamp();dirty=now.body!==draft.body||now.title!==draft.title||now.kind!==draft.kind;await keep();await refresh();msg(dirty?'Revision saved. Your newer typing is kept on this phone.':'Private revision saved to Ark.')}catch(e){await keep();msg(e.message+' You can export your local draft.')}finally{saving=false;$('save').disabled=false}};\n$('export').onclick=()=>{const text=($('kind').value==='document'?bodyValue():'# '+$('title').value+'\\n\\n'+bodyValue())+'\\n';const u=URL.createObjectURL(new Blob([text],{type:'text/markdown'}));const a=document.createElement('a');a.href=u;a.download=($('title').value||'ark-draft').replace(/[^\\w -]/g,'').slice(0,80)+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};\nfunction renderPreview(){const root=$('preview'),html=safeMarkdown(bodyValue());if(html===null){root.textContent=bodyValue();return}root.innerHTML=html;for(const a of root.querySelectorAll('a')){a.rel='noopener noreferrer';const href=a.getAttribute('href')||'';if(/^https?:/i.test(href))a.target='_blank';else if(href.endsWith('.md')){const title=href.split('/').pop();const d=docs.find(d=>(d.source_path||'').split('/').pop()===title);if(d){a.href='#';a.onclick=e=>{e.preventDefault();select(d).then(()=>mode('read'))}}else a.removeAttribute('href')}}}\n$('preview-toggle').onclick=()=>mode('read');$('edit-mode').onclick=()=>mode('write');$('split-mode').onclick=()=>mode('split');\n$('history').onclick=async()=>{if(!current?.head){msg('Save a revision first.');return}try{const list=await api('documents/'+current.id+'/history');$('revisions').replaceChildren();$('revisions').hidden=false;for(const r of list){const b=document.createElement('button');b.className='item';b.textContent=new Date(r.created_at).toLocaleString()+' · '+r.title;b.onclick=async()=>{if(saving)return;if(dirty&&!confirm('Replace the editor text with this older revision? Export your current text first to keep a separate copy.'))return;try{const value=await api('documents/'+current.id+'?revision='+r.id);const head=current.head;openEditor({...value,head,dirty:true});dirty=true;await keep();msg('Older text loaded. Save to create a new revision.')}catch(e){msg(e.message)}};$('revisions').append(b)}}catch(e){msg(e.message)}};\nasync function storage(){try{const data=await api('storage');$('usage').textContent=fmt(data.used_bytes)+' of 5 GB';$('meter').value=data.used_bytes;$('storage-detail').textContent=(data.connected?'Connected · ':'Not connected · ')+data.revision_count+' saved article revisions · all versions count';$('files').replaceChildren();for(const f of data.files.filter(f=>(f.name+' '+(f.folder||'')).toLowerCase().includes($('file-search').value.toLowerCase()))){const row=document.createElement('div');row.className='item';const box=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('small'),a=document.createElement('a');name.textContent=f.name;detail.textContent=fmt(f.size)+' · '+(projects.find(p=>p.id===f.project_id)?.name||'Unfiled')+(f.folder?' / '+f.folder:'')+' · '+new Date(f.created_at).toLocaleDateString();a.href='/app/api/files/'+f.id;a.textContent='Download';box.append(name,detail);row.append(box,a);const move=document.createElement('button');move.textContent='Move';move.onclick=async()=>{try{await api('files/'+f.id+'/location',{project_id:$('archive-target-project').value||null,folder:$('archive-target-folder').value});await storage();msg('File location saved. Stored bytes are unchanged.')}catch(e){msg(e.message)}};row.append(move);if(/\\.(md|markdown)$/i.test(f.name)&&f.size<=1000000){const open=document.createElement('button');open.textContent='Open';open.onclick=async()=>{if(saving)return;try{const response=await fetch('/app/api/files/'+f.id,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('Unable to read this Markdown file.');const text=await response.text();await newDraft();$('title').value=(text.match(/^#\\s+(.+)$/m)?.[1]||f.name).slice(0,256);$('kind').value='document';current.source_path=f.name;setBody(text);dirty=true;await keep();counts();tab(false);mode('read');msg('Opened a phone draft from the archive. Save to Ark to keep an editable document.')}catch(e){msg(e.message)}};row.append(open)}$('files').append(row)}if(!data.files.length)$('files').textContent='Your archive is empty. Upload your first file.'}catch(e){msg(e.message)}}\n$('upload').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>25*1024*1024)throw new Error('Each file can be up to 25 MiB.');msg('Uploading '+f.name+'…');await api('files?name='+encodeURIComponent(f.name),f,true);await storage();msg('File saved to your private archive.')}catch(e){msg(e.message)}finally{e.target.value=''}};\nfunction tab(archive){$('archive').hidden=!archive;$('writing').hidden=archive;$('archive-tab').classList.toggle('selected',archive);$('write-tab').classList.toggle('selected',!archive);if(archive)storage()};$('archive-tab').onclick=()=>tab(true);$('write-tab').onclick=()=>tab(false);\nfunction network(){$('network').textContent=navigator.onLine?'Online':'Offline';if(!navigator.onLine)msg('Offline. Writing stays on this phone.')}window.addEventListener('online',async()=>{network();try{const p=await api('me');if(me&&p.id===me.id)csrf=p.csrf;}catch{msg('Sign in again before saving to Ark.')}});window.addEventListener('offline',network);network();\nlet promptInstall;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();promptInstall=e;$('install').hidden=false});$('install').onclick=async()=>{if(promptInstall){await promptInstall.prompt();promptInstall=null;$('install').hidden=true}};\nif('serviceWorker'in navigator)navigator.serviceWorker.register('/app/sw.js',{scope:'/app/'}).catch(()=>{});\nwindow.addEventListener('beforeunload',e=>{if(saving){e.preventDefault();e.returnValue=''}});\n(async()=>{try{await ready;await start(await api('me'))}catch(e){if(!navigator.onLine){const p=JSON.parse(localStorage.getItem('ark-profile')||'null');if(p){await start(p);msg('Offline workspace. Reconnect before saving to Ark.')}}}})();\n\n// Jah Noah [Q009]: \"this file may be out of date, but we can always, you know, synchronize it\"\n// Engineering: refresh on return and poll while visible; recheck dirty state after awaiting the server.\nlet syncing=false;\nasync function syncDocuments(manual=false){if(!me||syncing||saving||!navigator.onLine)return;syncing=true;const active=current?.id;try{await refresh();const remote=docs.find(d=>d.id===active);if(remote&&current?.id===active&&remote.head!==current.head){if(dirty){if(manual)msg('The server changed. Your unsaved writing is kept; save will check for conflicts.')}else{const fresh=await api('documents/'+active);if(!dirty&&!saving&&current?.id===active){openEditor(fresh);await keep();if(manual)msg('Latest revision loaded.')}}}else if(manual)msg('Document list refreshed.')}catch(e){if(manual)msg(e.message)}finally{syncing=false}}\ndocument.addEventListener('visibilitychange',()=>{if(!document.hidden)syncDocuments()});window.addEventListener('focus',()=>syncDocuments());setInterval(()=>{if(!document.hidden)syncDocuments()},15000);\n$('import-md').onchange=async e=>{try{for(const file of e.target.files){if(file.size>1000000)throw new Error('Markdown files can be up to 1 MB.');const text=await file.text();const heading=text.match(/^#\\s+(.+)$/m);await api('documents',{title:(heading?.[1]||file.name).slice(0,256),kind:'document',body:text,source_path:file.name,base_revision:null});}await syncDocuments();msg('Markdown imported into Ark. Select it from Documents.')}catch(e){msg(e.message)}finally{e.target.value=''}};\n\n// Jah Noah [Q007]: \"all my projects are sovereign\"\n// Engineering: publishing is a separate deliberate action; listing links never grants access to private drafts.\nfunction publicationRow(post){const row=document.createElement('div'),link=document.createElement('a'),withdraw=document.createElement('button');row.className='item';link.href=post.url||location.origin+'/p/'+post.id;link.textContent='Snapshot · '+new Date(post.published_at||Date.now()).toLocaleDateString();link.target='_blank';link.rel='noopener';withdraw.textContent='Withdraw';withdraw.onclick=async()=>{try{await api('publications/'+post.id+'/withdraw',{});row.remove();msg('Snapshot withdrawn. Its link now returns Gone.')}catch(e){msg(e.message)}};row.append(link,withdraw);return row}\nasync function loadPublications(id){try{const posts=await api('publications');if(current?.id!==id)return;$('publication-links').replaceChildren(...posts.filter(p=>p.document_id===id&&!p.withdrawn).map(publicationRow))}catch{}}\n$('publish').onclick=async()=>{if(!current?.head||dirty||saving){msg('Save your current text before publishing.');return}if(!confirm('Publish this saved revision publicly? Anyone with the link can read it. Later edits stay private until separately published.'))return;try{const post=await api('publications',{document_id:current.id,revision_id:current.head,confirm_public:true});$('publication-links').append(publicationRow(post));msg('Public snapshot created. Copy its link for your website or feed.')}catch(e){msg(e.message)}};\n\n$('file-search').oninput=storage;\n","type":"text/javascript; charset=utf-8"},"/app/publication.html":{"body":"<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Ark publication</title><link rel=\"stylesheet\" href=\"/app/style.css\"><link rel=\"alternate\" type=\"application/rss+xml\" href=\"/feed.xml\" title=\"Ark publications\"></head><body><header><a class=\"brand\" href=\"/app/\">Ark</a></header><main><h1 id=\"publication-title\">Publication</h1><p id=\"publication-status\" role=\"status\">Loading…</p><article id=\"publication-body\" class=\"markdown-view\"></article></main><script src=\"/app/vendor/purify.min.js\" defer></script><script src=\"/app/vendor/marked.umd.js\" defer></script><script src=\"/app/publication.js\" defer></script></body></html>","type":"text/html; charset=utf-8"},"/app/publication.js":{"body":"// Jah Noah [Q007]: \"all my projects are sovereign\"\n// Engineering: only explicitly published snapshots reach this reader; sanitize Markdown before attaching it to the page.\n(async()=>{const status=document.getElementById('publication-status');try{const id=location.pathname.split('/').pop(),r=await fetch('/publications/'+id,{credentials:'omit',cache:'no-store'});if(!r.ok)throw new Error(r.status===410?'This publication was withdrawn.':'Publication unavailable.');const p=await r.json();document.title=p.title+' · Ark';document.getElementById('publication-title').textContent=p.title;document.getElementById('publication-body').innerHTML=DOMPurify.sanitize(marked.parse(p.body,{gfm:true}),{FORBID_TAGS:['img','style','iframe','svg','math','form','input','button','video','audio'],FORBID_ATTR:['style']});for(const a of document.querySelectorAll('article a')){a.rel='noopener noreferrer';if(/^https?:/i.test(a.getAttribute('href')||''))a.target='_blank';else if(!(a.getAttribute('href')||'').startsWith('#'))a.removeAttribute('href')}status.textContent='Published '+new Date(p.published_at).toLocaleDateString()}catch(e){status.textContent=e.message}})();\n","type":"text/javascript; charset=utf-8"},"/app/style.css":{"body":":root{color-scheme:light;--bg:#f4f2e9;--ink:#14251d;--line:#d9ddcc;--accent:#deb95d;--muted:#657364}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,sans-serif}header{background:var(--ink);color:#fff;padding:18px max(20px,calc((100vw - 1180px)/2));display:flex;gap:12px;align-items:center}.brand{font-size:26px;font-weight:800;letter-spacing:.09em;color:#f7d780;text-decoration:none;margin-right:auto}.brand span{display:block;font-size:10px;letter-spacing:.18em;color:#d3decf}main{max-width:1180px;margin:auto;padding:30px 20px}h1{font-family:Georgia,serif;font-size:clamp(32px,6vw,58px);line-height:1.12;margin:10px 0 24px;font-weight:400}h2{font-size:20px;margin:12px 0}button,.file-label,select{min-height:44px;padding:10px 15px;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:8px;font:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:wait}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,.file-label:focus-within{outline:3px solid #ba822c;outline-offset:3px}.primary{background:var(--accent);border-color:var(--accent);font-weight:650}header button{background:transparent;color:#fff;border-color:#53715c;font-size:13px}.file-label{display:inline-flex;align-items:center;position:relative;overflow:hidden}.file-label input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}input,textarea{font:inherit;width:100%;padding:12px;border:1px solid var(--line);background:#fff;border-radius:8px;color:var(--ink)}input[type=search]{margin-bottom:16px}.login{max-width:560px;padding:35px 0 50px}.eyebrow{font-size:11px;font-weight:750;letter-spacing:.18em;color:var(--muted)}blockquote{border-left:3px solid var(--accent);margin:25px 0;padding:10px 20px;font-family:Georgia,serif;font-size:21px}cite{display:block;font:12px system-ui;color:var(--muted);margin-top:10px}.muted{font-size:13px;color:var(--muted);max-width:650px}.welcome,.row{display:flex;justify-content:space-between;align-items:center;gap:10px}.welcome h1{font-size:38px}.pill{font-size:11px;white-space:nowrap;border:1px solid #ccd8c6;background:#e7eedf;padding:5px 10px;border-radius:30px}nav{display:flex;gap:10px;border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:24px}nav .selected{background:var(--ink);color:#fff;border-color:var(--ink)}.layout{display:grid;grid-template-columns:270px minmax(0,1fr);gap:28px}.list{display:grid;gap:10px}.item{display:flex;align-items:center;gap:10px;text-align:left;border:1px solid var(--line);background:#fff;padding:14px;border-radius:9px;min-width:0}.item>div{min-width:0;flex:1}.item strong{display:block;overflow-wrap:anywhere}.item small{display:block;color:var(--muted);font-size:11px}.item.active{border-color:#719061;background:#ecf1e7}#editor{border:1px solid var(--line);background:#fff;border-radius:14px;padding:22px;min-width:0}.editor-top{display:flex;gap:12px;align-items:center;justify-content:space-between}.title{border:0;border-bottom:1px solid var(--line);border-radius:0;font:30px/1.3 Georgia,serif;padding:22px 0 16px}.toolbar{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0}.toolbar button{font-size:12px;padding:6px 10px;min-height:36px}textarea{min-height:400px;resize:vertical;border:0;padding:8px 0;line-height:1.8;border-radius:0}#preview{min-height:400px;white-space:pre-wrap;overflow-wrap:anywhere;font-family:Georgia,serif;line-height:1.85}.editor-bottom{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);border-top:1px solid var(--line);padding:12px 0}.actions{display:flex;flex-wrap:wrap;gap:8px}.storage-card{background:#e8eddc;padding:22px;border-radius:12px;margin-bottom:24px}progress{width:100%;height:12px;accent-color:#42663d}#message{position:sticky;bottom:12px;background:var(--ink);color:#fff;padding:14px 18px;border-radius:9px;font-size:14px;z-index:5;box-shadow:0 3px 14px #0002}#message:empty{display:none}footer{max-width:1180px;margin:15px auto;padding:20px;color:var(--muted);font-size:11px;border-top:1px solid var(--line)}.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}[hidden]{display:none!important}@media(max-width:750px){main{padding:22px 16px}.layout{grid-template-columns:1fr;gap:20px}#drafts{display:flex;overflow-x:auto;padding-bottom:8px}#drafts .item{min-width:180px;max-width:230px}#editor{padding:16px}textarea,#preview{min-height:45vh}.welcome h1{font-size:31px}header{padding:14px 16px}.brand{font-size:22px}.brand span{font-size:9px}.actions button{flex:1;font-size:13px}.title{font-size:27px}footer{padding:16px}}@media(display-mode:standalone){#install-help{display:none}}\n.EasyMDEContainer .CodeMirror{font:16px/1.7 system-ui,sans-serif;border-color:var(--line);border-radius:0 0 8px 8px;min-height:350px}.EasyMDEContainer .editor-toolbar{border-color:var(--line);border-radius:8px 8px 0 0}.editor-toolbar button{min-height:38px;min-width:38px;width:auto!important;color:var(--ink)}.ark-bold:before{content:'B';font-weight:bold}.ark-italic:before{content:'I';font-style:italic}.ark-heading:before{content:'H'}.ark-quote:before{content:'❝'}.ark-list:before{content:'≡'}.ark-link:before{content:'Link';font-size:11px}.ark-code:before{content:'</>';font-size:11px}.markdown-view{white-space:normal!important;font-family:system-ui,sans-serif!important;overflow-wrap:anywhere}.markdown-view pre{white-space:pre;overflow:auto;background:#eef0e8;padding:16px;border-radius:8px;font-size:13px}.markdown-view code{font-size:.9em;background:#eef0e8}.markdown-view table{display:block;overflow:auto;border-collapse:collapse;font-size:14px;max-width:100%}.markdown-view td,.markdown-view th{border:1px solid var(--line);padding:8px 12px}.markdown-view h1{font-size:32px}.markdown-view h2{font-size:25px}.markdown-view blockquote{font-size:18px}.markdown-view a{color:#315b32}.toolbar .selected{background:var(--ink);color:white}#editor.split-view{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}#editor.split-view>.EasyMDEContainer,#editor.split-view>#preview{grid-column:auto;min-width:0}#editor.split-view>:not(.EasyMDEContainer):not(#preview){grid-column:1/-1}aside>.file-label{margin:12px 0;font-size:13px}aside .row{flex-wrap:wrap}@media(max-width:750px){#editor.split-view{display:block}#editor.split-view #preview{margin-top:20px;border-top:1px solid var(--line)}.EasyMDEContainer .CodeMirror{min-height:45vh}}\n\n/* Jah Noah [Q007]: \"all my projects are sovereign\" */\n/* Engineering: a vertical, bounded library and collapsible mobile pane replace the horizontal document carousel. */\nheader,main,footer{min-width:0}header{flex-wrap:wrap}button,select,input{max-width:100%}.layout>*{min-width:0}#library{position:sticky;top:12px;align-self:start;max-height:calc(100dvh - 24px);overflow:auto;scrollbar-gutter:stable}#library-toggle{margin-bottom:12px}#drafts{display:grid;overflow:visible;padding:12px 0;gap:6px}#drafts .item{width:100%;min-width:0;max-width:none;padding:10px}#drafts strong{font-size:14px}#drafts details{min-width:0;border-left:1px solid var(--line);padding-left:10px}#drafts summary{cursor:pointer;overflow-wrap:anywhere;padding:10px 0;min-height:44px;font-weight:650}#drafts details>div{display:grid;gap:5px}#project-filter{width:100%;margin-top:10px}.location-bar{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;align-items:end;gap:8px;margin:12px 0}.location-bar label{font-size:12px;min-width:0}.location-bar select{display:block;width:100%}#files .item{flex-wrap:wrap}#files .item>div{flex-basis:55%;overflow-wrap:anywhere}.CodeMirror{max-width:100%}.editor-top,.editor-bottom{flex-wrap:wrap}#message{overflow-wrap:anywhere}.welcome{flex-wrap:wrap}@media(max-width:750px){#library{position:static;max-height:50dvh;border-bottom:1px solid var(--line);padding-bottom:12px}.location-bar{grid-template-columns:minmax(0,1fr)}.location-bar button{justify-self:start}.layout{gap:12px}.editor-toolbar{display:flex;flex-wrap:wrap}.actions button{flex:1 1 125px}.markdown-view pre{max-width:100%}.brand{min-width:0}header button{padding:8px}.welcome h1{font-size:28px}}\n","type":"text/css"},"/app/sw.js":{"body":"// Jah Noah [Q007]: \"all my projects are sovereign\"\n// Engineering: cache the app shell only; authenticated responses and credentials never enter Cache Storage.\nconst CACHE='ark-shell-0.4.0',FILES=['/app/','/app/style.css','/app/app.js','/app/manifest.webmanifest','/app/icon.svg','/app/icon-192.png','/app/icon-512.png','/app/vendor/easymde.min.js','/app/vendor/easymde.min.css','/app/vendor/purify.min.js','/app/vendor/marked.umd.js'];\nself.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()))});\nself.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ark-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});\nself.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin||!FILES.includes(u.pathname))return;event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(u.pathname,copy)))}return response}).catch(()=>caches.match(u.pathname)))});\n","type":"text/javascript"},"/app/manifest.webmanifest":{"body":"{\"name\": \"Ark Write & Archive\", \"short_name\": \"Ark\", \"id\": \"/app/\", \"start_url\": \"/app/\", \"scope\": \"/app/\", \"display\": \"standalone\", \"background_color\": \"#f4f2e9\", \"theme_color\": \"#14251d\", \"icons\": [{\"src\": \"/app/icon-192.png\", \"sizes\": \"192x192\", \"type\": \"image/png\", \"purpose\": \"any maskable\"}, {\"src\": \"/app/icon-512.png\", \"sizes\": \"512x512\", \"type\": \"image/png\", \"purpose\": \"any maskable\"}]}","type":"application/manifest+json"},"/app/icon.svg":{"body":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 192 192\"><rect width=\"192\" height=\"192\" rx=\"40\" fill=\"#14251d\"/><text x=\"96\" y=\"115\" text-anchor=\"middle\" fill=\"#f7d780\" font-family=\"sans-serif\" font-weight=\"bold\" font-size=\"42\">ARK</text></svg>\n","type":"image/svg+xml"},"/app/client-copy.json":{"body":"{\n  \"version\": \"2026-10-09.1\",\n  \"title\": \"Ark\",\n  \"quote\": \"all my projects are sovereign\",\n  \"author\": \"Jah Noah\",\n  \"quote_id\": \"Q007\"\n}\n","type":"application/json"},"/app/icon-192.png":{"body":"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929UOZVetjHP1Cg/mvz6pWHIyFmb8tftKlJaOmJwr88yx7l2025D2grIxeg0ITZI3TFTovt4Yq/sCCHuVNZv+vKCdNGIwb1+HOmPDL5y8+m1O88pLR0+qNfWzPEqvnmtLm0FNDE2WPWXmp0M+ikJ/fBxNuwpVjqlXTzr8Wcp7bVqS8H7O84oLY0a6LMtM7WHizO4lY6grasw6ds/Qojfrjvx2cF/PvHPJ8UFr38zufXn05NDleYP21XWNny6/+JraRGtF0WH+cYN8QdfPF29tdBiEa2f6z0ydID3thXjZy89WFvXhGxFdRqagXp7u8bIftjVYrbsP1lmywi5BTekk0RESE+lt3naZcOeYqUzIaUvvl3WbCts48e1kaHe21ekurva9PsCh9FQQNOSQ6Rv/Z0sulVZ22DLCKbGltzT8l9OqXIqXVFj2nLgonTRyDBf5HLse+/vOLNqS4HS0oiQntuzUqUvljwtGgooPUn+He87Lnn+pSRb9o6iECItqb/0B3vttX53cUOTWbpo8YtR+PhCiLU7zyndeRJChPfz2pE1Ab8sUItWAho+qFewv+T3Mc0tloPflNk+zpFvyx+aJE86fTxcHv2vEUAV1YqT0Khw3xg1JiEhxLpdRe98kq+0dHCw5/asVC93TTSklYDSx8jvPh87U96u08bGJvOhU/Jfjyu9INte63cXNSpMQr9UaRISQvxpd3Hmx6eUlv4oyHNH1oSe7pIX7hxM1zMUvVFL/8+0MgNRJ8WACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACMKACPJvvpCYYWj+tTgAAAAASUVORK5CYII=","type":"image/png"},"/app/icon-512.png":{"body":"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","type":"image/png"},"/app/vendor/easymde.min.js":{"key":"app-assets/2c06bddfd0c89176db08ccf9d42e2beaa9b4f1a4ff8fb2ec0bf1bed25ce08e05/easymde.min.js","type":"text/javascript"},"/app/vendor/easymde.min.css":{"key":"app-assets/6eee36340432776d682e7372ec4a7eb29be4fdb3ffada32c0bfa5e31a5ef34a2/easymde.min.css","type":"text/css"},"/app/vendor/purify.min.js":{"key":"app-assets/2c90a9b46d6463f26038a29b686e82bc91de01fdac9d5229e7cfe3b360134ea2/purify.min.js","type":"text/javascript"},"/app/vendor/marked.umd.js":{"key":"app-assets/f424dcb508fdf93e0137a970cfce8f3207ea2e3f37eca5f7556a52875683632a/marked.umd.js","type":"text/javascript"}};
// Jah Noah [Q007]: "all my projects are sovereign"
// Engineering: refuse to initialize private data on Railway's ephemeral filesystem.
const bundleTest = process.env.ARK_BUNDLE_TEST === '1';
const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
requireThat(bundleTest || mount === '/data', 500, 'Ark Core requires a persistent Railway volume mounted at /data');
const runtime = (globalThis as any).Bun;
const env = runtime?.env || process.env;
const liveStore = new Store(env.ARK_DATA || '/data');
const bootstrapHash = env.ARK_BOOTSTRAP_TOKEN_HASH;
const bootstrapId = env.ARK_BOOTSTRAP_ID;
if (!liveStore.one('SELECT 1 FROM credentials LIMIT 1')) {
  requireThat(/^[a-f0-9]{64}$/.test(bootstrapHash || '') && /^[a-f0-9-]{36}$/.test(bootstrapId || ''),500,'operator enrollment configuration missing');
  liveStore.atomic(()=>{
    liveStore.run('INSERT INTO identities VALUES(?,?,1)',bootstrapId,'Ark pilot operator');
    liveStore.run('INSERT INTO credentials VALUES(?,?,1,?,0)',bootstrapHash,bootstrapId,Date.now()+30*86400000);
  });
}

// Jah Noah [Q017]: "if if I could use TCP plus Web Sockets for everything That'd be great"
// Engineering: the Bun entry forwards bounded requests to the existing Node-compatible HTTP handler.
const internalServer = createApi(liveStore);
await new Promise<void>((resolve,reject)=>{
  internalServer.once('error',reject);
  internalServer.listen(0,'127.0.0.1',()=>resolve());
});
const internalPort=(internalServer.address() as any).port;
// Jah Noah [Q005]: "we have the file backed up across these different places"
// Engineering: personal article bodies and attachments live in a private object bucket; metadata stays on the persistent volume.
const archiveClient=runtime?.S3Client && env.ARK_ARCHIVE_BUCKET ? new runtime.S3Client({endpoint:env.ARK_ARCHIVE_ENDPOINT,bucket:env.ARK_ARCHIVE_BUCKET,region:env.ARK_ARCHIVE_REGION,accessKeyId:env.ARK_ARCHIVE_ACCESS_KEY_ID,secretAccessKey:env.ARK_ARCHIVE_SECRET_ACCESS_KEY}) : null;
const webHandler=createWeb(liveStore,env.ARK_APP_ORIGIN||'http://test',webAssets,archiveClient?{
  async put(key:string,bytes:Buffer){await archiveClient.file(key).write(bytes,{type:'application/octet-stream'});},
  async get(key:string){return Buffer.from(await archiveClient.file(key).arrayBuffer());},
  async remove(key:string){await archiveClient.file(key).delete();}
}:null);
const application = {
  port: Number(env.PORT || 8080),
  hostname: '0.0.0.0',
  async fetch(request: Request): Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname==='/app')return Response.redirect(new URL('/app/',request.url),302);
    const webResponse=await webHandler(request);if(webResponse)return webResponse;
    if(request.method==='GET' && url.pathname==='/') return Response.json({service:'Ark Core',version:'0.1.0',health:'/health',api:'/v1',status:'pilot'});
    const advertised=Number(request.headers.get('content-length') || 0);
    if(advertised>1500000) return Response.json({error:'request too large'},{status:413});
    const chunks:Uint8Array[]=[];let length=0;
    if(request.body) {
      const reader=request.body.getReader();
      try {
        while(true) {
          const {done,value}=await reader.read();if(done)break;
          length+=value.length;
          if(length>1500000) {await reader.cancel();return Response.json({error:'request too large'},{status:413});}
          chunks.push(value);
        }
      } finally {reader.releaseLock();}
    }
    const headers=new Headers();
    for(const key of ['authorization','idempotency-key','content-type','origin']) {
      const value=request.headers.get(key);if(value)headers.set(key,value);
    }
    return fetch(`http://127.0.0.1:${internalPort}${url.pathname}${url.search}`,{
      method:request.method,headers,body:chunks.length?Buffer.concat(chunks):undefined,
      redirect:'error',signal:AbortSignal.timeout(15000)
    });
  }
};
export default application;
function shutdown() {internalServer.close(()=>{liveStore.close();process.exit(0);});}
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,shutdown);
console.log(JSON.stringify({service:'ark-core',node_id:liveStore.nodeId(),storage:'persistent',runtime:runtime?.version || 'node-test'}));

// Jah Noah [Q012]: "I- I want OnlyJah to be able to run lean"
// Engineering: tests can release the internal listener; this is never a remote API capability.
export async function disposeBundleForTest() {
  requireThat(bundleTest,403,'test disposal disabled');
  await new Promise<void>(resolve=>internalServer.close(()=>resolve()));
  liveStore.close();
}
